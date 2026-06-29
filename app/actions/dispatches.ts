"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DispatchStatus, EWayBillStatus, SoStatus, SoLineStatus, LedgerTxnType } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { postLedgerEntry } from "@/lib/stock";

// Dispatch / Delivery Challan — the outward mirror of the GRN. Issues stock from
// a store against a confirmed Sales Order, rolls up line + order fulfilment, and
// (optionally) generates a GST e-way bill. Stock moves out as a negative,
// average-rate-valued ledger entry, exactly as a GRN moves it in as a positive.

const dispatchLineSchema = z.object({
  soLineId: z.string().min(1),
  itemId: z.string().min(1),
  qty: z.number().positive("Qty must be > 0"),
  batchNo: z.string().optional().nullable(),
});

const dispatchSchema = z.object({
  soId: z.string().min(1, "Sales order is required"),
  storeId: z.string().optional().nullable(),
  dispatchDate: z.string().optional().nullable(),
  vehicleNo: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
  transporterGstin: z.string().optional().nullable(),
  lrNo: z.string().optional().nullable(),
  distanceKm: z.number().int().nonnegative().optional().nullable(),
  lines: z.array(dispatchLineSchema).min(1, "Add at least one line"),
});

const EWAY_THRESHOLD = 50000; // ₹ consignment value above which an e-way bill is mandatory

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

function rollupSoLineStatus(qty: number, dispatchedQty: number): SoLineStatus {
  if (dispatchedQty <= 0) return SoLineStatus.OPEN;
  if (dispatchedQty >= qty) return SoLineStatus.DISPATCHED;
  return SoLineStatus.PARTIALLY_DISPATCHED;
}

