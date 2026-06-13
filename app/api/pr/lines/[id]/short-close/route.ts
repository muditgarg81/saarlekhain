import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { LineStatus, PrStatus } from "@prisma/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  const companyId = user.companyId;
  const actorId = user.id;

  const canApprove = can(user, "pr.approve") || ["ADMIN", "OWNER", "PURCHASE_MANAGER", "APPROVER"].includes(user.role);
  if (!canApprove) {
    return NextResponse.json({ error: "Permission denied. Only Purchase Managers or Approvers can short-close lines." }, { status: 403 });
  }

  const { id: lineId } = await params;

  try {
    const { qty, reason, note } = await request.json();
    if (typeof qty !== "number" || qty <= 0 || !reason) {
      return NextResponse.json({ error: "Quantity and reason are required" }, { status: 400 });
    }

    const line = await db.prLine.findFirst({
      where: { id: lineId, pr: { companyId } },
      include: { pr: true }
    });

    if (!line) {
      return NextResponse.json({ error: "PR line not found" }, { status: 404 });
    }

    const maxShortClose = line.qty - line.orderedQty - line.shortClosedQty;
    if (qty > maxShortClose + 0.0001) {
      return NextResponse.json({ error: `Cannot short-close quantity (${qty}) greater than the remaining open quantity (${maxShortClose.toFixed(2)}).` }, { status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Update PrLine
      const updatedLine = await tx.prLine.update({
        where: { id: lineId },
        data: {
          shortClosedQty: { increment: qty }
        }
      });

      // 2. Recompute line status
      const open = updatedLine.qty - updatedLine.orderedQty - updatedLine.shortClosedQty;
      let lineStatus: LineStatus = LineStatus.OPEN;
      if (open <= 0) {
        lineStatus = updatedLine.shortClosedQty === updatedLine.qty ? LineStatus.SHORT_CLOSED : LineStatus.ORDERED;
      } else if (updatedLine.orderedQty > 0) {
        lineStatus = LineStatus.PARTIALLY_ORDERED;
      }

      await tx.prLine.update({
        where: { id: lineId },
        data: { status: lineStatus, poRaised: open <= 0 }
      });

      // 3. Recompute PR header status
      const pr = await tx.purchaseRequisition.findUnique({
        where: { id: line.prId },
        include: { lines: true }
      });

      if (pr) {
        const allLinesTerminal = pr.lines.every((l) =>
          ([LineStatus.ORDERED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
        );
        const someLinesOrdered = pr.lines.some((l) =>
          ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED] as LineStatus[]).includes(l.status)
        );

        let nextPrStatus: PrStatus = PrStatus.RFQ_ISSUED;
        if (allLinesTerminal) {
          const allShortClosed = pr.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
          nextPrStatus = allShortClosed ? PrStatus.SHORT_CLOSED : PrStatus.CLOSED;
        } else if (someLinesOrdered) {
          nextPrStatus = PrStatus.PARTIALLY_ORDERED;
        }

        await tx.purchaseRequisition.update({
          where: { id: pr.id },
          data: { status: nextPrStatus }
        });
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "SHORT_CLOSE_PR_LINE",
          entity: "PrLine",
          entityId: lineId,
          before: line,
          after: { qty, reason, note },
        }
      });

      return updatedLine;
    });

    return NextResponse.json({ success: true, line: result });
  } catch (err: any) {
    console.error("Error short-closing PR line:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
