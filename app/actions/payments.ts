"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const paymentSchema = z.object({
  vendorId: z.string(),
  invoiceId: z.string().optional().nullable(),
  amount: z.number().nonnegative(),
  paidOn: z.string(),
  mode: z.string().optional().nullable(),
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

export async function recordPayment(data: z.infer<typeof paymentSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = paymentSchema.parse(data);
    const number = await getNextSequence(companyId, "PAY");

    const result = await db.$transaction(async (tx) => {
      const pay = await tx.paymentVoucher.create({
        data: {
          companyId,
          number,
          vendorId: validated.vendorId,
          invoiceId: validated.invoiceId || null,
          amount: validated.amount,
          paidOn: new Date(validated.paidOn),
          mode: validated.mode || null,
          reference: validated.reference || null,
          recordedById: actorId,
        },
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "RECORD_PAYMENT", "PaymentVoucher", pay.id, null, pay);
      
      return pay;
    });

    revalidatePath("/purchase/payments");
    return { success: true, payment: result };
  } catch (err: any) {
    console.error("Error recording payment voucher:", err);
    return { success: false, error: err.message || "Failed to record payment voucher" };
  }
}

export async function updatePayment(
  id: string,
  data: {
    vendorId: string;
    invoiceId?: string | null;
    amount: number;
    paidOn: string;
    mode?: string | null;
    reference?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.paymentVoucher.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Payment Voucher not found" };

    const result = await db.$transaction(async (tx) => {
      const pay = await tx.paymentVoucher.update({
        where: { id },
        data: {
          vendorId: data.vendorId,
          invoiceId: data.invoiceId || null,
          amount: data.amount,
          paidOn: new Date(data.paidOn),
          mode: data.mode || null,
          reference: data.reference || null,
        }
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "UPDATE_PAYMENT", "PaymentVoucher", pay.id, original, pay);

      return pay;
    });

    revalidatePath("/purchase/payments");
    return { success: true, payment: result };
  } catch (err: any) {
    console.error("Error updating payment voucher:", err);
    return { success: false, error: err.message || "Failed to update payment voucher" };
  }
}

export async function deletePayment(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.paymentVoucher.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Payment Voucher not found" };

    await db.$transaction(async (tx) => {
      await tx.paymentVoucher.delete({
        where: { id }
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "DELETE_PAYMENT", "PaymentVoucher", id, original, null);
    });

    revalidatePath("/purchase/payments");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting payment voucher:", err);
    return { success: false, error: err.message || "Failed to delete payment voucher" };
  }
}

export async function bulkDeletePayments(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const payments = await db.paymentVoucher.findMany({
      where: { id: { in: ids }, companyId }
    });

    if (payments.length !== ids.length) return { success: false, error: "Some payment vouchers could not be found" };

    await db.$transaction(async (tx) => {
      await tx.paymentVoucher.deleteMany({
        where: { id: { in: ids } }
      });

      for (const pay of payments) {
        await logAudit(tx, companyId, actorId, "DELETE_PAYMENT", "PaymentVoucher", pay.id, pay, null);
      }
    });

    revalidatePath("/purchase/payments");
    return { success: true };
  } catch (err: any) {
    console.error("Error bulk deleting payment vouchers:", err);
    return { success: false, error: err.message || "Failed to bulk delete payment vouchers" };
  }
}

export async function confirmPendingPayment(
  id: string,
  data: {
    paidOn: string;
    mode: string;
    reference: string;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.paymentVoucher.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Payment Voucher not found" };
    if (!original.reference?.startsWith("ADVANCE PAY PENDING")) {
      return { success: false, error: "Only pending advance payment vouchers can be confirmed" };
    }

    const poMatch = original.reference.match(/\(PO:\s*([^\)]+)\)/i);
    const suffix = poMatch ? ` (PO: ${poMatch[1]})` : "";
    const updatedReference = `${data.reference}${suffix}`;

    const result = await db.$transaction(async (tx) => {
      const pay = await tx.paymentVoucher.update({
        where: { id },
        data: {
          paidOn: new Date(data.paidOn),
          mode: data.mode,
          reference: updatedReference,
        }
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "CONFIRM_PENDING_PAYMENT", "PaymentVoucher", pay.id, original, pay);

      return pay;
    });

    revalidatePath("/purchase/payments");
    return { success: true, payment: result };
  } catch (err: any) {
    console.error("Error confirming pending payment voucher:", err);
    return { success: false, error: err.message || "Failed to confirm pending payment voucher" };
  }
}
