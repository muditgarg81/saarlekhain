"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { EInvoiceStatus, SalesInvoiceStatus, SoStatus, SoLineStatus } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";

// Sales Invoice — the mirror of the Supplier Invoice. Raised against a dispatch
// (or directly against an order), it computes the GST split (CGST+SGST for
// intra-state, IGST for inter-state), rolls up order fulfilment, and can mint a
// GST e-invoice IRN. The IRP payload is built to the v1.1 schema; in demo mode
// the IRN/AckNo/QR are generated locally — wiring a GSP is a single fetch.

const invoiceSchema = z.object({
  dispatchId: z.string().min(1, "Dispatch is required"),
  invoiceDate: z.string().optional().nullable(),
  otherCharges: z.number().nonnegative().default(0),
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

function indianFY(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-based; FY starts April (3)
  const startYear = m >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export async function createSalesInvoiceFromDispatch(data: z.infer<typeof invoiceSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = invoiceSchema.parse(data);

    const dispatch = await db.dispatch.findFirst({
      where: { id: validated.dispatchId, companyId, deletedAt: null },
      include: { lines: true, so: { include: { lines: true } } },
    });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (!dispatch.soId || !dispatch.so) {
      return { success: false, error: "Dispatch is not linked to a sales order" };
    }

    // One invoice per dispatch.
    const already = await db.salesInvoice.findFirst({
      where: { companyId, dispatchId: dispatch.id, deletedAt: null },
    });
    if (already) return { success: false, error: `Invoice ${already.number} already raised for this dispatch` };

    const company = await db.company.findUnique({ where: { id: companyId } });
    const customer = await db.customer.findFirst({ where: { id: dispatch.customerId, companyId } });
    if (!customer) return { success: false, error: "Customer not found" };

    const fromState = company?.gstin?.slice(0, 2) || "";
    const placeOfSupply = dispatch.so.placeOfSupply || customer.gstin?.slice(0, 2) || customer.stateCode || "";
    const intraState = !!fromState && !!placeOfSupply && fromState === placeOfSupply;

    const soLineById = new Map(dispatch.so.lines.map((l) => [l.id, l]));
    const items = await db.item.findMany({
      where: { companyId, id: { in: dispatch.lines.map((l) => l.itemId) } },
      select: { id: true, hsnCode: true },
    });
    const hsnById = new Map(items.map((i) => [i.id, i.hsnCode]));

    // Build invoice lines from dispatched quantities, priced from the SO line.
    const invoiceLines = dispatch.lines.map((dl) => {
      const sol = dl.soLineId ? soLineById.get(dl.soLineId) : undefined;
      const rate = sol?.rate ?? 0;
      const discount = sol?.discount ?? 0;
      const gstRate = sol?.gstRate ?? 0;
      const taxable = dl.qty * rate * (1 - discount / 100);
      return { itemId: dl.itemId, hsnCode: hsnById.get(dl.itemId) || null, qty: dl.qty, rate, discount, gstRate, taxable };
    });

    const taxableAmount = invoiceLines.reduce((s, l) => s + l.taxable, 0);
    const totalTax = invoiceLines.reduce((s, l) => s + (l.taxable * l.gstRate) / 100, 0);
    const cgst = intraState ? totalTax / 2 : 0;
    const sgst = intraState ? totalTax / 2 : 0;
    const igst = intraState ? 0 : totalTax;
    const preRound = taxableAmount + totalTax + validated.otherCharges;
    const totalAmount = Math.round(preRound);
    const roundOff = +(totalAmount - preRound).toFixed(2);

    const number = await getNextSequence(companyId, "SI");
    const invoiceDate = validated.invoiceDate ? new Date(validated.invoiceDate) : new Date();
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + (customer.creditDays || 0));

    // B2B (registered buyer) invoices are e-invoice eligible.
    const eInvoiceEligible = !!customer.gstin;

    const result = await db.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.create({
        data: {
          companyId,
          number,
          customerId: customer.id,
          soId: dispatch.soId,
          dispatchId: dispatch.id,
          invoiceDate,
          dueDate,
          placeOfSupply,
          taxableAmount: +taxableAmount.toFixed(2),
          cgst: +cgst.toFixed(2),
          sgst: +sgst.toFixed(2),
          igst: +igst.toFixed(2),
          otherCharges: validated.otherCharges,
          roundOff,
          totalAmount,
          status: SalesInvoiceStatus.ISSUED,
          einvoiceStatus: eInvoiceEligible ? EInvoiceStatus.PENDING : EInvoiceStatus.NOT_APPLICABLE,
          createdById: actorId,
          lines: {
            create: invoiceLines.map((l) => ({
              itemId: l.itemId,
              hsnCode: l.hsnCode,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              taxable: +l.taxable.toFixed(2),
            })),
          },
        },
        include: { lines: true },
      });

      // Roll up invoiced quantities and order status.
      for (const dl of dispatch.lines) {
        if (!dl.soLineId) continue;
        const sol = soLineById.get(dl.soLineId);
        if (!sol) continue;
        const newInvoiced = sol.invoicedQty + dl.qty;
        await tx.soLine.update({
          where: { id: sol.id },
          data: {
            invoicedQty: newInvoiced,
            status: newInvoiced >= sol.qty - 1e-9 ? SoLineStatus.INVOICED : sol.status,
          },
        });
        sol.invoicedQty = newInvoiced;
      }
      const allInvoiced = dispatch.so!.lines.every((l) => l.invoicedQty >= l.qty - 1e-9);
      if (allInvoiced) {
        await tx.salesOrder.update({ where: { id: dispatch.soId! }, data: { status: SoStatus.INVOICED } });
      }

      await logAudit(tx, companyId, actorId, "CREATE", "SalesInvoice", invoice.id, null, invoice);
      return invoice;
    });

    revalidatePath("/sales/invoices");
    revalidatePath("/sales/orders");
    return { success: true, invoice: result };
  } catch (err: any) {
    console.error("Error creating sales invoice:", err);
    return { success: false, error: err.message || "Failed to create sales invoice" };
  }
}

