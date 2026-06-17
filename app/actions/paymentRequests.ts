"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PaymentRequestStatus, PaymentRequestType } from "@prisma/client";

const paymentRequestSchema = z.object({
  vendorId: z.string(),
  poId: z.string().optional().nullable(),
  grnId: z.string().optional().nullable(),
  type: z.enum(["ADVANCE", "AGAINST_BILL", "OTHERS"]),
  amount: z.number().nonnegative(),
  remarks: z.string().optional().nullable(),
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

export async function createPaymentRequest(data: z.infer<typeof paymentRequestSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = paymentRequestSchema.parse(data);
    const number = await getNextSequence(companyId, "PRQ");

    const result = await db.$transaction(async (tx) => {
      const prq = await tx.paymentRequest.create({
        data: {
          companyId,
          number,
          vendorId: validated.vendorId,
          poId: validated.poId || null,
          grnId: validated.grnId || null,
          type: validated.type,
          amount: validated.amount,
          remarks: validated.remarks || null,
          status: PaymentRequestStatus.PENDING,
          recordedById: actorId,
        },
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "CREATE_PAYMENT_REQUEST", "PaymentRequest", prq.id, null, prq);
      
      return prq;
    });

    revalidatePath("/purchase/payments");
    return { success: true, paymentRequest: result };
  } catch (err: any) {
    console.error("Error creating payment request:", err);
    return { success: false, error: err.message || "Failed to create payment request" };
  }
}

export async function updatePaymentRequest(
  id: string,
  data: {
    vendorId: string;
    poId?: string | null;
    grnId?: string | null;
    type: "ADVANCE" | "AGAINST_BILL" | "OTHERS";
    amount: number;
    remarks?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.paymentRequest.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Payment Request not found" };
    if (original.status !== PaymentRequestStatus.PENDING) {
      return { success: false, error: "Only pending requests can be modified" };
    }

    const result = await db.$transaction(async (tx) => {
      const prq = await tx.paymentRequest.update({
        where: { id },
        data: {
          vendorId: data.vendorId,
          poId: data.poId || null,
          grnId: data.grnId || null,
          type: data.type,
          amount: data.amount,
          remarks: data.remarks || null,
        }
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "UPDATE_PAYMENT_REQUEST", "PaymentRequest", prq.id, original, prq);

      return prq;
    });

    revalidatePath("/purchase/payments");
    return { success: true, paymentRequest: result };
  } catch (err: any) {
    console.error("Error updating payment request:", err);
    return { success: false, error: err.message || "Failed to update payment request" };
  }
}

export async function deletePaymentRequest(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.paymentRequest.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Payment Request not found" };
    if (original.status !== PaymentRequestStatus.PENDING && original.status !== PaymentRequestStatus.REJECTED) {
      return { success: false, error: "Cannot delete approved or paid requests" };
    }

    await db.$transaction(async (tx) => {
      await tx.paymentRequest.delete({
        where: { id }
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, "DELETE_PAYMENT_REQUEST", "PaymentRequest", id, original, null);
    });

    revalidatePath("/purchase/payments");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting payment request:", err);
    return { success: false, error: err.message || "Failed to delete payment request" };
  }
}

export async function reviewPaymentRequest(id: string, status: "APPROVED" | "REJECTED") {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.paymentRequest.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Payment Request not found" };
    if (original.status !== PaymentRequestStatus.PENDING) {
      return { success: false, error: "Only pending requests can be approved/rejected" };
    }

    const result = await db.$transaction(async (tx) => {
      const prq = await tx.paymentRequest.update({
        where: { id },
        data: {
          status,
          approvedById: actorId,
          approvedAt: new Date(),
        }
      });

      // Audit Log
      await logAudit(tx, companyId, actorId, `REVIEW_PAYMENT_REQUEST_${status}`, "PaymentRequest", prq.id, original, prq);

      return prq;
    });

    revalidatePath("/purchase/payments");
    return { success: true, paymentRequest: result };
  } catch (err: any) {
    console.error("Error reviewing payment request:", err);
    return { success: false, error: err.message || "Failed to review payment request" };
  }
}

export async function confirmPaymentRequest(
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
    const original = await db.paymentRequest.findFirst({
      where: { id, companyId },
      include: { po: true, grn: true }
    });

    if (!original) return { success: false, error: "Payment Request not found" };
    if (original.status !== PaymentRequestStatus.APPROVED) {
      return { success: false, error: "Only approved payment requests can be paid" };
    }

    const number = await getNextSequence(companyId, "PAY");

    const result = await db.$transaction(async (tx) => {
      // 1. Create Payment Voucher
      let referenceText = data.reference;
      if (original.po && original.grn) {
        referenceText = `${data.reference} (PO: ${original.po.number}) (GRN: ${original.grn.number})`;
      } else if (original.po) {
        referenceText = `${data.reference} (PO: ${original.po.number})`;
      } else if (original.grn) {
        referenceText = `${data.reference} (GRN: ${original.grn.number})`;
      }

      const pay = await tx.paymentVoucher.create({
        data: {
          companyId,
          number,
          vendorId: original.vendorId,
          invoiceId: null,
          amount: original.amount,
          paidOn: new Date(data.paidOn),
          mode: data.mode,
          reference: referenceText,
          recordedById: actorId,
        }
      });

      // 2. Update Payment Request
      const prq = await tx.paymentRequest.update({
        where: { id },
        data: {
          status: PaymentRequestStatus.PAID,
          paymentVoucherId: pay.id,
        }
      });

      // Audit logs
      await logAudit(tx, companyId, actorId, "CONFIRM_PAYMENT_REQUEST", "PaymentRequest", prq.id, original, prq);
      await logAudit(tx, companyId, actorId, "RECORD_PAYMENT", "PaymentVoucher", pay.id, null, pay);

      return { prq, pay };
    });

    revalidatePath("/purchase/payments");
    return { success: true, data: result };
  } catch (err: any) {
    console.error("Error confirming payment request:", err);
    return { success: false, error: err.message || "Failed to confirm payment request" };
  }
}