export async function createDispatch(data: z.infer<typeof dispatchSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = dispatchSchema.parse(data);

    const so = await db.salesOrder.findFirst({
      where: { id: validated.soId, companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!so) return { success: false, error: "Sales order not found" };
    const dispatchable: SoStatus[] = [SoStatus.CONFIRMED, SoStatus.PARTIALLY_DISPATCHED];
    if (!dispatchable.includes(so.status)) {
      return { success: false, error: `Order must be CONFIRMED to dispatch (currently ${so.status})` };
    }

    // Resolve the issuing store.
    const company = await db.company.findUnique({ where: { id: companyId } });
    const storeId = validated.storeId || company?.defaultStoreId || null;
    if (!storeId) {
      return { success: false, error: "No store selected and no company default store configured" };
    }

    // Validate quantities against the open balance on each SO line.
    const lineById = new Map(so.lines.map((l) => [l.id, l]));
    for (const dl of validated.lines) {
      const sol = lineById.get(dl.soLineId);
      if (!sol) return { success: false, error: `Line ${dl.soLineId} is not on this order` };
      const open = sol.qty - sol.dispatchedQty;
      if (dl.qty > open + 1e-9) {
        return {
          success: false,
          error: `Dispatch qty ${dl.qty} exceeds open balance ${open} on item ${sol.itemId}`,
        };
      }
    }

    const number = await getNextSequence(companyId, "DC");

    const result = await db.$transaction(async (tx) => {
      // Idempotency guard for this SO→Dispatch conversion.
      const idempotencyKey = `SO_TO_DISPATCH:${so.id}:${number}`;
      await tx.salesFlowConversion.create({
        data: { companyId, step: "SO_TO_DISPATCH", sourceId: so.id, idempotencyKey },
      });

      const dispatch = await tx.dispatch.create({
        data: {
          companyId,
          number,
          soId: so.id,
          customerId: so.customerId,
          status: DispatchStatus.DISPATCHED,
          dispatchDate: validated.dispatchDate ? new Date(validated.dispatchDate) : new Date(),
          storeId,
          vehicleNo: validated.vehicleNo || null,
          transporterName: validated.transporterName || null,
          transporterGstin: validated.transporterGstin || null,
          lrNo: validated.lrNo || null,
          distanceKm: validated.distanceKm ?? null,
          createdById: actorId,
          lines: {
            create: validated.lines.map((l) => ({
              soLineId: l.soLineId,
              itemId: l.itemId,
              qty: l.qty,
              batchNo: l.batchNo || null,
            })),
          },
        },
        include: { lines: true },
      });

      // Issue stock out (negative qty), valued at the running average rate.
      for (const dl of validated.lines) {
        await postLedgerEntry(tx, {
          companyId,
          itemId: dl.itemId,
          storeId,
          txnType: LedgerTxnType.ISSUE,
          qty: -Math.abs(dl.qty),
          refType: "DISPATCH",
          refId: dispatch.id,
          createdById: actorId,
        });

        // Roll up the SO line.
        const sol = lineById.get(dl.soLineId)!;
        const newDispatched = sol.dispatchedQty + dl.qty;
        await tx.soLine.update({
          where: { id: sol.id },
          data: {
            dispatchedQty: newDispatched,
            status: rollupSoLineStatus(sol.qty, newDispatched),
          },
        });
        sol.dispatchedQty = newDispatched; // keep local map in sync for rollup below
      }

      // Roll up the order.
      const allDispatched = so.lines.every((l) => l.dispatchedQty >= l.qty - 1e-9);
      await tx.salesOrder.update({
        where: { id: so.id },
        data: { status: allDispatched ? SoStatus.DISPATCHED : SoStatus.PARTIALLY_DISPATCHED },
      });

      // Compute consignment value to flag e-way bill applicability.
      const value = validated.lines.reduce((s, dl) => {
        const sol = lineById.get(dl.soLineId)!;
        return s + dl.qty * sol.rate * (1 - (sol.discount || 0) / 100) * (1 + (sol.gstRate || 0) / 100);
      }, 0);
      if (value > EWAY_THRESHOLD) {
        await tx.dispatch.update({ where: { id: dispatch.id }, data: { ewayBillStatus: EWayBillStatus.PENDING } });
      }

      await logAudit(tx, companyId, actorId, "DISPATCH", "Dispatch", dispatch.id, null, dispatch);
      return dispatch;
    });

    revalidatePath("/sales/dispatch");
    revalidatePath("/sales/orders");
    return { success: true, dispatch: result };
  } catch (err: any) {
    console.error("Error creating dispatch:", err);
    return { success: false, error: err.message || "Failed to create dispatch" };
  }
}

/**
 * Builds an NIC-compliant e-way bill payload from a dispatch and issues an EWB
 * number. In demo mode (or until a GSP is wired), the EWB number and validity
 * are generated locally; swapping in the real NIC/GSP call is a single fetch.
 */
export async function generateEWayBill(dispatchId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const dispatch = await db.dispatch.findFirst({
      where: { id: dispatchId, companyId },
      include: { lines: true, so: true },
    });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.ewayBillStatus === EWayBillStatus.GENERATED) {
      return { success: false, error: "E-way bill already generated for this dispatch" };
    }

    const company = await db.company.findUnique({ where: { id: companyId } });
    const customer = await db.customer.findFirst({ where: { id: dispatch.customerId, companyId } });
    const items = await db.item.findMany({
      where: { companyId, id: { in: dispatch.lines.map((l) => l.itemId) } },
      select: { id: true, name: true, hsnCode: true, gstRate: true, baseUom: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    const fromState = company?.gstin?.slice(0, 2) || "";
    const toState = customer?.gstin?.slice(0, 2) || customer?.stateCode || "";
    const intraState = fromState && toState && fromState === toState;
    const distance = dispatch.distanceKm ?? 0;

    const payload = {
      supplyType: "O", // Outward
      subSupplyType: "1", // Supply
      docType: "INV",
      docNo: dispatch.number,
      docDate: dispatch.dispatchDate.toISOString().slice(0, 10),
      fromGstin: company?.gstin || "URP",
      fromTrdName: company?.legalName || company?.name,
      fromStateCode: fromState,
      toGstin: customer?.gstin || "URP",
      toTrdName: customer?.name,
      toStateCode: toState,
      transDistance: String(distance),
      transporterName: dispatch.transporterName || undefined,
      vehicleNo: dispatch.vehicleNo || undefined,
      vehicleType: "R",
      itemList: dispatch.lines.map((l) => {
        const it = itemById.get(l.itemId);
        const taxRate = it?.gstRate || 0;
        return {
          productName: it?.name,
          hsnCode: it?.hsnCode || "",
          quantity: l.qty,
          qtyUnit: it?.baseUom || "NOS",
          ...(intraState
            ? { cgstRate: taxRate / 2, sgstRate: taxRate / 2, igstRate: 0 }
            : { cgstRate: 0, sgstRate: 0, igstRate: taxRate }),
        };
      }),
    };

    // ── Issue the EWB. Replace this block with the NIC/GSP API call. ──
    const ewbNo = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
    const ewayBillDate = new Date();
    // Validity: 1 day per 200 km (Part-B, road), minimum 1 day.
    const validDays = Math.max(1, Math.ceil((distance || 1) / 200));
    const ewayValidUpto = new Date(ewayBillDate);
    ewayValidUpto.setDate(ewayValidUpto.getDate() + validDays);

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.dispatch.update({
        where: { id: dispatchId },
        data: {
          ewayBillNo: ewbNo,
          ewayBillDate,
          ewayValidUpto,
          ewayBillStatus: EWayBillStatus.GENERATED,
          ewayBillData: { request: payload, response: { ewayBillNo: ewbNo, validUpto: ewayValidUpto.toISOString() } } as any,
        },
      });
      await logAudit(tx, companyId, actorId, "EWAYBILL_GENERATE", "Dispatch", dispatchId, { ewayBillStatus: dispatch.ewayBillStatus }, { ewayBillNo: ewbNo });
      return updated;
    });

    revalidatePath("/sales/dispatch");
    return { success: true, ewayBillNo: ewbNo, validUpto: ewayValidUpto, dispatch: result };
  } catch (err: any) {
    console.error("Error generating e-way bill:", err);
    return { success: false, error: err.message || "Failed to generate e-way bill" };
  }
}

export async function markDispatchDelivered(dispatchId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const dispatch = await db.dispatch.findFirst({ where: { id: dispatchId, companyId } });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.status !== DispatchStatus.DISPATCHED) {
      return { success: false, error: `Cannot mark delivered from ${dispatch.status}` };
    }

    await db.$transaction(async (tx) => {
      await tx.dispatch.update({ where: { id: dispatchId }, data: { status: DispatchStatus.DELIVERED } });
      await logAudit(tx, companyId, actorId, "DELIVERED", "Dispatch", dispatchId, { status: dispatch.status }, { status: DispatchStatus.DELIVERED });
    });

    revalidatePath("/sales/dispatch");
    return { success: true };
  } catch (err: any) {
    console.error("Error marking delivered:", err);
    return { success: false, error: err.message || "Failed to update dispatch" };
  }
}
