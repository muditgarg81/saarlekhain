import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const companyId = (session.user as any).companyId;
  const { id: rfqId } = await params;

  try {
    const rfq = await db.rfq.findFirst({
      where: { id: rfqId, companyId },
      include: {
        lines: {
          include: {
            prLine: true,
          }
        },
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

    // Resolve items details
    const itemIds = rfq.lines.map((l) => l.itemId);
    const items = await db.item.findMany({
      where: { id: { in: itemIds }, companyId },
    });

    // Fetch vendors to resolve names in memory
    const vendors = await db.vendor.findMany({
      where: { companyId, deletedAt: null }
    });

    // Fetch existing committed allocations
    const allocations = await db.awardAllocation.findMany({
      where: { rfqLineId: { in: rfq.lines.map((l) => l.id) }, companyId },
    });

    // Format lines with item details
    const formattedLines = rfq.lines.map((l) => {
      const item = items.find((i) => i.id === l.itemId);
      return {
        ...l,
        itemCode: item?.code || "UNKNOWN",
        itemName: item?.name || "Unknown Item",
        moq: item?.moq || 1,
      };
    });

    // Compute proposed/default allocations dynamically
    const proposedAllocations: any[] = [];
    for (const line of formattedLines) {
      const need = line.qty;
      const candidates: any[] = [];
      for (const q of rfq.quotations) {
        const qLine = q.lines.find((ql) => ql.rfqLineId === line.id);
        if (qLine && qLine.canSupply) {
          candidates.push({
            qLine,
            quotation: q,
            rank: qLine.rank ?? 999,
            landedUnit: qLine.landedUnit ?? 999999,
          });
        }
      }

      // Sort by rank ascending, then by landedUnit ascending
      candidates.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.landedUnit - b.landedUnit;
      });

      let remaining = need;
      for (const cand of candidates) {
        if (remaining <= 0) break;
        const available = cand.qLine.quotedQty !== null && cand.qLine.quotedQty !== undefined ? cand.qLine.quotedQty : need;
        const take = Math.min(remaining, available);
        if (take > 0) {
          const vendor = vendors.find((v) => v.id === cand.quotation.vendorId);
          proposedAllocations.push({
            rfqLineId: line.id,
            quotationLineId: cand.qLine.id,
            vendorId: cand.quotation.vendorId,
            vendorName: vendor?.name || "Unknown Vendor",
            qty: take,
            reason: cand.rank === 1 ? "L1" : "PARTIAL_AVAILABILITY",
            note: cand.rank === 1 ? null : `L1 vendor could only supply partial quantity`,
          });
          remaining -= take;
        }
      }
    }

    // Format quotations with vendor name
    const formattedQuotations = rfq.quotations.map((q) => {
      const vendor = vendors.find((v) => v.id === q.vendorId);
      return {
        ...q,
        vendorName: vendor?.name || "Unknown Vendor",
      };
    });

    return NextResponse.json({
      rfq: {
        ...rfq,
        lines: formattedLines,
        quotations: formattedQuotations,
      },
      allocations,
      proposedAllocations,
    });
  } catch (err: any) {
    console.error("Error fetching comparison matrix:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
