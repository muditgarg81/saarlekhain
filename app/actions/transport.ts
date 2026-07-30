"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { TransportOrderStatus, TransportBillPaymentStatus } from "@prisma/client";

// ==========================================
// 1. TRANSPORT RATES (MASTER TRIP RATES)
// ==========================================

export async function createTransportRate(data: {
  transporterId: string;
  fromLocation: string;
  toLocation: string;
  vehicleCapacity: string;
  rate: number;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const rate = await db.transportRate.create({
      data: {
        companyId,
        transporterId: data.transporterId,
        fromLocation: data.fromLocation.trim(),
        toLocation: data.toLocation.trim(),
        vehicleCapacity: data.vehicleCapacity,
        rate: data.rate,
      },
    });

    revalidatePath("/purchase/transport");
    return { success: true, rate };
  } catch (err: any) {
    console.error("Error creating transport rate:", err);
    return { success: false, error: err.message || "Failed to create rate" };
  }
}

export async function updateTransportRate(
  id: string,
  data: {
    rate: number;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const rate = await db.transportRate.updateMany({
      where: { id, companyId },
      data: { rate: data.rate },
    });

    revalidatePath("/purchase/transport");
    return { success: true, count: rate.count };
  } catch (err: any) {
    console.error("Error updating transport rate:", err);
    return { success: false, error: err.message || "Failed to update rate" };
  }
}

export async function deleteTransportRate(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    await db.transportRate.updateMany({
      where: { id, companyId },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/purchase/transport");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting transport rate:", err);
    return { success: false, error: err.message || "Failed to delete rate" };
  }
}

// ==========================================
// 2. TRANSPORT ORDERS (TO)
// ==========================================

export async function createTransportOrder(data: {
  transporterId: string;
  vehicleCapacity: string;
  fromLocation: string;
  toLocation: string;
  vehicleNo?: string;
  driverName?: string;
  driverPhone?: string;
  loadingPoint?: string;
  unloadingPoint?: string;
  freightAmount: number;
  otherCharges?: number;
  taxRate?: number;
  poId?: string | null;
  grnId?: string | null;
  status?: TransportOrderStatus;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const number = await getNextSequence(companyId, "TO");
    const freight = data.freightAmount;
    const other = data.otherCharges || 0;
    const tax = data.taxRate || 0;
    const totalAmount = (freight + other) * (1 + tax / 100);

    const order = await db.transportOrder.create({
      data: {
        companyId,
        number,
        transporterId: data.transporterId,
        vehicleCapacity: data.vehicleCapacity,
        fromLocation: data.fromLocation,
        toLocation: data.toLocation,
        vehicleNo: data.vehicleNo || null,
        driverName: data.driverName || null,
        driverPhone: data.driverPhone || null,
        loadingPoint: data.loadingPoint || null,
        unloadingPoint: data.unloadingPoint || null,
        freightAmount: freight,
        otherCharges: other,
        taxRate: tax,
        totalAmount,
        status: data.status || TransportOrderStatus.DRAFT,
        poId: data.poId || null,
        grnId: data.grnId || null,
      },
    });

    revalidatePath("/purchase/transport");
    return { success: true, order };
  } catch (err: any) {
    console.error("Error creating transport order:", err);
    return { success: false, error: err.message || "Failed to create transport order" };
  }
}

