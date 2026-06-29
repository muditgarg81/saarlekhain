import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import SalesInvoicesList from "./SalesInvoicesList";
import { getFreshUser } from "@/app/actions/auth";

export default async function SalesInvoicesPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [invoices, dispatches, customers] = await Promise.all([
    db.salesInvoice.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { dispatch: { select: { number: true } } },
      take: 200,
    }),
    db.dispatch.findMany({
      where: { companyId, deletedAt: null, soId: { not: null }, status: { in: ["DISPATCHED", "DELIVERED"] } },
      include: { invoices: { select: { id: true } }, so: { select: { number: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.customer.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);

  const custName = new Map(customers.map((c) => [c.id, c.name]));

  const mappedInvoices = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    customer: custName.get(inv.customerId) || "—",
    dispatchNumber: inv.dispatch?.number || null,
    invoiceDate: inv.invoiceDate.toISOString(),
    dueDate: inv.dueDate?.toISOString() || null,
    taxableAmount: inv.taxableAmount,
    totalAmount: inv.totalAmount,
    paidAmount: inv.paidAmount,
    status: inv.status,
    einvoiceStatus: inv.einvoiceStatus,
    irn: inv.irn,
  }));

  const eligible = dispatches
    .filter((d) => d.invoices.length === 0)
    .map((d) => ({
      id: d.id,
      label: `${d.number} — ${custName.get(d.customerId) || ""} (${d.so?.number || ""})`,
    }));

  return <SalesInvoicesList initialInvoices={mappedInvoices} eligibleDispatches={eligible} user={user as any} />;
}
