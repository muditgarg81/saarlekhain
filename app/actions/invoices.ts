"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InvoiceMatchStatus } from "@prisma/client";

const invoiceLineSchema = z.object({
  itemId: z.string(),
  qty: z.number().nonnegative(),
  rate: z.number().nonnegative(),
});

const invoiceSchema = z.object({
  vendorId: z.string(),
  poId: z.string().optional().nullable(),
  invoiceNo: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string(),
  amount: z.number().nonnegative(),
  lines: z.array(invoiceLineSchema).min(1, "Invoice must contain at least one line"),
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

export async function computeInvoiceMatchStatus(
  tx: any,
  companyId: string,
  poId: string,
  lines: { itemId: string; qty: number; rate: number; }[]
): Promise<{ matchStatus: InvoiceMatchStatus; discrepancies: string[] }> {
  let matchStatus: InvoiceMatchStatus = InvoiceMatchStatus.MATCHED;
  const discrepancies: string[] = [];

  // 1. Fetch PO details
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, companyId },
    include: { lines: true },
  });

  // 2. Fetch GRNs for this PO
  const grns = await tx.grn.findMany({
    where: { poId, companyId, status: "POSTED" },
    include: { lines: true },
  });

  if (!po) {
    return {
      matchStatus: InvoiceMatchStatus.MISMATCH,
      discrepancies: ["Linked PO not found in database"]
    };
  }

  // Compare each invoice line
  for (const invLine of lines) {
    const poLine = po.lines.find((pl: any) => pl.itemId === invLine.itemId);
    
    // 3-Way Rate Check
    if (!poLine) {
      matchStatus = InvoiceMatchStatus.MISMATCH;
      discrepancies.push(`Item ID ${invLine.itemId} is not on the linked Purchase Order`);
      continue;
    }

    if (Math.abs(invLine.rate - poLine.rate) > 0.01) {
      matchStatus = InvoiceMatchStatus.MISMATCH;
      discrepancies.push(`Rate mismatch for Item. Invoice rate: ₹${invLine.rate}, PO rate: ₹${poLine.rate}`);
    }

    // 3-Way Quantity Check (Sum up accepted qty across posted GRNs)
    let totalAcceptedQty = 0;
    grns.forEach((grn: any) => {
      const grnLine = grn.lines.find((gl: any) => gl.itemId === invLine.itemId);
      if (grnLine) {
        totalAcceptedQty += grnLine.acceptedQty;
      }
    });

    // Query posted Debit Notes for this item in the context of this PO's GRN rejections
    const grnLineIds = await tx.grnLine.findMany({
      where: {
        itemId: invLine.itemId,
        grn: { poId, companyId }
      },
      select: { id: true }
    });
    const ids = grnLineIds.map((l: any) => l.id);

    const rejectedMaterials = await tx.rejectedMaterial.findMany({
      where: {
        companyId,
        grnLineId: { in: ids }
      }
    });

    let totalReconciledRejectedQty = 0;
    for (const rm of rejectedMaterials) {
      const debitNote = await tx.debitCreditNote.findFirst({
        where: {
          companyId,
          refType: "GRN_REJECTION",
          refId: rm.id,
          posted: true
        }
      });
      if (debitNote) {
        totalReconciledRejectedQty += rm.rejectedQty;
      }
    }

    const verifiedQty = totalAcceptedQty + totalReconciledRejectedQty;

    if (invLine.qty > verifiedQty) {
      matchStatus = InvoiceMatchStatus.MISMATCH;
      if (totalReconciledRejectedQty > 0) {
        discrepancies.push(`Quantity mismatch. Invoice qty: ${invLine.qty}, total GRN accepted qty: ${totalAcceptedQty} + reconciled rejections (debit notes): ${totalReconciledRejectedQty}`);
      } else {
        discrepancies.push(`Quantity mismatch. Invoice qty: ${invLine.qty}, total GRN accepted qty: ${totalAcceptedQty}`);
      }
    }
  }

  return { matchStatus, discrepancies };
}

