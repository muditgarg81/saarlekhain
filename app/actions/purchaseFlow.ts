"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { IndentStatus, PrStatus, RfqStatus, PoStatus, PoType } from "@prisma/client";

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

/**
 * Converts approved Indent lines to a Purchase Requisition (PR).
 */
export async function convertIndentToPR(
  indentId: string,
  lineQtys: { lineId: string; qty: number }[],
  targetPrId?: string | null
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const indent = await db.indent.findFirst({
      where: { id: indentId, companyId },
      include: { lines: true }
    });
    if (!indent) return { success: false, error: "Indent not found" };
    if (indent.status !== IndentStatus.APPROVED && indent.status !== IndentStatus.PARTIALLY_ISSUED) {
      return { success: false, error: "Indent is not in approved state" };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Check idempotency using sorted line IDs to form a stable key
      const sortedLineIds = lineQtys.map(l => l.lineId).sort().join(",");
      const idempotencyKey = `indent-to-pr-${indentId}-${sortedLineIds}`;
      const existingConv = await tx.flowConversion.findFirst({
        where: { companyId, idempotencyKey }
      });
      if (existingConv) {
        return { success: true, alreadyRun: true, prId: existingConv.sourceId };
      }

      // 2. Find or create target PR
      let pr;
      if (targetPrId) {
        pr = await tx.purchaseRequisition.findFirst({
          where: { id: targetPrId, companyId },
          include: { lines: true }
        });
        if (!pr) throw new Error("Target PR not found");
        if (pr.status !== PrStatus.DRAFT) throw new Error("Target PR is not in DRAFT status");
      } else {
        const prNumber = await getNextSequence(companyId, "PR");
        pr = await tx.purchaseRequisition.create({
          data: {
            companyId,
            number: prNumber,
            status: PrStatus.DRAFT,
            indentId: indentId
          },
          include: { lines: true }
        });
      }

      // 3. Process lines
      for (const lineQty of lineQtys) {
        const line = indent.lines.find(l => l.id === lineQty.lineId);
        if (!line) throw new Error(`Indent line ${lineQty.lineId} not found`);
        
        // Ensure we don't convert more than purchaseQty
        // (if purchaseQty is 0, initialize it to the remaining shortage: qty - issuedQty)
        const currentPurchaseQty = line.purchaseQty > 0 ? line.purchaseQty : (line.qty - line.issuedQty);
        
        // Find if already converted in DB
        if (line.prLineId) {
          throw new Error(`Line for item ${line.itemId} is already converted to PR`);
        }

        if (lineQty.qty > currentPurchaseQty) {
          throw new Error(`Quantity ${lineQty.qty} exceeds available purchase quantity ${currentPurchaseQty}`);
        }

        // Update IndentLine.purchaseQty (record the amount being routed to purchase)
        await tx.indentLine.update({
          where: { id: line.id },
          data: { purchaseQty: currentPurchaseQty }
        });

        // Find or create PR Line for this item
        let prLine = pr.lines.find(pl => pl.itemId === line.itemId);
        if (prLine) {
          prLine = await tx.prLine.update({
            where: { id: prLine.id },
            data: { qty: prLine.qty + lineQty.qty }
          });
        } else {
          prLine = await tx.prLine.create({
            data: {
              prId: pr.id,
              itemId: line.itemId,
              qty: lineQty.qty,
              requiredBy: line.requiredBy
            }
          });
        }

        // Link indent line to PR Line
        await tx.indentLine.update({
          where: { id: line.id },
          data: { prLineId: prLine.id }
        });
      }

      // Update Indent status to CONVERTED_TO_PR
      await tx.indent.update({
        where: { id: indentId },
        data: { status: IndentStatus.CONVERTED_TO_PR }
      });

      // Save conversion
      await tx.flowConversion.create({
        data: {
          companyId,
          step: "INDENT_TO_PR",
          sourceId: pr.id,
          idempotencyKey
        }
      });

      await logAudit(tx, companyId, actorId, "CONVERT_INDENT_TO_PR", "PurchaseRequisition", pr.id, null, pr);
      return { success: true, prId: pr.id };
    });

    revalidatePath("/stores/indents");
    revalidatePath("/purchase/requisitions");
    return { success: true, prId: result.prId };
  } catch (err: any) {
    console.error("Error converting Indent to PR:", err);
    return { success: false, error: err.message || "Failed to convert Indent to PR" };
  }
}

/**
 * Converts approved PR lines into an RFQ.
 */
