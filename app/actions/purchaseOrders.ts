"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PoType, PoStatus, PrStatus, IndentStatus, LineStatus, RfqLineStatus, RfqStatus, PaymentRequestStatus, PaymentRequestType } from "@prisma/client";
import { resolvePoTerms } from "@/lib/termsResolver";

const poLineSchema = z.object({
  itemId: z.string(),
  qty: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  gstRate: z.number().nonnegative().default(0),
  requiredBy: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
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
  otherCharges: z.number().nonnegative().default(0),
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

function calculateTotalValue(
  lines: { qty: number; rate: number; discount: number; gstRate: number }[],
  otherCharges = 0
) {
  const totalTaxable = lines.reduce((sum, line) => {
    return sum + line.qty * line.rate * (1 - line.discount / 100);
  }, 0);

  return lines.reduce((sum, line) => {
    const taxable = line.qty * line.rate * (1 - line.discount / 100);
    const allocatedOtherCharges = totalTaxable > 0 ? otherCharges * (taxable / totalTaxable) : 0;
    const landed = (taxable + allocatedOtherCharges) * (1 + line.gstRate / 100);
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
          otherCharges: validated.otherCharges,
          version: 1,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              requiredBy: l.requiredBy ? new Date(l.requiredBy) : null,
              brand: l.brand || null,
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

async function getNextSequenceTx(
  tx: any,
  companyId: string,
  docType: "PAY" | "PRQ"
): Promise<string> {
  const sequence = await tx.docSequence.upsert({
    where: {
      companyId_docType: {
        companyId,
        docType,
      },
    },
    update: {
      nextValue: {
        increment: 1,
      },
    },
    create: {
      companyId,
      docType,
      nextValue: 2,
    },
  });
  const currentValue = sequence.nextValue - 1;
  const paddedValue = String(currentValue).padStart(5, "0");
  return `${docType}-${paddedValue}`;
}

function isAdvancePaymentTerm(terms: string | null | undefined): boolean {
  if (!terms) return false;
  const normalized = terms.trim().toLowerCase();
  return (
    normalized === "adv" ||
    normalized === "advance" ||
    normalized === "advance payment" ||
    normalized === "net 0" ||
    normalized === "net0" ||
    normalized.includes("advance") ||
    /net\s*0/i.test(normalized)
  );
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

    if (po.status === PoStatus.APPROVED) {
      return { success: false, error: "PO is already approved" };
    }

    // Run server-side value approval limit check
    const totalVal = calculateTotalValue(po.lines, po.otherCharges);
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

      // Check if PO payment terms qualify for automatic advance payment request creation
      if (isAdvancePaymentTerm(po.paymentTerms)) {
        // Prevent duplicate generation by checking if a request for this PO already exists
        const existingRequest = await tx.paymentRequest.findFirst({
          where: {
            companyId,
            poId: poId,
            type: PaymentRequestType.ADVANCE,
          },
        });

        if (!existingRequest) {
          const number = await getNextSequenceTx(tx, companyId, "PRQ");
          const prq = await tx.paymentRequest.create({
            data: {
              companyId,
              number,
              vendorId: po.vendorId,
              poId: poId,
              grnId: null,
              type: PaymentRequestType.ADVANCE,
              amount: totalVal,
              remarks: `Automatic advance request from PO ${po.number}`,
              status: PaymentRequestStatus.PENDING,
              recordedById: actorId,
            },
          });
          await logAudit(tx, companyId, actorId, "CREATE_PAYMENT_REQUEST", "PaymentRequest", prq.id, null, prq);
        }
      }

      return updated;
    });

    revalidatePath("/purchase/po");
    revalidatePath("/purchase/payments");
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
    otherCharges?: number;
    lines: { itemId: string; qty: number; rate: number; discount: number; gstRate: number; brand?: string | null }[];
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

    const otherChargesVal = data.otherCharges !== undefined ? data.otherCharges : po.otherCharges;
    const newTotalVal = calculateTotalValue(data.lines, otherChargesVal);
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
            otherCharges: po.otherCharges,
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
          otherCharges: otherChargesVal,
          resolvedTermsText: null, // Clear frozen text
          termsVersion: null,
          lines: {
            create: data.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              brand: l.brand || null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      // 4. Handle automatic Advance Payment Request creation or updates based on amended values
      const updatedStatus = shouldReTriggerApproval ? PoStatus.PENDING_APPROVAL : PoStatus.APPROVED;
      const isAdvance = isAdvancePaymentTerm(data.paymentTerms !== undefined ? data.paymentTerms : po.paymentTerms);
      
      if (isAdvance) {
        const existingRequest = await tx.paymentRequest.findFirst({
          where: {
            companyId,
            poId: poId,
            type: PaymentRequestType.ADVANCE,
          },
        });

        if (existingRequest) {
          // If it is not paid yet, update the amount to match the new PO total value
          if (existingRequest.status !== PaymentRequestStatus.PAID) {
            const updatedPrq = await tx.paymentRequest.update({
              where: { id: existingRequest.id },
              data: {
                amount: newTotalVal,
                remarks: `${existingRequest.remarks || ""}\n[Updated automatically via PO Amendment to match new PO total value of ₹${newTotalVal.toLocaleString("en-IN")}]`.trim()
              }
            });
            await logAudit(tx, companyId, actorId, "UPDATE_PAYMENT_REQUEST", "PaymentRequest", existingRequest.id, existingRequest, updatedPrq);
          }
        } else if (updatedStatus === PoStatus.APPROVED) {
          // If it doesn't exist and PO is auto-approved, create it
          const number = await getNextSequenceTx(tx, companyId, "PRQ");
          const prq = await tx.paymentRequest.create({
            data: {
              companyId,
              number,
              vendorId: po.vendorId,
              poId: poId,
              grnId: null,
              type: PaymentRequestType.ADVANCE,
              amount: newTotalVal,
              remarks: `Automatic advance request from PO ${po.number} (Amended)`,
              status: PaymentRequestStatus.PENDING,
              recordedById: actorId,
            },
          });
          await logAudit(tx, companyId, actorId, "CREATE_PAYMENT_REQUEST", "PaymentRequest", prq.id, null, prq);
        }
      } else {
        // If the amended PO no longer has advance payment terms, delete any pending advance request
        const existingRequest = await tx.paymentRequest.findFirst({
          where: {
            companyId,
            poId: poId,
            type: PaymentRequestType.ADVANCE,
            status: PaymentRequestStatus.PENDING
          },
        });
        if (existingRequest) {
          await tx.paymentRequest.delete({
            where: { id: existingRequest.id }
          });
          await logAudit(tx, companyId, actorId, "DELETE_PAYMENT_REQUEST", "PaymentRequest", existingRequest.id, existingRequest, null);
        }
      }

      await logAudit(tx, companyId, actorId, "AMEND", "PurchaseOrder", poId, po, updated);
      return updated;
    });

    revalidatePath("/purchase/po");
    revalidatePath("/purchase/payments");
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
      // 1. Fetch poLines
      const poLines = await tx.poLine.findMany({
        where: { poId }
      });

      // 2. Roll back quantities and delete allocations
      for (const poLine of poLines) {
        // Delete award allocations linked to this poLine
        await tx.awardAllocation.deleteMany({
          where: { poLineId: poLine.id, companyId }
        });

        // Decrement awardedQty on RfqLine
        if (poLine.rfqLineId) {
          const rfqLine = await tx.rfqLine.findUnique({
            where: { id: poLine.rfqLineId }
          });
          if (rfqLine) {
            const newAwardedQty = Math.max(0, rfqLine.awardedQty - poLine.qty);
            await tx.rfqLine.update({
              where: { id: rfqLine.id },
              data: { awardedQty: newAwardedQty }
            });
          }
        }

        // Decrement orderedQty on PrLine
        if (poLine.prLineId) {
          const prLine = await tx.prLine.findUnique({
            where: { id: poLine.prLineId }
          });
          if (prLine) {
            const newOrderedQty = Math.max(0, prLine.orderedQty - poLine.qty);
            await tx.prLine.update({
              where: { id: prLine.id },
              data: { orderedQty: newOrderedQty }
            });

            // Decrement orderedQty on IndentLines linked to this prLine
            const indentLines = await tx.indentLine.findMany({
              where: { prLineId: prLine.id }
            });
            for (const indLine of indentLines) {
              const newIndOrderedQty = Math.max(0, indLine.orderedQty - poLine.qty);
              await tx.indentLine.update({
                where: { id: indLine.id },
                data: { orderedQty: newIndOrderedQty }
              });
            }
          }
        }
      }

      // 3. Recompute statuses
      const rfqLineIds = Array.from(new Set(poLines.map((l: any) => l.rfqLineId).filter(Boolean))) as string[];
      const prLineIds = Array.from(new Set(poLines.map((l: any) => l.prLineId).filter(Boolean))) as string[];

      // Recompute RfqLines status
      for (const rfqLineId of rfqLineIds) {
        const freshRfqLine = await tx.rfqLine.findUnique({
          where: { id: rfqLineId },
          include: { quotationLines: true }
        });
        if (freshRfqLine) {
          const rfqLineAllocations = await tx.awardAllocation.findMany({
            where: { rfqLineId: freshRfqLine.id, companyId }
          });
          const totalAllocated = rfqLineAllocations.reduce((sum: number, a: any) => sum + a.qty, 0);

          let rfqLineStatus: RfqLineStatus = RfqLineStatus.OPEN;
          if (totalAllocated >= freshRfqLine.qty) {
            rfqLineStatus = RfqLineStatus.CLOSED;
          } else if (totalAllocated > 0) {
            rfqLineStatus = RfqLineStatus.PARTIALLY_AWARDED;
          } else {
            const activeQuotes = freshRfqLine.quotationLines.filter((q: any) => q.canSupply);
            if (activeQuotes.length === 0) {
              rfqLineStatus = RfqLineStatus.UNCOVERED;
            } else {
              const totalAvailable = activeQuotes.reduce((sum: number, q: any) => sum + (q.quotedQty ?? freshRfqLine.qty), 0);
              if (totalAvailable < freshRfqLine.qty) {
                rfqLineStatus = RfqLineStatus.SHORT;
              } else {
                rfqLineStatus = RfqLineStatus.QUOTED;
              }
            }
          }

          await tx.rfqLine.update({
            where: { id: freshRfqLine.id },
            data: { status: rfqLineStatus }
          });
        }
      }

      // Recompute PrLines and IndentLines statuses
      for (const prLineId of prLineIds) {
        const prLine = await tx.prLine.findUnique({
          where: { id: prLineId }
        });
        if (prLine) {
          const open = prLine.qty - prLine.orderedQty - prLine.shortClosedQty;
          let prLineStatus: LineStatus = LineStatus.OPEN;
          if (open <= 0) {
            prLineStatus = prLine.shortClosedQty === prLine.qty ? LineStatus.SHORT_CLOSED : LineStatus.ORDERED;
          } else if (prLine.orderedQty > 0) {
            prLineStatus = LineStatus.PARTIALLY_ORDERED;
          }

          await tx.prLine.update({
            where: { id: prLine.id },
            data: { status: prLineStatus, poRaised: open <= 0 }
          });

          // Recompute IndentLines statuses linked to this prLine
          const indentLines = await tx.indentLine.findMany({
            where: { prLineId: prLine.id }
          });
          for (const indentLine of indentLines) {
            const openInd = indentLine.qty - indentLine.orderedQty - indentLine.issuedQty - indentLine.shortClosedQty;
            let indentLineStatus: LineStatus = LineStatus.OPEN;
            if (openInd <= 0) {
              if (indentLine.shortClosedQty === indentLine.qty) {
                indentLineStatus = LineStatus.SHORT_CLOSED;
              } else if (indentLine.issuedQty >= indentLine.qty - indentLine.shortClosedQty) {
                indentLineStatus = LineStatus.ISSUED;
              } else {
                indentLineStatus = LineStatus.ORDERED;
              }
            } else if (indentLine.orderedQty > 0 || indentLine.issuedQty > 0) {
              indentLineStatus = LineStatus.PARTIALLY_ORDERED;
            }

            await tx.indentLine.update({
              where: { id: indentLine.id },
              data: { status: indentLineStatus }
            });
          }
        }
      }

      // 4. Recompute parent header statuses
      // RFQ headers
      const rfqLinesForHeader = await tx.rfqLine.findMany({
        where: { id: { in: rfqLineIds } }
      });
      const rfqIds = Array.from(new Set(rfqLinesForHeader.map((rl: any) => rl.rfqId))) as string[];

      for (const rfqId of rfqIds) {
        const freshRfqLines = await tx.rfqLine.findMany({
          where: { rfqId }
        });
        const freshRfqLineIds = freshRfqLines.map((l) => l.id);
        const rfqAllocations = await tx.awardAllocation.findMany({
          where: { rfqLineId: { in: freshRfqLineIds }, companyId }
        });

        let nextRfqStatus: RfqStatus = RfqStatus.AWARDED;
        if (rfqAllocations.length === 0) {
          nextRfqStatus = RfqStatus.QUOTES_RECEIVED;
        } else {
          const allRfqLinesClosed = freshRfqLines.every((l) => {
            const lineAllocs = rfqAllocations.filter((a) => a.rfqLineId === l.id);
            const totalAlloc = lineAllocs.reduce((sum, a) => sum + a.qty, 0);
            return totalAlloc >= l.qty;
          });
          if (allRfqLinesClosed) {
            nextRfqStatus = RfqStatus.CLOSED;
          } else {
            nextRfqStatus = RfqStatus.AWARDED;
          }
        }

        await tx.rfq.update({
          where: { id: rfqId },
          data: { status: nextRfqStatus }
        });

        // Recalculate quotation.awarded for this RFQ
        const quotations = await tx.quotation.findMany({
          where: { rfqId }
        });
        for (const q of quotations) {
          const hasAlloc = rfqAllocations.some((a) => a.vendorId === q.vendorId);
          await tx.quotation.update({
            where: { id: q.id },
            data: { awarded: hasAlloc }
          });
        }
      }

      // PR headers
      const prLinesForHeader = await tx.prLine.findMany({
        where: { id: { in: prLineIds } }
      });
      const prIds = Array.from(new Set(prLinesForHeader.map((pl: any) => pl.prId))) as string[];

      for (const prId of prIds) {
        const pr = await tx.purchaseRequisition.findUnique({
          where: { id: prId },
          include: { lines: true }
        });
        if (pr) {
          const allPrLinesTerminal = pr.lines.every((l) =>
            ([LineStatus.ORDERED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
          );
          const somePrLinesOrdered = pr.lines.some((l) =>
            ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED] as LineStatus[]).includes(l.status)
          );

          let nextPrStatus: PrStatus = PrStatus.RFQ_ISSUED;
          if (allPrLinesTerminal) {
            const allShortClosed = pr.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
            nextPrStatus = allShortClosed ? PrStatus.SHORT_CLOSED : PrStatus.CLOSED;
          } else if (somePrLinesOrdered) {
            nextPrStatus = PrStatus.PARTIALLY_ORDERED;
          }

          await tx.purchaseRequisition.update({
            where: { id: pr.id },
            data: { status: nextPrStatus }
          });
        }
      }

      // Indent headers
      const affectedIndentLines = await tx.indentLine.findMany({
        where: { prLineId: { in: prLineIds } }
      });
      const indentIds = Array.from(new Set(affectedIndentLines.map((il: any) => il.indentId).filter(Boolean))) as string[];

      for (const indentId of indentIds) {
        const indent = await tx.indent.findUnique({
          where: { id: indentId },
          include: { lines: true }
        });
        if (indent) {
          const allIndentLinesTerminal = indent.lines.every((l) =>
            ([LineStatus.ORDERED, LineStatus.ISSUED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
          );
          const someIndentLinesOrdered = indent.lines.some((l) =>
            ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED, LineStatus.ISSUED] as LineStatus[]).includes(l.status)
          );

          let nextIndentStatus: IndentStatus = IndentStatus.CONVERTED_TO_PR;
          if (allIndentLinesTerminal) {
            const allShortClosed = indent.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
            nextIndentStatus = allShortClosed ? IndentStatus.SHORT_CLOSED : IndentStatus.CLOSED;
          } else if (someIndentLinesOrdered) {
            nextIndentStatus = IndentStatus.PARTIALLY_ORDERED;
          }

          await tx.indent.update({
            where: { id: indent.id },
            data: { status: nextIndentStatus }
          });
        }
      }

      // 5. Delete or update PO
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

export async function shortClosePO(poId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.purchaseOrder.findFirst({
      where: { id: poId, companyId },
    });
    if (!original) return { success: false, error: "PO not found" };

    const activeStatuses = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];
    if (!activeStatuses.includes(original.status)) {
      return { success: false, error: `Only POs with status APPROVED, SENT, or PARTIALLY_RECEIVED can be short-closed.` };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Fetch poLines
      const poLines = await tx.poLine.findMany({
        where: { poId }
      });

      // 2. Adjust quantities and allocations
      for (const poLine of poLines) {
        const unreceivedQty = Math.max(0, poLine.qty - poLine.receivedQty);
        if (unreceivedQty <= 0) continue;

        // Adjust or delete award allocations linked to this poLine
        const rfqLineAllocations = await tx.awardAllocation.findMany({
          where: { poLineId: poLine.id, companyId }
        });
        for (const alloc of rfqLineAllocations) {
          if (poLine.receivedQty > 0) {
            await tx.awardAllocation.update({
              where: { id: alloc.id },
              data: { qty: poLine.receivedQty }
            });
          } else {
            await tx.awardAllocation.delete({
              where: { id: alloc.id }
            });
          }
        }

        // Decrement awardedQty on RfqLine
        if (poLine.rfqLineId) {
          const rfqLine = await tx.rfqLine.findUnique({
            where: { id: poLine.rfqLineId }
          });
          if (rfqLine) {
            const newAwardedQty = Math.max(0, rfqLine.awardedQty - unreceivedQty);
            await tx.rfqLine.update({
              where: { id: rfqLine.id },
              data: { awardedQty: newAwardedQty }
            });
          }
        }

        // Decrement orderedQty on PrLine
        if (poLine.prLineId) {
          const prLine = await tx.prLine.findUnique({
            where: { id: poLine.prLineId }
          });
          if (prLine) {
            const newOrderedQty = Math.max(0, prLine.orderedQty - unreceivedQty);
            await tx.prLine.update({
              where: { id: prLine.id },
              data: { orderedQty: newOrderedQty }
            });

            // Decrement orderedQty on IndentLines linked to this prLine
            const indentLines = await tx.indentLine.findMany({
              where: { prLineId: prLine.id }
            });
            for (const indLine of indentLines) {
              const newIndOrderedQty = Math.max(0, indLine.orderedQty - unreceivedQty);
              await tx.indentLine.update({
                where: { id: indLine.id },
                data: { orderedQty: newIndOrderedQty }
              });
            }
          }
        }
      }

      // 3. Recompute statuses
      const rfqLineIds = Array.from(new Set(poLines.map((l: any) => l.rfqLineId).filter(Boolean))) as string[];
      const prLineIds = Array.from(new Set(poLines.map((l: any) => l.prLineId).filter(Boolean))) as string[];

      // Recompute RfqLines status
      for (const rfqLineId of rfqLineIds) {
        const freshRfqLine = await tx.rfqLine.findUnique({
          where: { id: rfqLineId },
          include: { quotationLines: true }
        });
        if (freshRfqLine) {
          const rfqLineAllocations = await tx.awardAllocation.findMany({
            where: { rfqLineId: freshRfqLine.id, companyId }
          });
          const totalAllocated = rfqLineAllocations.reduce((sum: number, a: any) => sum + a.qty, 0);

          let rfqLineStatus: RfqLineStatus = RfqLineStatus.OPEN;
          if (totalAllocated >= freshRfqLine.qty) {
            rfqLineStatus = RfqLineStatus.CLOSED;
          } else if (totalAllocated > 0) {
            rfqLineStatus = RfqLineStatus.PARTIALLY_AWARDED;
          } else {
            const activeQuotes = freshRfqLine.quotationLines.filter((q: any) => q.canSupply);
            if (activeQuotes.length === 0) {
              rfqLineStatus = RfqLineStatus.UNCOVERED;
            } else {
              const totalAvailable = activeQuotes.reduce((sum: number, q: any) => sum + (q.quotedQty ?? freshRfqLine.qty), 0);
              if (totalAvailable < freshRfqLine.qty) {
                rfqLineStatus = RfqLineStatus.SHORT;
              } else {
                rfqLineStatus = RfqLineStatus.QUOTED;
              }
            }
          }

          await tx.rfqLine.update({
            where: { id: freshRfqLine.id },
            data: { status: rfqLineStatus }
          });
        }
      }

      // Recompute PrLines and IndentLines statuses
      for (const prLineId of prLineIds) {
        const prLine = await tx.prLine.findUnique({
          where: { id: prLineId }
        });
        if (prLine) {
          const open = prLine.qty - prLine.orderedQty - prLine.shortClosedQty;
          let prLineStatus: LineStatus = LineStatus.OPEN;
          if (open <= 0) {
            prLineStatus = prLine.shortClosedQty === prLine.qty ? LineStatus.SHORT_CLOSED : LineStatus.ORDERED;
          } else if (prLine.orderedQty > 0) {
            prLineStatus = LineStatus.PARTIALLY_ORDERED;
          }

          await tx.prLine.update({
            where: { id: prLine.id },
            data: { status: prLineStatus, poRaised: open <= 0 }
          });

          // Recompute IndentLines statuses linked to this prLine
          const indentLines = await tx.indentLine.findMany({
            where: { prLineId: prLine.id }
          });
          for (const indentLine of indentLines) {
            const openInd = indentLine.qty - indentLine.orderedQty - indentLine.issuedQty - indentLine.shortClosedQty;
            let indentLineStatus: LineStatus = LineStatus.OPEN;
            if (openInd <= 0) {
              if (indentLine.shortClosedQty === indentLine.qty) {
                indentLineStatus = LineStatus.SHORT_CLOSED;
              } else if (indentLine.issuedQty >= indentLine.qty - indentLine.shortClosedQty) {
                indentLineStatus = LineStatus.ISSUED;
              } else {
                indentLineStatus = LineStatus.ORDERED;
              }
            } else if (indentLine.orderedQty > 0 || indentLine.issuedQty > 0) {
              indentLineStatus = LineStatus.PARTIALLY_ORDERED;
            }

            await tx.indentLine.update({
              where: { id: indentLine.id },
              data: { status: indentLineStatus }
            });
          }
        }
      }

      // 4. Recompute parent header statuses
      // RFQ headers
      const rfqLinesForHeader = await tx.rfqLine.findMany({
        where: { id: { in: rfqLineIds } }
      });
      const rfqIds = Array.from(new Set(rfqLinesForHeader.map((rl: any) => rl.rfqId))) as string[];

      for (const rfqId of rfqIds) {
        const freshRfqLines = await tx.rfqLine.findMany({
          where: { rfqId }
        });
        const freshRfqLineIds = freshRfqLines.map((l) => l.id);
        const rfqAllocations = await tx.awardAllocation.findMany({
          where: { rfqLineId: { in: freshRfqLineIds }, companyId }
        });

        let nextRfqStatus: RfqStatus = RfqStatus.AWARDED;
        if (rfqAllocations.length === 0) {
          nextRfqStatus = RfqStatus.QUOTES_RECEIVED;
        } else {
          const allRfqLinesClosed = freshRfqLines.every((l) => {
            const lineAllocs = rfqAllocations.filter((a) => a.rfqLineId === l.id);
            const totalAlloc = lineAllocs.reduce((sum, a) => sum + a.qty, 0);
            return totalAlloc >= l.qty;
          });
          if (allRfqLinesClosed) {
            nextRfqStatus = RfqStatus.CLOSED;
          } else {
            nextRfqStatus = RfqStatus.AWARDED;
          }
        }

        await tx.rfq.update({
          where: { id: rfqId },
          data: { status: nextRfqStatus }
        });

        // Recalculate quotation.awarded for this RFQ
        const quotations = await tx.quotation.findMany({
          where: { rfqId }
        });
        for (const q of quotations) {
          const hasAlloc = rfqAllocations.some((a) => a.vendorId === q.vendorId);
          await tx.quotation.update({
            where: { id: q.id },
            data: { awarded: hasAlloc }
          });
        }
      }

      // PR headers
      const prLinesForHeader = await tx.prLine.findMany({
        where: { id: { in: prLineIds } }
      });
      const prIds = Array.from(new Set(prLinesForHeader.map((pl: any) => pl.prId))) as string[];

      for (const prId of prIds) {
        const pr = await tx.purchaseRequisition.findUnique({
          where: { id: prId },
          include: { lines: true }
        });
        if (pr) {
          const allPrLinesTerminal = pr.lines.every((l) =>
            ([LineStatus.ORDERED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
          );
          const somePrLinesOrdered = pr.lines.some((l) =>
            ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED] as LineStatus[]).includes(l.status)
          );

          let nextPrStatus: PrStatus = PrStatus.RFQ_ISSUED;
          if (allPrLinesTerminal) {
            const allShortClosed = pr.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
            nextPrStatus = allShortClosed ? PrStatus.SHORT_CLOSED : PrStatus.CLOSED;
          } else if (somePrLinesOrdered) {
            nextPrStatus = PrStatus.PARTIALLY_ORDERED;
          }

          await tx.purchaseRequisition.update({
            where: { id: pr.id },
            data: { status: nextPrStatus }
          });
        }
      }

      // Indent headers
      const affectedIndentLines = await tx.indentLine.findMany({
        where: { prLineId: { in: prLineIds } }
      });
      const indentIds = Array.from(new Set(affectedIndentLines.map((il: any) => il.indentId).filter(Boolean))) as string[];

      for (const indentId of indentIds) {
        const indent = await tx.indent.findUnique({
          where: { id: indentId },
          include: { lines: true }
        });
        if (indent) {
          const allIndentLinesTerminal = indent.lines.every((l) =>
            ([LineStatus.ORDERED, LineStatus.ISSUED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
          );
          const someIndentLinesOrdered = indent.lines.some((l) =>
            ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED, LineStatus.ISSUED] as LineStatus[]).includes(l.status)
          );

          let nextIndentStatus: IndentStatus = IndentStatus.CONVERTED_TO_PR;
          if (allIndentLinesTerminal) {
            const allShortClosed = indent.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
            nextIndentStatus = allShortClosed ? IndentStatus.SHORT_CLOSED : IndentStatus.CLOSED;
          } else if (someIndentLinesOrdered) {
            nextIndentStatus = IndentStatus.PARTIALLY_ORDERED;
          }

          await tx.indent.update({
            where: { id: indent.id },
            data: { status: nextIndentStatus }
          });
        }
      }

      // 5. Update PO status to SHORT_CLOSED
      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: PoStatus.SHORT_CLOSED },
      });

      await logAudit(tx, companyId, actorId, "SHORT_CLOSE", "PurchaseOrder", poId, original, po);
      return po;
    });

    revalidatePath("/purchase/po");
    return { success: true, po: result };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to short-close PO" };
  }
}

