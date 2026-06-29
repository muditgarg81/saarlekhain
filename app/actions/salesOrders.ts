"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SoStatus, SoType } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { can } from "@/lib/rbac";
import { getFreshUser } from "@/app/actions/auth";
import { notify } from "@/lib/notifications";

// Sales Order — the order-to-cash mirror of the Purchase Order. Customer order
// capture → confirm → (dispatch) → (invoice). Every write derives companyId from
// session, validates with zod, runs in a transaction, and writes an AuditLog row.

const soLineSchema = z.object({
  itemId: z.string().min(1, "Item is required"),
  qty: z.number().positive("Qty must be > 0"),
  rate: z.number().nonnegative(),
  discount: z.number().min(0).max(100).default(0),
  gstRate: z.number().min(0).default(0),
  requiredBy: z.string().optional().nullable(),
});

const soSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  type: z.nativeEnum(SoType).default(SoType.REGULAR),
  customerPoNo: z.string().optional().nullable(),
  customerPoDate: z.string().optional().nullable(),
  deliveryDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  shippingAddress: z.string().optional().nullable(),
  placeOfSupply: z.string().optional().nullable(),
  termsConditions: z.string().optional().nullable(),
  otherCharges: z.number().nonnegative().default(0),
  lines: z.array(soLineSchema).min(1, "Add at least one line"),
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

// Gross order value, GST-inclusive — used for the approval value tier.
// Not exported: a "use server" module may only export async functions.
function soLineGross(l: { qty: number; rate: number; discount?: number; gstRate?: number }) {
  const taxable = l.qty * l.rate * (1 - (l.discount || 0) / 100);
  return taxable * (1 + (l.gstRate || 0) / 100);
}

export async function createSalesOrder(data: z.infer<typeof soSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = soSchema.parse(data);

    const customer = await db.customer.findFirst({
      where: { id: validated.customerId, companyId, deletedAt: null },
    });
    if (!customer) return { success: false, error: "Customer not found" };
    if (customer.status === "BLACKLISTED" || customer.status === "HOLD") {
      return { success: false, error: `Customer is ${customer.status}; cannot raise an order` };
    }

    const number = await getNextSequence(companyId, "SO");

    const result = await db.$transaction(async (tx) => {
      const so = await tx.salesOrder.create({
        data: {
          companyId,
          number,
          customerId: customer.id,
          type: validated.type,
          status: SoStatus.DRAFT,
          customerPoNo: validated.customerPoNo || null,
          customerPoDate: validated.customerPoDate ? new Date(validated.customerPoDate) : null,
          deliveryDate: validated.deliveryDate ? new Date(validated.deliveryDate) : null,
          paymentTerms: validated.paymentTerms || customer.paymentTerms || null,
          billingAddress: validated.billingAddress || customer.billingAddress || null,
          shippingAddress: validated.shippingAddress || customer.shippingAddress || null,
          placeOfSupply: validated.placeOfSupply || customer.stateCode || null,
          termsConditions: validated.termsConditions || null,
          otherCharges: validated.otherCharges,
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
        include: { lines: true },
      });

      await logAudit(tx, companyId, actorId, "CREATE", "SalesOrder", so.id, null, so);
      return so;
    });

    revalidatePath("/sales/orders");
    return { success: true, salesOrder: result };
  } catch (err: any) {
    console.error("Error creating sales order:", err);
    return { success: false, error: err.message || "Failed to create sales order" };
  }
}