export async function raisePrToRfq(
  prId: string,
  vendorIds: string[],
  prLineIds: string[]
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const pr = await db.purchaseRequisition.findFirst({
      where: { id: prId, companyId },
      include: { lines: true }
    });
    if (!pr) return { success: false, error: "PR not found" };
    if (pr.status !== PrStatus.APPROVED) {
      return { success: false, error: "PR is not approved yet" };
    }

    const result = await db.$transaction(async (tx) => {
      // Idempotency
      const sortedLineIds = prLineIds.sort().join(",");
      const idempotencyKey = `pr-to-rfq-${prId}-${sortedLineIds}`;
      const existingConv = await tx.flowConversion.findFirst({
        where: { companyId, idempotencyKey }
      });
      if (existingConv) {
        return { success: true, alreadyRun: true, rfqId: existingConv.sourceId };
      }

      // Generate sequence code
      const rfqNumber = await getNextSequence(companyId, "RFQ");

      // Create RFQ with status ISSUED
      const rfq = await tx.rfq.create({
        data: {
          companyId,
          number: rfqNumber,
          prId,
          status: RfqStatus.ISSUED,
          lines: {
            create: pr.lines
              .filter(line => prLineIds.includes(line.id))
              .map(line => ({
                itemId: line.itemId,
                qty: line.qty,
                prLineId: line.id
              }))
          }
        },
        include: { lines: true }
      });

      // Create empty Quotation placeholders for each vendor (attaching vendors to RFQ)
      for (const vendorId of vendorIds) {
        await tx.quotation.create({
          data: {
            companyId,
            rfqId: rfq.id,
            vendorId,
            awarded: false
          }
        });
      }

      // Set PR status to RFQ_ISSUED
      await tx.purchaseRequisition.update({
        where: { id: prId },
        data: { status: PrStatus.RFQ_ISSUED }
      });

      // Save conversion
      await tx.flowConversion.create({
        data: {
          companyId,
          step: "PR_TO_RFQ",
          sourceId: rfq.id,
          idempotencyKey
        }
      });

      await logAudit(tx, companyId, actorId, "RAISE_PR_TO_RFQ", "Rfq", rfq.id, null, rfq);
      return { success: true, rfqId: rfq.id };
    });

    revalidatePath("/purchase/requisitions");
    return { success: true, rfqId: result.rfqId };
  } catch (err: any) {
    console.error("Error raising PR to RFQ:", err);
    return { success: false, error: err.message || "Failed to raise PR to RFQ" };
  }
}

/**
 * Awards quotations per RFQ line (can differ by vendor).
 */
export async function awardRfq(
  rfqId: string,
  awards: { rfqLineId: string; quotationLineId: string }[]
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const role = (session.user as any).role;

  const canApprove = ["ADMIN", "OWNER", "PURCHASE_MANAGER", "APPROVER"].includes(role);
  if (!canApprove) return { success: false, error: "Permission denied. Only Purchase Managers or Admins can award RFQs." };

  try {
    const rfq = await db.rfq.findFirst({
      where: { id: rfqId, companyId },
      include: { lines: true }
    });
    if (!rfq) return { success: false, error: "RFQ not found" };

    const result = await db.$transaction(async (tx) => {
      // Idempotency check
      const awardsHash = awards.map(a => `${a.rfqLineId}:${a.quotationLineId}`).sort().join(",");
      const idempotencyKey = `rfq-award-${rfqId}-${awardsHash}`;
      const existingConv = await tx.flowConversion.findFirst({
        where: { companyId, idempotencyKey }
      });
      if (existingConv) {
        return { success: true, alreadyRun: true };
      }

      // Reset all lines' awards first
      for (const line of rfq.lines) {
        await tx.rfqLine.update({
          where: { id: line.id },
          data: { awardedQuotationLineId: null }
        });
      }

      // Set awards for each line
      const awardedQuotationIds = new Set<string>();
      for (const award of awards) {
        const rfqLine = rfq.lines.find(l => l.id === award.rfqLineId);
        if (!rfqLine) throw new Error(`RFQ Line ${award.rfqLineId} not found`);

        // Check if the quotation line belongs to a quote for this RFQ
        const qLine = await tx.quotationLine.findFirst({
          where: { id: award.quotationLineId, quotation: { rfqId } },
          include: { quotation: true }
        });
        if (!qLine) throw new Error(`Quotation Line ${award.quotationLineId} not found for this RFQ`);

        await tx.rfqLine.update({
          where: { id: award.rfqLineId },
          data: { awardedQuotationLineId: award.quotationLineId }
        });

        // Track which quotation is awarded
        awardedQuotationIds.add(qLine.quotationId);
      }

      // Reset all quotations' awarded status for this RFQ
      await tx.quotation.updateMany({
        where: { rfqId },
        data: { awarded: false }
      });

      // Mark the awarded quotations as awarded = true
      for (const qId of awardedQuotationIds) {
        await tx.quotation.update({
          where: { id: qId },
          data: { awarded: true }
        });
      }

      // Check if all RFQ lines have been awarded
      const allAwarded = await tx.rfqLine.count({
        where: { rfqId, awardedQuotationLineId: null }
      }) === 0;

      // Update RFQ status to AWARDED (if all lines awarded)
      await tx.rfq.update({
        where: { id: rfqId },
        data: { status: allAwarded ? RfqStatus.AWARDED : RfqStatus.QUOTES_RECEIVED }
      });

      // Save conversion
      await tx.flowConversion.create({
        data: {
          companyId,
          step: "RFQ_AWARD",
          sourceId: rfqId,
          idempotencyKey
        }
      });

      await logAudit(tx, companyId, actorId, "AWARD_RFQ", "Rfq", rfqId, null, { awards });
      return { success: true };
    });

    revalidatePath("/purchase/requisitions");
    return { success: true };
  } catch (err: any) {
    console.error("Error awarding RFQ:", err);
    return { success: false, error: err.message || "Failed to award RFQ" };
  }
}

