"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PoType, PoStatus } from "@prisma/client";
import { resolvePoTerms } from "@/lib/termsResolver";

const poLineSchema = z.object({
  itemId: z.string(),
  qty: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  gstRate: z.number().nonnegative().default(0),
  requiredBy: z.string().optional().nullable(),
});

const poSchema = z.object({
  vendorId: z.string(),
  type: z.nativeEnum(PoType).default(PoType.REGULAR),
  deliveryDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  freightTerms: z.string().optional().nullable(),
  shipTo: z.string().optional().nullable(),
  termsConditions: z.string().optional().nullable(),
  termsPresetId: z.string().optional().nullable(),
  rateContractExpiry: z.string().optional().nullable(),
  rfqId: z.string().optional().nullable(),
  lines: z.array(poLineSchema).min(1, "PO must contain at least one line item"),
});

// Roles limits: Officer <= 50,000; Manager <= 500,000; Approver/Admin/Owner = unlimited
const APPROVAL_LIMITS: { [role: string]: number } = {
  PURCHASE_OFFICER: 50000,
  PURCHASE_MANAGER: 500000,
  ADMIN: Infinity,
  OWNER: Infinity,
  APPROVER: Infinity,
};

function calculateTotalValue(lines: { qty: number; rate: number; discount: number; gstRate: number }[]) {
  return lines.reduce((sum, line) => {
    const discounted = line.qty * line.rate * (1 - line.discount / 100);
    const landed = discounted * (1 + line.gstRate / 100);
    return sum + landed;
  }, 0);
}

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

async function freezePOTerms(tx: any, poId: string, companyId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: poId },
    include: { vendor: true }
  });
  
  if (!po) return;
  if (!po.termsPresetId && !po.termsConditions) return;

  let finalText = "";
  let latestVersion = 1;

  if (po.termsPresetId) {
    const presetIds = po.termsPresetId.split(",").map((id: string) => id.trim()).filter(Boolean);
    const resolvedTexts: string[] = [];

    // Find company details
    const company = await tx.company.findUnique({
      where: { id: companyId }
    });

    // Find terms config
    const config = await tx.poTermsConfig.findUnique({
      where: { companyId }
    });

    for (const presetId of presetIds) {
      // Find the preset (system-wide null or company specific)
      const preset = await tx.poTermsPreset.findFirst({
        where: {
          OR: [
            { companyId: null },
            { companyId }
          ],
          id: presetId,
          status: "ACTIVE"
        }
      });

      if (!preset) {
        throw new Error(`Chosen Terms Preset (ID: ${presetId}) is not active or could not be found.`);
      }

      const res = resolvePoTerms(po, preset, company, po.vendor, config);
      if (!res.success) {
        throw new Error(`Cannot issue PO. There are missing commercial default configuration or company profile fields for preset ${preset.name}:\n${res.errors.map(e => `• ${e}`).join("\n")}`);
      }

      resolvedTexts.push(`### ${preset.name}\n\n${res.text}`);
      if (preset.version > latestVersion) {
        latestVersion = preset.version;
      }
    }
    
    finalText = resolvedTexts.join("\n\n---\n\n");
  }

  if (po.termsConditions) {
    if (finalText) {
      finalText += "\n\n---\n\n### ADDITIONAL CUSTOM TERMS & CONDITIONS\n\n" + po.termsConditions;
    } else {
      finalText = po.termsConditions;
    }
  }

  await tx.purchaseOrder.update({
    where: { id: poId },
    data: {
      resolvedTermsText: finalText,
      termsVersion: po.termsPresetId ? latestVersion : null
    }
  });
}

export async function createPO(data: z.infer<typeof poSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const userRole = (session.user as any).role || "VIEWER";

  try {
    const validated = poSchema.parse(data);
    const number = await getNextSequence(companyId, "PO");

    const result = await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          companyId,
          number,
          vendorId: validated.vendorId,
          type: validated.type,
          status: PoStatus.DRAFT,
          deliveryDate: validated.deliveryDate ? new Date(validated.deliveryDate) : null,
          paymentTerms: validated.paymentTerms || null,
          freightTerms: validated.freightTerms || null,
          shipTo: validated.shipTo || null,
          termsConditions: validated.termsConditions || null,
          termsPresetId: validated.termsPresetId || null,
          rateContractExpiry: validated.rateContractExpiry ? new Date(validated.rateContractExpiry) : null,
          prId: validated.rfqId || null, // store rfq reference
          version: 1,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              requiredBy: l.requiredBy ? new Date(l.requiredBy) : null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await logAudit(tx, companyId, actorId, "CREATE", "PurchaseOrder", po.id, null, po);
      return po;
    });

    revalidatePath("/purchase/po");
    return { success: true, po: result };
  } catch (err: any) {
    console.error("Error creating PO:", err);
    return { success: false, error: err.message || "Failed to create PO" };
  }
}

export async function submitForApproval(poId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.purchaseOrder.findFirst({
      where: { id: poId, companyId },
    });
    if (!original) return { success: false, error: "PO not found" };

    const updated = await db.$transaction(async (tx) => {
      // 1. Freeze terms first to ensure validation passes before submit
      await freezePOTerms(tx, poId, companyId);

      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: PoStatus.PENDING_APPROVAL },
      });
      await logAudit(tx, companyId, actorId, "SUBMIT_APPROVAL", "PurchaseOrder", poId, original, po);
      return po;
    });

    revalidatePath("/purchase/po");
    return { success: true, po: updated };
  } catch (err: any) {
    console.error("Error submitting PO for approval:", err);
    return { success: false, error: err.message || "Failed to submit PO" };
  }
}

