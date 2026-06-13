import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function POST(
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

    const proposedAllocations: any[] = [];
    for (const line of rfq.lines) {
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
          proposedAllocations.push({
            companyId,
            rfqLineId: line.id,
            quotationLineId: cand.qLine.id,
            vendorId: cand.quotation.vendorId,
            qty: take,
            reason: cand.rank === 1 ? "L1" : "PARTIAL_AVAILABILITY",
            note: cand.rank === 1 ? null : `L1 vendor could only supply partial quantity`,
          });
          remaining -= take;
        }
      }
    }

    // Replace existing allocations inside a transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Delete old allocations
      const rfqLineIds = rfq.lines.map((l) => l.id);
      await tx.awardAllocation.deleteMany({
        where: { rfqLineId: { in: rfqLineIds }, companyId }
      });

      // 2. Create new proposed allocations
      if (proposedAllocations.length > 0) {
        await tx.awardAllocation.createMany({
          data: proposedAllocations
        });
      }

      // Fetch newly created allocations
      return tx.awardAllocation.findMany({
        where: { rfqLineId: { in: rfqLineIds }, companyId }
      });
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Error proposing award:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