/**
 * Creates separate POs for each vendor that won lines in an awarded RFQ.
 */
export async function raisePoFromAward(
  rfqId: string,
  details?: {
    paymentTerms?: string;
    freightTerms?: string;
    shipTo?: string;
    termsConditions?: string;
    termsPresetId?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const rfq = await db.rfq.findFirst({
      where: { id: rfqId, companyId },
      include: {
        lines: {
          include: {
            awardedQuotationLine: {
              include: {
                quotation: true
              }
            }
          }
        }
      }
    });

    if (!rfq) return { success: false, error: "RFQ not found" };
    if (rfq.status !== RfqStatus.AWARDED) {
      return { success: false, error: "RFQ is not in AWARDED status. Please complete line awards first." };
    }

    const result = await db.$transaction(async (tx) => {
      // Idempotency
      const idempotencyKey = `rfq-to-po-${rfqId}`;
      const existingConv = await tx.flowConversion.findFirst({
        where: { companyId, idempotencyKey }
      });
      if (existingConv) {
        return { success: true, alreadyRun: true };
      }

      // Group RfqLines by vendorId
      const vendorGroups: { [vendorId: string]: typeof rfq.lines } = {};
      for (const line of rfq.lines) {
        if (!line.awardedQuotationLine) {
          throw new Error(`Line ${line.itemId} is not awarded`);
        }
        const vendorId = line.awardedQuotationLine.quotation.vendorId;
        if (!vendorGroups[vendorId]) {
          vendorGroups[vendorId] = [];
        }
        vendorGroups[vendorId].push(line);
      }

      const poIds: string[] = [];

      // Find default terms preset for REGULAR PO type
      const defaultPreset = await tx.poTermsPreset.findFirst({
        where: {
          OR: [
            { companyId: null },
            { companyId }
          ],
          appliesTo: { has: PoType.REGULAR },
          isDefault: true,
          status: "ACTIVE"
        }
      });

      // Create a PO for each vendor group
      for (const [vendorId, lines] of Object.entries(vendorGroups)) {
        const poNumber = await getNextSequence(companyId, "PO");

        const po = await tx.purchaseOrder.create({
          data: {
            companyId,
            number: poNumber,
            vendorId,
            status: PoStatus.PENDING_APPROVAL,
            prId: rfq.prId,
            paymentTerms: details?.paymentTerms || "Net 30",
            freightTerms: details?.freightTerms || "FOB Destination",
            shipTo: details?.shipTo || "Main Warehouse Gate 1",
            termsConditions: details?.termsConditions || null,
            termsPresetId: details?.termsPresetId !== undefined ? details.termsPresetId : (defaultPreset?.id || null),
            lines: {
              create: lines.map(line => {
                const qLine = line.awardedQuotationLine!;
                return {
                  itemId: line.itemId,
                  qty: line.qty,
                  rate: qLine.rate,
                  discount: qLine.discount,
                  gstRate: qLine.gstRate,
                  quotationLineId: qLine.id,
                  rfqLineId: line.id,
                  prLineId: line.prLineId
                };
              })
            }
          }
        });

        poIds.push(po.id);

        // Mark prLine as poRaised = true
        for (const line of lines) {
          if (line.prLineId) {
            await tx.prLine.update({
              where: { id: line.prLineId },
              data: { poRaised: true }
            });
          }
        }

        await logAudit(tx, companyId, actorId, "CREATE_PO_FROM_AWARD", "PurchaseOrder", po.id, null, po);
      }

      // Close RFQ
      await tx.rfq.update({
        where: { id: rfqId },
        data: { status: RfqStatus.CLOSED }
      });

      // Update PR status: if all lines of the PR have poRaised = true, close the PR
      if (rfq.prId) {
        const pr = await tx.purchaseRequisition.findUnique({
          where: { id: rfq.prId },
          include: { lines: true }
        });
        if (pr) {
          const allPrLinesPoRaised = pr.lines.every(l => l.poRaised);
          await tx.purchaseRequisition.update({
            where: { id: pr.id },
            data: { status: allPrLinesPoRaised ? PrStatus.CLOSED : PrStatus.RFQ_ISSUED }
          });
        }
      }

      // Save conversion
      await tx.flowConversion.create({
        data: {
          companyId,
          step: "RFQ_TO_PO",
          sourceId: rfqId,
          idempotencyKey
        }
      });

      return { success: true, poIds };
    });

    revalidatePath("/purchase/requisitions");
    revalidatePath("/purchase/po");
    return { success: true, poIds: result.poIds };
  } catch (err: any) {
    console.error("Error raising PO from award:", err);
    return { success: false, error: err.message || "Failed to raise PO from award" };
  }
}
