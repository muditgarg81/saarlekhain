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
