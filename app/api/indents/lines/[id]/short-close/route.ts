import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { LineStatus, IndentStatus } from "@prisma/client";

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

  const canApprove = can(user, "indent.approve") || ["ADMIN", "OWNER", "STORE_MANAGER", "APPROVER"].includes(user.role);
  if (!canApprove) {
    return NextResponse.json({ error: "Permission denied. Only Store Managers or Approvers can short-close lines." }, { status: 403 });
  }

  const { id: lineId } = await params;

  try {
    const { qty, reason, note } = await request.json();
    if (typeof qty !== "number" || qty <= 0 || !reason) {
      return NextResponse.json({ error: "Quantity and reason are required" }, { status: 400 });
    }

    const line = await db.indentLine.findFirst({
      where: { id: lineId, indent: { companyId } },
      include: { indent: true }
    });

    if (!line) {
      return NextResponse.json({ error: "Indent line not found" }, { status: 404 });
    }

    const maxShortClose = line.qty - line.orderedQty - line.issuedQty - line.shortClosedQty;
    if (qty > maxShortClose + 0.0001) {
      return NextResponse.json({ error: `Cannot short-close quantity (${qty}) greater than the remaining open quantity (${maxShortClose.toFixed(2)}).` }, { status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Update IndentLine
      const updatedLine = await tx.indentLine.update({
        where: { id: lineId },
        data: {
          shortClosedQty: { increment: qty }
        }
      });

      // 2. Recompute line status
      const open = updatedLine.qty - updatedLine.orderedQty - updatedLine.issuedQty - updatedLine.shortClosedQty;
      let lineStatus: LineStatus = LineStatus.OPEN;
      if (open <= 0) {
        if (updatedLine.shortClosedQty === updatedLine.qty) {
          lineStatus = LineStatus.SHORT_CLOSED;
        } else if (updatedLine.issuedQty >= updatedLine.qty - updatedLine.shortClosedQty) {
          lineStatus = LineStatus.ISSUED;
        } else {
          lineStatus = LineStatus.ORDERED;
        }
      } else if (updatedLine.orderedQty > 0 || updatedLine.issuedQty > 0) {
        lineStatus = LineStatus.PARTIALLY_ORDERED;
      }

      await tx.indentLine.update({
        where: { id: lineId },
        data: { status: lineStatus }
      });

      // 3. Recompute indent header status
      const indent = await tx.indent.findUnique({
        where: { id: line.indentId },
        include: { lines: true }
      });

      if (indent) {
        const allLinesTerminal = indent.lines.every((l) =>
          ([LineStatus.ORDERED, LineStatus.ISSUED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
        );
        const someLinesOrdered = indent.lines.some((l) =>
          ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED, LineStatus.ISSUED] as LineStatus[]).includes(l.status)
        );

        let nextIndentStatus: IndentStatus = IndentStatus.APPROVED;
        if (allLinesTerminal) {
          const allShortClosed = indent.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
          nextIndentStatus = allShortClosed ? IndentStatus.SHORT_CLOSED : IndentStatus.CLOSED;
        } else if (someLinesOrdered) {
          nextIndentStatus = IndentStatus.PARTIALLY_ORDERED;
        }

        await tx.indent.update({
          where: { id: indent.id },
          data: { status: nextIndentStatus }
        });
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "SHORT_CLOSE_INDENT_LINE",
          entity: "IndentLine",
          entityId: lineId,
          before: line,
          after: { qty, reason, note },
        }
      });

      return updatedLine;
    });

    return NextResponse.json({ success: true, line: result });
  } catch (err: any) {
    console.error("Error short-closing indent line:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