export async function submitSalesOrder(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const so = await db.salesOrder.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!so) return { success: false, error: "Sales order not found" };
    if (so.status !== SoStatus.DRAFT) {
      return { success: false, error: `Cannot submit an order in ${so.status} state` };
    }
    if (so.lines.length === 0) return { success: false, error: "Order has no lines" };

    await db.$transaction(async (tx) => {
      await tx.salesOrder.update({ where: { id }, data: { status: SoStatus.PENDING_APPROVAL } });
      await logAudit(tx, companyId, actorId, "SUBMIT", "SalesOrder", id, { status: so.status }, { status: SoStatus.PENDING_APPROVAL });
    });

    const value = so.lines.reduce((s, l) => s + soLineGross(l), 0) + so.otherCharges;
    await notify({
      companyId,
      audience: { permission: "so.approve" },
      category: "APPROVAL",
      severity: "ACTION",
      title: `Sales Order ${so.number} awaiting approval`,
      body: `Order value ₹${value.toLocaleString("en-IN")}`,
      deepLink: `/sales/orders`,
      entityType: "SalesOrder",
      entityId: id,
      dedupeKey: `so-approve-${id}`,
    });

    revalidatePath("/sales/orders");
    return { success: true };
  } catch (err: any) {
    console.error("Error submitting sales order:", err);
    return { success: false, error: err.message || "Failed to submit sales order" };
  }
}

export async function approveSalesOrder(id: string) {
  const user = await getFreshUser();
  if (!user) return { success: false, error: "Unauthorized" };
  const companyId = user.companyId;

  try {
    const so = await db.salesOrder.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!so) return { success: false, error: "Sales order not found" };
    if (so.status !== SoStatus.PENDING_APPROVAL) {
      return { success: false, error: `Cannot approve an order in ${so.status} state` };
    }

    const value = so.lines.reduce((s, l) => s + soLineGross(l), 0) + so.otherCharges;
    if (!can(user as any, "so.approve", { value })) {
      return { success: false, error: "You are not authorised to approve an order of this value" };
    }

    await db.$transaction(async (tx) => {
      await tx.salesOrder.update({
        where: { id },
        data: { status: SoStatus.CONFIRMED, approvedById: user.id, approvedAt: new Date() },
      });
      await logAudit(tx, companyId, user.id, "APPROVE", "SalesOrder", id, { status: so.status }, { status: SoStatus.CONFIRMED });
    });

    revalidatePath("/sales/orders");
    return { success: true };
  } catch (err: any) {
    console.error("Error approving sales order:", err);
    return { success: false, error: err.message || "Failed to approve sales order" };
  }
}

export async function rejectSalesOrder(id: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const so = await db.salesOrder.findFirst({ where: { id, companyId } });
    if (!so) return { success: false, error: "Sales order not found" };
    if (so.status !== SoStatus.PENDING_APPROVAL) {
      return { success: false, error: `Cannot reject an order in ${so.status} state` };
    }

    await db.$transaction(async (tx) => {
      await tx.salesOrder.update({ where: { id }, data: { status: SoStatus.CANCELLED } });
      await logAudit(tx, companyId, actorId, "REJECT", "SalesOrder", id, { status: so.status }, { status: SoStatus.CANCELLED, reason });
    });

    revalidatePath("/sales/orders");
    return { success: true };
  } catch (err: any) {
    console.error("Error rejecting sales order:", err);
    return { success: false, error: err.message || "Failed to reject sales order" };
  }
}

export async function cancelSalesOrder(id: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const so = await db.salesOrder.findFirst({ where: { id, companyId } });
    if (!so) return { success: false, error: "Sales order not found" };
    const cancellable: SoStatus[] = [
      SoStatus.CONFIRMED,
      SoStatus.PARTIALLY_DISPATCHED,
      SoStatus.PENDING_APPROVAL,
      SoStatus.DRAFT,
    ];
    if (!cancellable.includes(so.status)) {
      return { success: false, error: `Cannot cancel an order in ${so.status} state` };
    }

    await db.$transaction(async (tx) => {
      await tx.salesOrder.update({ where: { id }, data: { status: SoStatus.CANCELLED } });
      await logAudit(tx, companyId, actorId, "CANCEL", "SalesOrder", id, { status: so.status }, { status: SoStatus.CANCELLED, reason });
    });

    revalidatePath("/sales/orders");
    return { success: true };
  } catch (err: any) {
    console.error("Error cancelling sales order:", err);
    return { success: false, error: err.message || "Failed to cancel sales order" };
  }
}
