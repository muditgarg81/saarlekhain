"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrStatus, RfqStatus, RfqLineStatus, LineStatus } from "@prisma/client";
import { can } from "@/lib/rbac";

const prSchema = z.object({
  lines: z.array(z.object({
    itemId: z.string(),
    qty: z.number().nonnegative(),
    requiredBy: z.string().optional().nullable(),
  })).min(1, "PR must contain at least one line"),
});

const rfqSchema = z.object({
  prId: z.string().optional().nullable(),
  lines: z.array(z.object({
    itemId: z.string(),
    qty: z.number().nonnegative(),
  })).min(1, "RFQ must contain at least one line"),
});

const quotationSchema = z.object({
  rfqId: z.string(),
  vendorId: z.string(),
  leadDays: z.number().int().nonnegative().optional().nullable(),
  terms: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  freight: z.number().nonnegative().default(0),
  packingCharges: z.number().nonnegative().default(0),
  lines: z.array(z.object({
    rfqLineId: z.string().optional().nullable(),
    itemId: z.string(),
    rate: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
    gstRate: z.number().nonnegative().default(0),
    canSupply: z.boolean().default(true),
    quotedQty: z.number().nonnegative().optional().nullable(),
    leadDays: z.number().int().nonnegative().optional().nullable(),
  })),
});

async function logAudit(
  tx: any,
  companyId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any
) {
  await tx.auditLog.create({
    data: {
      companyId,
      actorId,
      action,
      entity,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    },
  });
}

export async function createPR(data: z.infer<typeof prSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = prSchema.parse(data);
    const number = await getNextSequence(companyId, "PR");

    const result = await db.$transaction(async (tx) => {
      const pr = await tx.purchaseRequisition.create({
        data: {
          companyId,
          number,
          status: PrStatus.DRAFT,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              requiredBy: l.requiredBy ? new Date(l.requiredBy) : null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await logAudit(tx, companyId, actorId, "CREATE", "PurchaseRequisition", pr.id, null, pr);
      return pr;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, pr: result };
  } catch (err: any) {
    console.error("Error creating PR:", err);
    return { success: false, error: err.message || "Failed to create PR" };
  }
}

export async function approvePR(prId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.purchaseRequisition.findFirst({
      where: { id: prId, companyId },
    });
    if (!original) return { success: false, error: "PR not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.purchaseRequisition.update({
        where: { id: prId },
        data: {
          status: PrStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date(),
        },
      });

      await logAudit(tx, companyId, actorId, "APPROVE", "PurchaseRequisition", prId, original, updated);
      return updated;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, pr: result };
  } catch (err: any) {
    console.error("Error approving PR:", err);
    return { success: false, error: err.message || "Failed to approve PR" };
  }
}

export async function rejectPR(prId: string, remarks: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.purchaseRequisition.findFirst({
      where: { id: prId, companyId },
    });
    if (!original) return { success: false, error: "PR not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.purchaseRequisition.update({
        where: { id: prId },
        data: {
          status: PrStatus.REJECTED,
          remarks: remarks || null,
        },
      });

      await logAudit(tx, companyId, actorId, "REJECT", "PurchaseRequisition", prId, original, updated);
      return updated;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, pr: result };
  } catch (err: any) {
    console.error("Error rejecting PR:", err);
    return { success: false, error: err.message || "Failed to reject PR" };
  }
}

