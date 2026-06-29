"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReceiptMode, SalesInvoiceStatus } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";

// Receipt Voucher — the collections mirror of the Payment Voucher. Records money
// received against a customer / invoice. Like payments, it is RECORDED, never
// executed; settling an invoice rolls its paidAmount and status forward.

const receiptSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  invoiceId: z.string().optional().nullable(),
  amount: z.number().positive("Amount must be > 0"),
  receivedOn: z.string().optional().nullable(),
  mode: z.nativeEnum(ReceiptMode).default(ReceiptMode.NEFT),
  reference: z.string().optional().nullable(),
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

export async function recordReceipt(data: z.infer<typeof receiptSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = receiptSchema.parse(data);

    const customer = await db.customer.findFirst({ where: { id: validated.customerId, companyId, deletedAt: null } });
    if (!customer) return { success: false, error: "Customer not found" };

    let invoice = null as Awaited<ReturnType<typeof db.salesInvoice.findFirst>> | null;
    if (validated.invoiceId) {
      invoice = await db.salesInvoice.findFirst({ where: { id: validated.invoiceId, companyId } });
      if (!invoice) return { success: false, error: "Invoice not found" };
      if (invoice.customerId !== customer.id) {
        return { success: false, error: "Invoice does not belong to this customer" };
      }
      if (invoice.status === SalesInvoiceStatus.CANCELLED) {
        return { success: false, error: "Cannot receive against a cancelled invoice" };
      }
      const outstanding = invoice.totalAmount - invoice.paidAmount;
      if (validated.amount > outstanding + 1e-9) {
        return { success: false, error: `Amount exceeds invoice outstanding of ₹${outstanding.toFixed(2)}` };
      }
    }

    const number = await getNextSequence(companyId, "RV");

    const result = await db.$transaction(async (tx) => {
      const receipt = await tx.receiptVoucher.create({
        data: {
          companyId,
          number,
          customerId: customer.id,
          invoiceId: invoice?.id || null,
          amount: validated.amount,
          receivedOn: validated.receivedOn ? new Date(validated.receivedOn) : new Date(),
          mode: validated.mode,
          reference: validated.reference || null,
          recordedById: actorId,
        },
      });

      if (invoice) {
        const newPaid = invoice.paidAmount + validated.amount;
        const newStatus =
          newPaid >= invoice.totalAmount - 1e-9
            ? SalesInvoiceStatus.PAID
            : SalesInvoiceStatus.PARTIALLY_PAID;
        await tx.salesInvoice.update({ where: { id: invoice.id }, data: { paidAmount: newPaid, status: newStatus } });
      }

      await logAudit(tx, companyId, actorId, "RECEIPT", "ReceiptVoucher", receipt.id, null, receipt);
      return receipt;
    });

    revalidatePath("/sales/receipts");
    revalidatePath("/sales/invoices");
    return { success: true, receipt: result };
  } catch (err: any) {
    console.error("Error recording receipt:", err);
    return { success: false, error: err.message || "Failed to record receipt" };
  }
}