export async function recalculateInvoiceMatchStatus(
  tx: any,
  companyId: string,
  poId: string
) {
  const invoices = await tx.supplierInvoice.findMany({
    where: { poId, companyId },
    include: { lines: true }
  });

  for (const inv of invoices) {
    const { matchStatus, discrepancies } = await computeInvoiceMatchStatus(
      tx,
      companyId,
      poId,
      inv.lines
    );

    await tx.supplierInvoice.update({
      where: { id: inv.id },
      data: {
        matchStatus,
        ocrDraft: (discrepancies.length > 0 ? { discrepancies } : null) as any
      }
    });
  }
}

export async function createSupplierInvoice(data: z.infer<typeof invoiceSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = invoiceSchema.parse(data);

    // Prevent duplicate invoice number for the same supplier
    const exists = await db.supplierInvoice.findFirst({
      where: {
        companyId,
        vendorId: validated.vendorId,
        invoiceNo: validated.invoiceNo,
        deletedAt: null,
      },
    });
    if (exists) {
      return { success: false, error: `Invoice '${validated.invoiceNo}' already logged for this supplier` };
    }

    const result = await db.$transaction(async (tx) => {
      // 3-Way Match Validation Logic
      let matchStatus: InvoiceMatchStatus = InvoiceMatchStatus.MATCHED;
      let discrepancies: string[] = [];

      if (validated.poId) {
        const matchResult = await computeInvoiceMatchStatus(
          tx,
          companyId,
          validated.poId,
          validated.lines
        );
        matchStatus = matchResult.matchStatus;
        discrepancies = matchResult.discrepancies;
      } else {
        matchStatus = InvoiceMatchStatus.MISMATCH;
        discrepancies.push("No purchase order linked for this invoice (Direct/Cash invoice)");
      }

      // Get creditDays from Vendor
      const vendor = await tx.vendor.findFirst({
        where: { id: validated.vendorId, companyId },
      });
      const creditDays = vendor?.creditDays || 0;
      const invoiceDateObj = new Date(validated.invoiceDate);
      const dueDateObj = new Date(invoiceDateObj);
      dueDateObj.setDate(dueDateObj.getDate() + creditDays);

      const invoice = await tx.supplierInvoice.create({
        data: {
          companyId,
          vendorId: validated.vendorId,
          poId: validated.poId || null,
          invoiceNo: validated.invoiceNo,
          invoiceDate: invoiceDateObj,
          amount: validated.amount,
          dueDate: dueDateObj,
          matchStatus,
          ocrDraft: (discrepancies.length > 0 ? { discrepancies } : null) as any,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await logAudit(tx, companyId, actorId, "CREATE", "SupplierInvoice", invoice.id, null, invoice);
      return { invoice, matchStatus, discrepancies };
    });

    revalidatePath("/purchase/invoices");
    return { success: true, invoice: result.invoice, matchStatus: result.matchStatus, discrepancies: result.discrepancies };
  } catch (err: any) {
    console.error("Error creating supplier invoice:", err);
    return { success: false, error: err.message || "Failed to create supplier invoice" };
  }
}

export async function updateInvoiceMatchStatus(
  invoiceId: string,
  matchStatus: InvoiceMatchStatus,
  reason: string
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.supplierInvoice.findFirst({
      where: { id: invoiceId, companyId },
    });
    if (!original) return { success: false, error: "Invoice not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.supplierInvoice.update({
        where: { id: invoiceId },
        data: { matchStatus },
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "OVERRIDE_MATCH_STATUS",
        "SupplierInvoice",
        invoiceId,
        { matchStatus: original.matchStatus, reason },
        { matchStatus }
      );

      return updated;
    });

    revalidatePath("/purchase/invoices");
    return { success: true, invoice: result };
  } catch (err: any) {
    console.error("Error updating match status:", err);
    return { success: false, error: err.message || "Failed to update match status" };
  }
}
