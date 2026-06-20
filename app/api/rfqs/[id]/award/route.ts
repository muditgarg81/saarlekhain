import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { RfqStatus, AwardReason } from "@prisma/client";
import { can } from "@/lib/rbac";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(session.user as any, "rfq.award")) {
    return NextResponse.json({ error: "Forbidden: You do not have permission to award RFQs." }, { status: 403 });
  }
  const companyId = (session.user as any).companyId;
  const { id: rfqId } = await params;

  try {
    const body = await request.json();
    const { lines } = body as {
      lines: {
        rfqLineId: string;
        quotationLineId: string;
        qty: number;
        reason: string;
        note?: string | null;
      }[];
    };

    if (!lines || !Array.isArray(lines)) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const rfq = await db.rfq.findFirst({
      where: { id: rfqId, companyId },
      include: {
        lines: true,
        quotations: {
          include: {
            lines: true,
          }
        }
      }
    });

    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    // Validate allocations
    for (const alloc of lines) {
      const rfqLine = rfq.lines.find((l) => l.id === alloc.rfqLineId);
      if (!rfqLine) {
        return NextResponse.json({ error: `RFQ Line ${alloc.rfqLineId} not found` }, { status: 400 });
      }

      // Check if quotation line exists and belongs to this RFQ
      let qLine = null;
      let vendorId = "";
      for (const q of rfq.quotations) {
        const found = q.lines.find((ql) => ql.id === alloc.quotationLineId);
        if (found) {
          qLine = found;
          vendorId = q.vendorId;
          break;
        }
      }

      if (!qLine) {
        return NextResponse.json({ error: `Quotation Line ${alloc.quotationLineId} not found for this RFQ` }, { status: 400 });
      }

      // If non-L1, verify reason and note
      const isL1 = qLine.rank === 1;
      if (!isL1) {
        if (!alloc.reason || alloc.reason === "L1") {
          return NextResponse.json({ error: `Reason is required for non-L1 award of item ${rfqLine.itemId}` }, { status: 400 });
        }
        if (!alloc.note || !alloc.note.trim()) {
          return NextResponse.json({ error: `Justification note is required for non-L1 award of item ${rfqLine.itemId}` }, { status: 400 });
        }
      }
    }

    // Group allocations by rfqLineId and verify total quantities do not exceed RFQ line quantity
    const rfqLineTotals: { [id: string]: number } = {};
    for (const alloc of lines) {
      rfqLineTotals[alloc.rfqLineId] = (rfqLineTotals[alloc.rfqLineId] || 0) + alloc.qty;
    }

    for (const [rfqLineId, totalQty] of Object.entries(rfqLineTotals)) {
      const rfqLine = rfq.lines.find((l) => l.id === rfqLineId)!;
      if (totalQty > rfqLine.qty + 0.0001) {
        return NextResponse.json({ error: `Total allocated quantity (${totalQty}) exceeds target quantity (${rfqLine.qty}) for RFQ line.` }, { status: 400 });
      }
    }

    // Save allocations inside transaction
    await db.$transaction(async (tx) => {
      const rfqLineIds = rfq.lines.map((l) => l.id);
      
      // 1. Delete old allocations
      await tx.awardAllocation.deleteMany({
        where: { rfqLineId: { in: rfqLineIds }, companyId }
      });

      // 2. Create new allocations
      const toCreate = lines.map((alloc) => {
        let vendorId = "";
        for (const q of rfq.quotations) {
          if (q.lines.some((ql) => ql.id === alloc.quotationLineId)) {
            vendorId = q.vendorId;
            break;
          }
        }

        return {
          companyId,
          rfqLineId: alloc.rfqLineId,
          quotationLineId: alloc.quotationLineId,
          vendorId,
          qty: alloc.qty,
          reason: alloc.reason as AwardReason,
          note: alloc.note || null,
        };
      });

      if (toCreate.length > 0) {
        await tx.awardAllocation.createMany({
          data: toCreate
        });
      }

      // 3. Reset all quotes' awarded status for this RFQ
      await tx.quotation.updateMany({
        where: { rfqId },
        data: { awarded: false }
      });

      // Mark quotations containing awarded lines as awarded = true
      const awardedVendorIds = new Set(toCreate.map((c) => c.vendorId));
      await tx.quotation.updateMany({
        where: { rfqId, vendorId: { in: Array.from(awardedVendorIds) } },
        data: { awarded: true }
      });

      // 4. Update RFQ status to AWARDED
      await tx.rfq.update({
        where: { id: rfqId },
        data: { status: RfqStatus.AWARDED }
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error committing award allocations:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