export async function createRFQ(data: z.infer<typeof rfqSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = rfqSchema.parse(data);
    const number = await getNextSequence(companyId, "RFQ");

    const result = await db.$transaction(async (tx) => {
      const rfq = await tx.rfq.create({
        data: {
          companyId,
          number,
          prId: validated.prId || null,
          status: RfqStatus.DRAFT,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      if (validated.prId) {
        await tx.purchaseRequisition.update({
          where: { id: validated.prId },
          data: { status: PrStatus.RFQ_ISSUED },
        });
      }

      await logAudit(tx, companyId, actorId, "CREATE", "Rfq", rfq.id, null, rfq);
      return rfq;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, rfq: result };
  } catch (err: any) {
    console.error("Error creating RFQ:", err);
    return { success: false, error: err.message || "Failed to create RFQ" };
  }
}

export async function submitQuotation(data: z.infer<typeof quotationSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  if (!can(session.user as any, "rfq.manage")) {
    return { success: false, error: "Forbidden: You do not have permission to record quotes." };
  }

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = quotationSchema.parse(data);

    const result = await db.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          companyId,
          rfqId: validated.rfqId,
          vendorId: validated.vendorId,
          leadDays: validated.leadDays || null,
          terms: validated.terms || null,
          paymentTerms: validated.paymentTerms || null,
          freight: validated.freight,
          packingCharges: validated.packingCharges,
          awarded: false,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              rfqLineId: l.rfqLineId || null,
              canSupply: l.canSupply ?? true,
              quotedQty: l.quotedQty ?? null,
              leadDays: l.leadDays ?? null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      // Recalculate ranks for the RFQ
      await recalculateRfqRanks(validated.rfqId, tx);

      // Update RFQ status to Quotes Received
      await tx.rfq.update({
        where: { id: validated.rfqId },
        data: { status: RfqStatus.QUOTES_RECEIVED },
      });

      await logAudit(tx, companyId, actorId, "SUBMIT_QUOTATION", "Quotation", q.id, null, q);
      return q;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, quotation: result };
  } catch (err: any) {
    console.error("Error submitting quotation:", err);
    return { success: false, error: err.message || "Failed to submit quotation" };
  }
}

export async function awardQuotation(rfqId: string, quotationId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  if (!can(session.user as any, "rfq.award")) {
    return { success: false, error: "Forbidden: You do not have permission to award RFQs." };
  }

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const rfq = await db.rfq.findFirst({
      where: { id: rfqId, companyId },
      include: { quotations: true }
    });
    if (!rfq) return { success: false, error: "RFQ not found" };

    const result = await db.$transaction(async (tx) => {
      // Set all quotes for this RFQ to unawarded
      await tx.quotation.updateMany({
        where: { rfqId },
        data: { awarded: false },
      });

      // Set selected quote to awarded
      const awardedQuote = await tx.quotation.update({
        where: { id: quotationId },
        data: { awarded: true },
      });

      // Set RFQ to Awarded
      await tx.rfq.update({
        where: { id: rfqId },
        data: { status: RfqStatus.AWARDED },
      });

      await logAudit(tx, companyId, actorId, "AWARD_QUOTATION", "Quotation", quotationId, null, awardedQuote);
      return awardedQuote;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, quotation: result };
  } catch (err: any) {
    console.error("Error awarding quotation:", err);
    return { success: false, error: err.message || "Failed to award quotation" };
  }
}

/**
 * Recalculates landed costs and L1 ranks for all quotation lines linked to an RFQ.
 */
export async function recalculateRfqRanks(rfqId: string, tx: any) {
  // 1. Fetch all quotations and their lines for this RFQ to calculate totalBasicValue
  const quotations = await tx.quotation.findMany({
    where: { rfqId },
    include: {
      lines: {
        include: {
          rfqLine: true
        }
      },
      vendor: true
    }
  });

  // Calculate landed units for all lines across all quotations
  const landedUnitMap = new Map<string, { landedUnit: number; leadDays: number; rating: number }>();

  for (const q of quotations) {
    let totalBasicValue = 0;
    const activeLines = q.lines.filter((l: any) => l.canSupply);

    const lineDetails = activeLines.map((line: any) => {
      const rfqLineQty = line.rfqLine?.qty ?? 0;
      const effectiveQty = line.quotedQty && line.quotedQty > 0 ? line.quotedQty : rfqLineQty;
      const basicValue = line.rate * (1 - line.discount / 100) * effectiveQty;
      totalBasicValue += basicValue;
      return {
        id: line.id,
        rate: line.rate,
        discount: line.discount,
        gstRate: line.gstRate,
        effectiveQty,
        basicValue,
        leadDays: line.leadDays ?? q.leadDays ?? 999,
        rating: q.vendor?.rating ?? 0
      };
    });

    const totalCommonCharges = (q.freight ?? 0) + (q.packingCharges ?? 0);

    for (const detail of lineDetails) {
      let unitCharges = 0;
      if (totalBasicValue > 0 && detail.effectiveQty > 0) {
        const allocatedCharges = totalCommonCharges * (detail.basicValue / totalBasicValue);
        unitCharges = allocatedCharges / detail.effectiveQty;
      }
      const landedUnit = detail.rate * (1 - detail.discount / 100) * (1 + detail.gstRate / 100) + unitCharges;
      landedUnitMap.set(detail.id, {
        landedUnit,
        leadDays: detail.leadDays,
        rating: detail.rating
      });
    }
  }

  // 2. Fetch all RFQ lines with their quotation lines to rank them
  const rfqLines = await tx.rfqLine.findMany({
    where: { rfqId },
    include: {
      quotationLines: true
    }
  });

  for (const rfqLine of rfqLines) {
    const linesWithLanded = rfqLine.quotationLines
      .filter((line: any) => line.canSupply)
      .map((line: any) => {
        const computed = landedUnitMap.get(line.id);
        return {
          line,
          landedUnit: computed?.landedUnit ?? 0,
          leadDays: computed?.leadDays ?? 999,
          rating: computed?.rating ?? 0
        };
      });

    // Sort by: landedUnit asc, leadDays asc, rating desc
    linesWithLanded.sort((a: any, b: any) => {
      if (Math.abs(a.landedUnit - b.landedUnit) > 0.0001) {
        return a.landedUnit - b.landedUnit;
      }
      if (a.leadDays !== b.leadDays) {
        return a.leadDays - b.leadDays;
      }
      return b.rating - a.rating;
    });

    // Update rank and landedUnit in DB
    for (const qLine of rfqLine.quotationLines) {
      if (!qLine.canSupply) {
        await tx.quotationLine.update({
          where: { id: qLine.id },
          data: {
            landedUnit: null,
            rank: null
          }
        });
      } else {
        const match = linesWithLanded.find((m: any) => m.line.id === qLine.id);
        if (match) {
          const rank = linesWithLanded.indexOf(match) + 1;
          await tx.quotationLine.update({
            where: { id: qLine.id },
            data: {
              landedUnit: match.landedUnit,
              rank
            }
          });
        }
      }
    }
  }
}

export async function updateQuotation(data: {
  id: string;
  leadDays?: number | null;
  terms?: string | null;
  paymentTerms?: string | null;
  freight: number;
  packingCharges: number;
  lines: {
    id: string;
    rate: number;
    discount: number;
    gstRate: number;
    canSupply: boolean;
    quotedQty?: number | null;
    leadDays?: number | null;
  }[];
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  if (!can(session.user as any, "rfq.manage")) {
    return { success: false, error: "Forbidden: You do not have permission to edit quotes." };
  }

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.quotation.findFirst({
      where: { id: data.id, companyId },
      include: {
        rfq: true,
        lines: {
          include: {
            poLines: true
          }
        }
      }
    });

    if (!q) return { success: false, error: "Quotation not found" };

    if (q.rfq.status === RfqStatus.CLOSED) {
      return { success: false, error: "Cannot edit quotation because the RFQ is closed." };
    }

    const hasPo = q.lines.some(l => l.poLines.length > 0);
    if (hasPo) {
      return { success: false, error: "Cannot edit quotation because a Purchase Order has already been raised for it." };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Update quotation metadata
      const updatedQuote = await tx.quotation.update({
        where: { id: data.id },
        data: {
          leadDays: data.leadDays || null,
          terms: data.terms || null,
          paymentTerms: data.paymentTerms || null,
          freight: data.freight,
          packingCharges: data.packingCharges,
        }
      });

      // 2. Update each line
      for (const line of data.lines) {
        await tx.quotationLine.update({
          where: { id: line.id },
          data: {
            rate: line.rate,
            discount: line.discount,
            gstRate: line.gstRate,
            canSupply: line.canSupply,
            quotedQty: line.quotedQty ?? null,
            leadDays: line.leadDays ?? null,
          }
        });

        // 3. If line.canSupply became false, delete its AwardAllocations
        if (!line.canSupply) {
          await tx.awardAllocation.deleteMany({
            where: { quotationLineId: line.id, companyId }
          });
        }
      }

      // 4. Recalculate ranks for the RFQ
      await recalculateRfqRanks(q.rfqId, tx);

      await logAudit(tx, companyId, actorId, "UPDATE_QUOTATION", "Quotation", data.id, q, updatedQuote);
      return updatedQuote;
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, quotation: result };
  } catch (err: any) {
    console.error("Error updating quotation:", err);
    return { success: false, error: err.message || "Failed to update quotation" };
  }
}

export async function deleteQuotation(quotationId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  if (!can(session.user as any, "rfq.manage")) {
    return { success: false, error: "Forbidden: You do not have permission to delete quotes." };
  }

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: {
        rfq: true,
        lines: {
          include: {
            poLines: true
          }
        }
      }
    });

    if (!q) return { success: false, error: "Quotation not found" };

    if (q.rfq.status === RfqStatus.CLOSED) {
      return { success: false, error: "Cannot delete quotation because the RFQ is closed." };
    }

    const hasPo = q.lines.some(l => l.poLines.length > 0);
    if (hasPo) {
      return { success: false, error: "Cannot delete quotation because a Purchase Order has already been raised for it." };
    }

    const qLineIds = q.lines.map(l => l.id);

    await db.$transaction(async (tx) => {
      // 1. Delete associated AwardAllocations
      await tx.awardAllocation.deleteMany({
        where: { quotationLineId: { in: qLineIds }, companyId }
      });

      // 2. Delete QuotationLines
      await tx.quotationLine.deleteMany({
        where: { quotationId }
      });

      // 3. Delete Quotation
      await tx.quotation.delete({
        where: { id: quotationId }
      });

      // 4. Recalculate ranks for the RFQ
      await recalculateRfqRanks(q.rfqId, tx);

      // 5. Update RFQ status
      const remainingQuotes = await tx.quotation.count({
        where: { rfqId: q.rfqId }
      });

      if (remainingQuotes === 0) {
        await tx.rfq.update({
          where: { id: q.rfqId },
          data: { status: RfqStatus.ISSUED }
        });
      } else {
        const awardedCount = await tx.quotation.count({
          where: { rfqId: q.rfqId, awarded: true }
        });
        await tx.rfq.update({
          where: { id: q.rfqId },
          data: { status: awardedCount > 0 ? RfqStatus.AWARDED : RfqStatus.QUOTES_RECEIVED }
        });
      }

      await logAudit(tx, companyId, actorId, "DELETE_QUOTATION", "Quotation", quotationId, q, null);
    });

    revalidatePath("/purchase/requisitions");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting quotation:", err);
    return { success: false, error: err.message || "Failed to delete quotation" };
  }
}