export async function updateTransportOrder(
  id: string,
  data: {
    vehicleCapacity?: string;
    fromLocation?: string;
    toLocation?: string;
    vehicleNo?: string;
    driverName?: string;
    driverPhone?: string;
    loadingPoint?: string;
    unloadingPoint?: string;
    freightAmount?: number;
    otherCharges?: number;
    taxRate?: number;
    status?: TransportOrderStatus;
    poId?: string | null;
    grnId?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    // Get existing order to re-calculate total if fields change
    const existing = await db.transportOrder.findFirst({
      where: { id, companyId },
    });
    if (!existing) return { success: false, error: "Transport order not found" };

    const freight = data.freightAmount !== undefined ? data.freightAmount : existing.freightAmount;
    const other = data.otherCharges !== undefined ? data.otherCharges : existing.otherCharges;
    const tax = data.taxRate !== undefined ? data.taxRate : existing.taxRate;
    const totalAmount = (freight + other) * (1 + tax / 100);

    const order = await db.transportOrder.update({
      where: { id },
      data: {
        vehicleCapacity: data.vehicleCapacity,
        fromLocation: data.fromLocation,
        toLocation: data.toLocation,
        vehicleNo: data.vehicleNo,
        driverName: data.driverName,
        driverPhone: data.driverPhone,
        loadingPoint: data.loadingPoint,
        unloadingPoint: data.unloadingPoint,
        freightAmount: freight,
        otherCharges: other,
        taxRate: tax,
        totalAmount,
        status: data.status,
        poId: data.poId,
        grnId: data.grnId,
      },
    });

    revalidatePath("/purchase/transport");
    return { success: true, order };
  } catch (err: any) {
    console.error("Error updating transport order:", err);
    return { success: false, error: err.message || "Failed to update transport order" };
  }
}

export async function deleteTransportOrder(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    await db.transportOrder.updateMany({
      where: { id, companyId },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/purchase/transport");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting transport order:", err);
    return { success: false, error: err.message || "Failed to delete transport order" };
  }
}

// ==========================================
// 3. TRANSPORT BILL PROCESSING
// ==========================================

export async function createTransportBill(data: {
  transportOrderId: string;
  billNo: string;
  billDate: string;
  amount: number;
  dueDate?: string;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    // Verify transport order exists
    const order = await db.transportOrder.findFirst({
      where: { id: data.transportOrderId, companyId },
    });
    if (!order) return { success: false, error: "Transport order not found" };

    const bill = await db.transportBill.create({
      data: {
        companyId,
        transportOrderId: data.transportOrderId,
        billNo: data.billNo.trim(),
        billDate: new Date(data.billDate),
        amount: data.amount,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        paymentStatus: TransportBillPaymentStatus.PENDING,
      },
    });

    revalidatePath("/purchase/transport");
    return { success: true, bill };
  } catch (err: any) {
    console.error("Error creating transport bill:", err);
    return { success: false, error: err.message || "Failed to process bill" };
  }
}

export async function deleteTransportBill(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    await db.transportBill.updateMany({
      where: { id, companyId },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/purchase/transport");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting transport bill:", err);
    return { success: false, error: err.message || "Failed to delete bill" };
  }
}

// ==========================================
// 4. TRANSPORT PAYMENTS
// ==========================================

export async function recordTransportPayment(data: {
  transportBillId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNo?: string;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const number = await getNextSequence(companyId, "TP");

    const payment = await db.$transaction(async (tx) => {
      // Create payment
      const p = await tx.transportPayment.create({
        data: {
          companyId,
          paymentNo: number,
          amount: data.amount,
          paymentDate: new Date(data.paymentDate),
          paymentMethod: data.paymentMethod,
          referenceNo: data.referenceNo || null,
          transportBillId: data.transportBillId,
        },
      });

      // Update bill payment status
      const bill = await tx.transportBill.findUnique({
        where: { id: data.transportBillId },
        include: { payments: true },
      });

      if (!bill) throw new Error("Transport bill not found");

      const totalPaid = bill.payments.reduce((sum: number, pay: any) => sum + pay.amount, 0) + data.amount;

      let nextStatus = TransportBillPaymentStatus.PARTIALLY_PAID;
      if (totalPaid >= bill.amount) {
        nextStatus = TransportBillPaymentStatus.PAID;
      }

      await tx.transportBill.update({
        where: { id: data.transportBillId },
        data: { paymentStatus: nextStatus },
      });

      return p;
    });

    revalidatePath("/purchase/transport");
    return { success: true, payment };
  } catch (err: any) {
    console.error("Error recording transport payment:", err);
    return { success: false, error: err.message || "Failed to record payment" };
  }
}