export async function updatePO(poId: string, data: z.infer<typeof poSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = poSchema.parse(data);

    const original = await db.purchaseOrder.findFirst({
      where: { id: poId, companyId },
      include: { lines: true }
    });
    if (!original) return { success: false, error: "Purchase Order not found" };

    if (!["DRAFT", "PENDING_APPROVAL"].includes(original.status)) {
      return { success: false, error: "Only Draft or Pending Approval POs can be edited" };
    }

    const result = await db.$transaction(async (tx) => {
      // Delete existing lines
      await tx.poLine.deleteMany({
        where: { poId }
      });

      // Update PO and create new lines
      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          vendorId: validated.vendorId,
          type: validated.type,
          status: PoStatus.DRAFT, // Reset status to DRAFT on edit
          deliveryDate: validated.deliveryDate ? new Date(validated.deliveryDate) : null,
          paymentTerms: validated.paymentTerms || null,
          freightTerms: validated.freightTerms || null,
          shipTo: validated.shipTo || null,
          termsConditions: validated.termsConditions || null,
          termsPresetId: validated.termsPresetId || null,
          rateContractExpiry: validated.rateContractExpiry ? new Date(validated.rateContractExpiry) : null,
          prId: validated.rfqId || null,
          otherCharges: validated.otherCharges,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              requiredBy: l.requiredBy ? new Date(l.requiredBy) : null,
              brand: l.brand || null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await logAudit(tx, companyId, actorId, "UPDATE", "PurchaseOrder", po.id, original, po);
      return po;
    });

    revalidatePath("/purchase/po");
    return { success: true, po: result };
  } catch (err: any) {
    console.error("Error updating PO:", err);
    return { success: false, error: err.message || "Failed to update PO" };
  }
}


