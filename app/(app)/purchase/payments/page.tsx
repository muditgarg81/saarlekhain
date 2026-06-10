import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import PaymentsList from "./PaymentsList";

export default async function PaymentsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch Payment Vouchers, Supplier Invoices, Vendors, Users, and debit note matching records concurrently
  const [payments, invoices, vendors, users, rejectedMaterials, grnLines, debitCreditNotes] = await Promise.all([
    db.paymentVoucher.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    }),
    db.supplierInvoice.findMany({
      where: { companyId, matchStatus: "MATCHED", deletedAt: null },
      orderBy: { invoiceDate: "desc" },
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
    db.user.findMany({
      where: { companyId },
      select: { id: true, name: true, email: true },
    }),
    db.rejectedMaterial.findMany({
      where: { companyId }
    }),
    db.grnLine.findMany({
      where: { grn: { companyId } },
      include: { grn: true }
    }),
    db.debitCreditNote.findMany({
      where: { companyId, posted: true }
    })
  ]);

  // Map rejectedMaterial.id -> poId
  const rmToPoMap = new Map<string, string>();
  rejectedMaterials.forEach(rm => {
    const gl = grnLines.find(l => l.id === rm.grnLineId);
    if (gl?.grn?.poId) {
      rmToPoMap.set(rm.id, gl.grn.poId);
    }
  });

  // Map poId -> totalDebitNoteAmount
  const poToDebitAmountMap = new Map<string, number>();
  debitCreditNotes.forEach(dn => {
    if (dn.refType === "GRN_REJECTION" && dn.refId) {
      const poId = rmToPoMap.get(dn.refId);
      if (poId) {
        poToDebitAmountMap.set(poId, (poToDebitAmountMap.get(poId) || 0) + dn.amount);
      }
    }
  });

  // Find invoices that have NOT been fully paid yet
  const paidInvoiceIds = new Set(payments.map(p => p.invoiceId).filter(Boolean));
  const unpaidInvoices = invoices.filter(inv => !paidInvoiceIds.has(inv.id)).map(inv => {
    const vendor = vendors.find(v => v.id === inv.vendorId);
    const debitNotesAmount = inv.poId ? (poToDebitAmountMap.get(inv.poId) || 0) : 0;
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      amount: inv.amount,
      debitNotesAmount,
      netAmount: inv.amount - debitNotesAmount,
      vendorId: inv.vendorId,
      vendorName: vendor?.name || "Unknown Vendor"
    };
  });

  // Map payments to clean UI structures
  const mappedPayments = payments.map((pay) => {
    const vendor = vendors.find((v) => v.id === pay.vendorId);
    const invoice = invoices.find((i) => i.id === pay.invoiceId);
    const user = users.find((u) => u.id === pay.recordedById);
    const debitNotesAmount = invoice?.poId ? (poToDebitAmountMap.get(invoice.poId) || 0) : 0;

    return {
      id: pay.id,
      number: pay.number,
      vendorId: pay.vendorId,
      vendorName: vendor?.name || "Unknown Vendor",
      invoiceId: pay.invoiceId || null,
      invoiceNo: invoice?.invoiceNo || null,
      invoiceAmount: invoice?.amount || 0,
      debitNotesAmount,
      netAmount: invoice ? (invoice.amount - debitNotesAmount) : pay.amount,
      amount: pay.amount,
      paidOn: pay.paidOn.toISOString().split("T")[0],
      mode: pay.mode,
      reference: pay.reference,
      recordedBy: user ? (user.name || user.email) : "Unknown User",
      createdAt: pay.createdAt.toISOString(),
    };
  });

  return (
    <PaymentsList
      payments={mappedPayments}
      invoices={unpaidInvoices}
      vendors={vendors}
      userRole={userRole}
    />
  );
}
