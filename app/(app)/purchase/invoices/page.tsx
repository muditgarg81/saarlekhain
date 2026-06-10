import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import InvoicesList from "./InvoicesList";

export default async function InvoicesPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch Supplier Invoices, POs, Items, and Vendors concurrently
  const [invoices, purchaseOrders, items, vendors] = await Promise.all([
    db.supplierInvoice.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lines: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.purchaseOrder.findMany({
      where: { companyId, status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } },
      include: {
        lines: true,
      },
      orderBy: { number: "asc" },
    }),
    db.item.findMany({
      where: { companyId, status: "ACTIVE", deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
  ]);

  // Map database instances to clean serializable props for the client component
  const mappedInvoices = invoices.map((inv) => {
    const vendor = vendors.find((v) => v.id === inv.vendorId);
    const po = purchaseOrders.find((p) => p.id === inv.poId);

    // Extract discrepancies from ocrDraft json if any
    let discrepancies: string[] = [];
    if (inv.ocrDraft) {
      try {
        const parsed = typeof inv.ocrDraft === 'string' ? JSON.parse(inv.ocrDraft) : inv.ocrDraft;
        if (parsed && Array.isArray(parsed.discrepancies)) {
          discrepancies = parsed.discrepancies;
        }
      } catch (e) {
        console.error("Error parsing invoice discrepancies", e);
      }
    }

    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
      dueDate: inv.dueDate ? inv.dueDate.toISOString().split("T")[0] : null,
      amount: inv.amount,
      matchStatus: inv.matchStatus,
      discrepancies,
      vendorId: inv.vendorId,
      vendorName: vendor?.name || "Unknown Vendor",
      poId: inv.poId,
      poNumber: po?.number || null,
      lines: inv.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          rate: line.rate,
        };
      }),
    };
  });

  const mappedPOs = purchaseOrders.map((po) => ({
    id: po.id,
    number: po.number,
    lines: po.lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      rate: l.rate,
    })),
  }));

  return (
    <InvoicesList
      invoices={mappedInvoices}
      purchaseOrders={mappedPOs}
      items={items}
      vendors={vendors}
      userRole={userRole}
    />
  );
}
