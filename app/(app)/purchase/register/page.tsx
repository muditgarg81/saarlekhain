export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getFreshUser } from "@/app/actions/auth";
import PurchaseRegisterClient from "./PurchaseRegisterClient";

export default async function PurchaseRegisterPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const companyId = user.companyId;

  // Fetch Supplier Invoices, GRNs, POs, Items, and Vendors concurrently
  const [invoices, grns, purchaseOrders, items, vendors] = await Promise.all([
    db.supplierInvoice.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lines: true,
      },
      orderBy: { invoiceDate: "desc" },
    }),
    db.grn.findMany({
      where: { companyId, status: "POSTED", deletedAt: null },
      include: {
        lines: true,
      },
      orderBy: { postedAt: "desc" },
    }),
    db.purchaseOrder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lines: true,
      },
    }),
    db.item.findMany({
      where: { companyId, status: "ACTIVE", deletedAt: null },
      select: { id: true, code: true, name: true, baseUom: true },
      orderBy: { code: "asc" },
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
  ]);

  // Map to serializable props
  const mappedInvoices = invoices.map((inv) => ({
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate.toISOString(),
    amount: inv.amount,
    vendorId: inv.vendorId,
    poId: inv.poId,
    lines: inv.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      qty: l.qty,
      rate: l.rate,
    })),
  }));

  const mappedGrns = grns.map((g) => ({
    id: g.id,
    number: g.number,
    source: g.source,
    vendorId: g.vendorId,
    poId: g.poId,
    invoiceNo: g.invoiceNo,
    postedAt: g.postedAt ? g.postedAt.toISOString() : g.createdAt.toISOString(),
    lines: g.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      poLineId: l.poLineId,
      receivedQty: l.receivedQty,
      acceptedQty: l.acceptedQty,
      rejectedQty: l.rejectedQty,
    })),
  }));

  const mappedPos = purchaseOrders.map((po) => ({
    id: po.id,
    number: po.number,
    vendorId: po.vendorId,
    lines: po.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      qty: l.qty,
      rate: l.rate,
      discount: l.discount,
      gstRate: l.gstRate,
    })),
  }));

  return (
    <PurchaseRegisterClient
      invoices={mappedInvoices}
      grns={mappedGrns}
      purchaseOrders={mappedPos}
      items={items}
      vendors={vendors}
    />
  );
}
