"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrStatus, RfqStatus, RfqLineStatus, LineStatus } from "@prisma/client";

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
  lines: z.array(z.object({
    rfqLineId: z.string().optional().nullable(),
    itemId: z.string(),
    rate: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
    gstRate: z.number().nonnegative().default(0),
    canSupply: z.boolean().default(true),
    quotedQty: z.number().nonnegative().optional().nullable(),
    freight: z.number().nonnegative().default(0),
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
              freight: l.freight ?? 0,
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
  // Fetch all RFQ lines
  const rfqLines = await tx.rfqLine.findMany({
    where: { rfqId },
    include: {
      quotationLines: {
        include: {
          quotation: {
            include: {
              vendor: true
            }
          }
        }
      }
    }
  });

  for (const rfqLine of rfqLines) {
    const linesWithLanded = rfqLine.quotationLines
      .filter((line: any) => line.canSupply)
      .map((line: any) => {
        const effectiveQty = line.quotedQty && line.quotedQty > 0 ? line.quotedQty : rfqLine.qty;
        // Formula: rate * (1 - discount%) * (1 + gst%) + (freight / effectiveQty)
        const landedUnit = line.rate * (1 - line.discount / 100) * (1 + line.gstRate / 100) + (line.freight / effectiveQty);
        return {
          line,
          landedUnit,
          leadDays: line.leadDays ?? line.quotation.leadDays ?? 999,
          rating: line.quotation.vendor.rating ?? 0
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