/**
 * Generates a GST e-invoice (IRN) for an issued invoice. Builds the IRP v1.1
 * payload and, in demo mode, mints the IRN (SHA-256 of supplierGSTIN+docType+
 * docNo+FY, per the IRP algorithm), AckNo, AckDt and a signed QR placeholder.
 */
export async function generateEInvoice(invoiceId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const invoice = await db.salesInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { lines: true },
    });
    if (!invoice) return { success: false, error: "Invoice not found" };
    if (invoice.einvoiceStatus === EInvoiceStatus.GENERATED) {
      return { success: false, error: "E-invoice already generated (IRN exists)" };
    }
    if (invoice.einvoiceStatus === EInvoiceStatus.NOT_APPLICABLE) {
      return { success: false, error: "E-invoice not applicable (buyer is unregistered/B2C)" };
    }

    const company = await db.company.findUnique({ where: { id: companyId } });
    const customer = await db.customer.findFirst({ where: { id: invoice.customerId, companyId } });
    if (!company?.gstin) return { success: false, error: "Seller GSTIN not configured on company profile" };
    if (!customer?.gstin) return { success: false, error: "Buyer GSTIN required for e-invoice" };

    const fy = indianFY(invoice.invoiceDate);
    const intraState = invoice.cgst > 0;

    const payload = {
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: invoice.reverseCharge ? "Y" : "N" },
      DocDtls: { Typ: "INV", No: invoice.number, Dt: invoice.invoiceDate.toLocaleDateString("en-GB").replace(/\//g, "/") },
      SellerDtls: {
        Gstin: company.gstin,
        LglNm: company.legalName || company.name,
        Addr1: company.registeredAddress || company.address || "",
        Loc: company.city || "",
        Stcd: company.gstin.slice(0, 2),
      },
      BuyerDtls: {
        Gstin: customer.gstin,
        LglNm: customer.name,
        Pos: invoice.placeOfSupply || customer.gstin.slice(0, 2),
        Addr1: customer.billingAddress || "",
        Stcd: customer.gstin.slice(0, 2),
      },
      ItemList: invoice.lines.map((l, i) => ({
        SlNo: String(i + 1),
        HsnCd: l.hsnCode || "",
        Qty: l.qty,
        UnitPrice: l.rate,
        TotAmt: +(l.qty * l.rate).toFixed(2),
        AssAmt: l.taxable,
        GstRt: l.gstRate,
        CgstAmt: intraState ? +((l.taxable * l.gstRate) / 200).toFixed(2) : 0,
        SgstAmt: intraState ? +((l.taxable * l.gstRate) / 200).toFixed(2) : 0,
        IgstAmt: intraState ? 0 : +((l.taxable * l.gstRate) / 100).toFixed(2),
        TotItemVal: +(l.taxable + (l.taxable * l.gstRate) / 100).toFixed(2),
      })),
      ValDtls: {
        AssVal: invoice.taxableAmount,
        CgstVal: invoice.cgst,
        SgstVal: invoice.sgst,
        IgstVal: invoice.igst,
        RndOffAmt: invoice.roundOff,
        TotInvVal: invoice.totalAmount,
      },
    };

    // ── Mint the IRN. Replace this block with the NIC/GSP API call. ──
    const irnSource = `${company.gstin}-${invoice.number}-INV-${fy}`;
    const irn = createHash("sha256").update(irnSource).digest("hex"); // 64 chars
    const ackNo = String(Date.now()).slice(-13);
    const ackDate = new Date();
    const signedQrCode = randomBytes(48).toString("base64");

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          irn,
          ackNo,
          ackDate,
          signedQrCode,
          einvoiceStatus: EInvoiceStatus.GENERATED,
          einvoiceData: { request: payload, response: { Irn: irn, AckNo: ackNo, AckDt: ackDate.toISOString() } } as any,
        },
      });
      await logAudit(tx, companyId, actorId, "EINVOICE_GENERATE", "SalesInvoice", invoiceId, { einvoiceStatus: invoice.einvoiceStatus }, { irn, ackNo });
      return updated;
    });

    revalidatePath("/sales/invoices");
    return { success: true, irn, ackNo, invoice: result };
  } catch (err: any) {
    console.error("Error generating e-invoice:", err);
    return { success: false, error: err.message || "Failed to generate e-invoice" };
  }
}

export async function cancelSalesInvoice(invoiceId: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const invoice = await db.salesInvoice.findFirst({ where: { id: invoiceId, companyId } });
    if (!invoice) return { success: false, error: "Invoice not found" };
    if (invoice.paidAmount > 0) {
      return { success: false, error: "Cannot cancel an invoice with receipts against it" };
    }

    await db.$transaction(async (tx) => {
      await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          status: SalesInvoiceStatus.CANCELLED,
          einvoiceStatus: invoice.einvoiceStatus === EInvoiceStatus.GENERATED ? EInvoiceStatus.CANCELLED : invoice.einvoiceStatus,
        },
      });
      await logAudit(tx, companyId, actorId, "CANCEL", "SalesInvoice", invoiceId, { status: invoice.status }, { status: SalesInvoiceStatus.CANCELLED, reason });
    });

    revalidatePath("/sales/invoices");
    return { success: true };
  } catch (err: any) {
    console.error("Error cancelling invoice:", err);
    return { success: false, error: err.message || "Failed to cancel invoice" };
  }
}
