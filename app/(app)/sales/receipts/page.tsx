import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import ReceiptsList from "./ReceiptsList";
import { getFreshUser } from "@/app/actions/auth";

export default async function ReceiptsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [receipts, customers, openInvoices] = await Promise.all([
    db.receiptVoucher.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.customer.findMany({
      where: { companyId, deletedAt: null, status: "APPROVED" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.salesInvoice.findMany({
      where: { companyId, deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      select: { id: true, number: true, customerId: true, totalAmount: true, paidAmount: true },
      orderBy: { invoiceDate: "asc" },
    }),
  ]);

  const custName = new Map(customers.map((c) => [c.id, c.name]));

  const mappedReceipts = receipts.map((r) => ({
    id: r.id,
    number: r.number,
    customer: custName.get(r.customerId) || "—",
    amount: r.amount,
    receivedOn: r.receivedOn.toISOString(),
    mode: r.mode,
    reference: r.reference,
  }));

  const invoices = openInvoices.map((i) => ({
    id: i.id,
    number: i.number,
    customerId: i.customerId,
    outstanding: +(i.totalAmount - i.paidAmount).toFixed(2),
  }));

  return <ReceiptsList initialReceipts={mappedReceipts} customers={customers} openInvoices={invoices} user={user as any} />;
}