export async function approvePO(poId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const userRole = (session.user as any).role || "VIEWER";

  try {
    const po = await db.purchaseOrder.findFirst({
      where: { id: poId, companyId },
      include: { lines: true },
    });
    if (!po) return { success: false, error: "PO not found" };

    // Run server-side value approval limit check
    const totalVal = calculateTotalValue(po.lines);
    const limit = APPROVAL_LIMITS[userRole] || 0;

    if (totalVal > limit) {
      return { 
        success: false, 
        error: `Your approval limit is ₹${limit.toLocaleString("en-IN")}. This PO total value is ₹${totalVal.toLocaleString("en-IN")}. Please escalate to a higher authority.` 
      };
    }

    const result = await db.$transaction(async (tx) => {
      // Ensure terms are frozen (if preset is selected and not already frozen)
      await freezePOTerms(tx, poId, companyId);

      const updated = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: PoStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date(),
        },
      });

      await logAudit(tx, companyId, actorId, "APPROVE", "PurchaseOrder", poId, po, updated);
      return updated;
    });

    revalidatePath("/purchase/po");
    return { success: true, po: result };
  } catch (err: any) {
    console.error("Error approving PO:", err);
    return { success: false, error: err.message || "Failed to approve PO" };
  }
}

export async function amendPO(
  poId: string,
  data: {
    reason: string;
    paymentTerms?: string | null;
    freightTerms?: string | null;
    deliveryDate?: string | null;
    shipTo?: string | null;
    termsConditions?: string | null;
    termsPresetId?: string | null;
    lines: { itemId: string; qty: number; rate: number; discount: number; gstRate: number }[];
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const userRole = (session.user as any).role || "VIEWER";

  try {
    const po = await db.purchaseOrder.findFirst({
      where: { id: poId, companyId },
      include: { lines: true },
    });
    if (!po) return { success: false, error: "PO not found" };

    const newTotalVal = calculateTotalValue(data.lines);
    const userLimit = APPROVAL_LIMITS[userRole] || 0;
    const shouldReTriggerApproval = newTotalVal > userLimit || po.status === PoStatus.APPROVED;

    const result = await db.$transaction(async (tx) => {
      // 1. Create amendment record snapshot
      await tx.poAmendment.create({
        data: {
          poId,
          version: po.version,
          reason: data.reason,
          snapshot: JSON.parse(JSON.stringify({
            status: po.status,
            deliveryDate: po.deliveryDate,
            paymentTerms: po.paymentTerms,
            freightTerms: po.freightTerms,
            shipTo: po.shipTo,
            termsConditions: po.termsConditions,
            termsPresetId: po.termsPresetId,
            resolvedTermsText: po.resolvedTermsText,
            termsVersion: po.termsVersion,
            lines: po.lines,
          })),
          createdById: actorId,
        },
      });

      // 2. Delete current lines
      await tx.poLine.deleteMany({
        where: { poId },
      });

      // 3. Update PO header version and status, clearing previous frozen terms so they re-resolve on next submit/approval
      const updated = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          version: po.version + 1,
          status: shouldReTriggerApproval ? PoStatus.PENDING_APPROVAL : PoStatus.APPROVED,
          paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : po.paymentTerms,
          freightTerms: data.freightTerms !== undefined ? data.freightTerms : po.freightTerms,
          deliveryDate: data.deliveryDate !== undefined ? (data.deliveryDate ? new Date(data.deliveryDate) : null) : po.deliveryDate,
          shipTo: data.shipTo !== undefined ? data.shipTo : po.shipTo,
          termsConditions: data.termsConditions !== undefined ? data.termsConditions : po.termsConditions,
          termsPresetId: data.termsPresetId !== undefined ? data.termsPresetId : po.termsPresetId,
          resolvedTermsText: null, // Clear frozen text
          termsVersion: null,
          lines: {
            create: data.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await logAudit(tx, companyId, actorId, "AMEND", "PurchaseOrder", poId, po, updated);
      return updated;
    });

    revalidatePath("/purchase/po");
    return { success: true, po: result };
  } catch (err: any) {
    console.error("Error amending PO:", err);
    return { success: false, error: err.message || "Failed to amend PO" };
  }
}

export async function cancelPO(poId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.purchaseOrder.findFirst({
      where: { id: poId, companyId },
    });
    if (!original) return { success: false, error: "PO not found" };

    const isDraft = original.status === PoStatus.DRAFT;

    const result = await db.$transaction(async (tx) => {
      // Release linked PR lines so they can be ordered again
      const poLines = await tx.poLine.findMany({
        where: { poId }
      });
      const prLineIds = poLines.map((l: any) => l.prLineId).filter(Boolean) as string[];
      if (prLineIds.length > 0) {
        await tx.prLine.updateMany({
          where: { id: { in: prLineIds } },
          data: { poRaised: false }
        });
      }

      if (isDraft) {
        // Delete poLines first due to foreign keys
        await tx.poLine.deleteMany({
          where: { poId }
        });

        // Delete poAmendments (if any exist)
        await tx.poAmendment.deleteMany({
          where: { poId }
        });

        // Delete the PurchaseOrder itself
        const deletedPo = await tx.purchaseOrder.delete({
          where: { id: poId }
        });

        await logAudit(tx, companyId, actorId, "DELETE", "PurchaseOrder", poId, original, null);
        return deletedPo;
      } else {
        const po = await tx.purchaseOrder.update({
          where: { id: poId },
          data: { status: PoStatus.CANCELLED },
        });

        await logAudit(tx, companyId, actorId, "CANCEL", "PurchaseOrder", poId, original, po);
        return po;
      }
    });

    revalidatePath("/purchase/po");
    return { success: true, po: result };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to cancel PO" };
  }
}

