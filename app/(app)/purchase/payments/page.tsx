import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import PaymentsList from "./PaymentsList";

function parseCreditDays(terms: string | null | undefined): number {
  if (!terms) return 0;
  const normalized = terms.trim().toLowerCase();
  if (
    normalized === "adv" ||
    normalized === "advance" ||
    normalized === "advance payment" ||
    normalized === "net 0" ||
    normalized === "net0" ||
    normalized.includes("advance") ||
    /net\s*0/i.test(normalized)
  ) {
    return 0;
  }
  const match = normalized.match(/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

export default async function PaymentsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch Payment Vouchers, Supplier Invoices, Vendors, Users, debit note matching records,
  // Payment Requests, POs, GRNs, and Items concurrently
  const [
    payments,
    invoices,
    vendors,
    users,
    rejectedMaterials,
    grnLines,
    debitCreditNotes,
    paymentRequests,
    pos,
    grns,
    items
  ] = await Promise.all([
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
      select: { id: true, name: true, code: true, creditDays: true, address: true, gstin: true, pan: true },
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
    }),
    db.paymentRequest.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    }),
    db.purchaseOrder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lines: true,
        amendments: {
          orderBy: { version: "desc" },
        },
        vendor: true,
      },
      orderBy: { orderDate: "desc" },
    }),
    db.grn.findMany({
      where: { companyId, status: "POSTED", deletedAt: null },
      include: { lines: true },
      orderBy: { postedAt: "desc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, name: true },
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

  // Map payment sums to invoices (total paid per invoice) to support part payments schema
  const invoicePaidSumMap = new Map<string, number>();
  payments.forEach((pay) => {
    if (pay.invoiceId) {
      invoicePaidSumMap.set(pay.invoiceId, (invoicePaidSumMap.get(pay.invoiceId) || 0) + pay.amount);
    }
  });

  // Find invoices that have NOT been fully paid yet (balance > 0.01)
  const unpaidInvoices = invoices
    .map(inv => {
      const vendor = vendors.find(v => v.id === inv.vendorId);
      const debitNotesAmount = inv.poId ? (poToDebitAmountMap.get(inv.poId) || 0) : 0;
      const netAmount = inv.amount - debitNotesAmount;
      const paidAmount = invoicePaidSumMap.get(inv.id) || 0;
      const balanceAmount = netAmount - paidAmount;

      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        amount: inv.amount,
        debitNotesAmount,
        netAmount,
        paidAmount,
        balanceAmount,
        vendorId: inv.vendorId,
        vendorName: vendor?.name || "Unknown Vendor"
      };
    })
    .filter(inv => inv.balanceAmount > 0.01);

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

  // Map payment requests
  const mappedRequests = paymentRequests.map((req) => {
    const vendor = vendors.find((v) => v.id === req.vendorId);
    const po = pos.find((p) => p.id === req.poId);
    const grn = grns.find((g) => g.id === req.grnId);
    const recorder = users.find((u) => u.id === req.recordedById);
    const approver = users.find((u) => u.id === req.approvedById);

    return {
      id: req.id,
      number: req.number,
      vendorId: req.vendorId,
      vendorName: vendor?.name || "Unknown Vendor",
      poId: req.poId,
      poNumber: po?.number || null,
      grnId: req.grnId,
      grnNumber: grn?.number || null,
      type: req.type,
      amount: req.amount,
      remarks: req.remarks,
      status: req.status,
      recordedBy: recorder ? (recorder.name || recorder.email) : "Unknown User",
      approvedBy: approver ? (approver.name || approver.email) : null,
      createdAt: req.createdAt.toISOString(),
      updatedAt: req.updatedAt.toISOString(),
    };
  });

  // Map POs into full structures for viewing
  const mappedPOs = pos.map((po) => {
    const vendor = vendors.find((v) => v.id === po.vendorId);
    const approver = users.find((u) => u.id === po.approvedById);

    // Calculate total value
    const totalTaxable = po.lines.reduce((sum, line) => {
      return sum + line.qty * line.rate * (1 - line.discount / 100);
    }, 0);
    let totalValue = 0;
    po.lines.forEach((line) => {
      const basic = line.qty * line.rate;
      const discount = basic * (line.discount / 100);
      const taxable = basic - discount;
      const allocatedOtherCharges = totalTaxable > 0 ? po.otherCharges * (taxable / totalTaxable) : 0;
      const landed = (taxable + allocatedOtherCharges) * (1 + line.gstRate / 100);
      totalValue += landed;
    });

    return {
      id: po.id,
      number: po.number,
      vendorId: po.vendorId,
      vendorName: vendor?.name || "Unknown Vendor",
      vendorAddress: vendor?.address || "",
      vendorGstin: vendor?.gstin || "",
      vendorPan: vendor?.pan || "",
      type: po.type,
      status: po.status,
      orderDate: po.orderDate.toISOString(),
      deliveryDate: po.deliveryDate ? po.deliveryDate.toISOString() : null,
      paymentTerms: po.paymentTerms,
      freightTerms: po.freightTerms,
      shipTo: po.shipTo,
      termsConditions: po.termsConditions,
      termsPresetId: po.termsPresetId,
      termsVersion: po.termsVersion,
      resolvedTermsText: po.resolvedTermsText,
      version: po.version,
      otherCharges: po.otherCharges,
      approvedBy: approver ? (approver.name || approver.email) : null,
      approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
      totalValue,
      lines: po.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          rate: line.rate,
          discount: line.discount,
          gstRate: line.gstRate,
          receivedQty: line.receivedQty,
        };
      }),
      amendments: po.amendments.map((am) => {
        const creator = users.find((u) => u.id === am.createdById);
        return {
          id: am.id,
          version: am.version,
          reason: am.reason,
          createdAt: am.createdAt.toISOString(),
          createdBy: creator ? (creator.name || creator.email) : "System",
          snapshot: am.snapshot,
        };
      }),
    };
  });

  // Filter approved POs for dropdown (where it has approved status or not deleted)
  const approvedPos = pos
    .filter((po) => po.status === "APPROVED")
    .map((po) => ({
      id: po.id,
      number: po.number,
      vendorId: po.vendorId,
    }));

  // Map due/overdue GRNs supporting part payments schema
  const pendingGrns: any[] = [];
  const today = new Date();

  grns.forEach((grn) => {
    const vendor = vendors.find((v) => v.id === grn.vendorId);
    const po = pos.find((p) => p.id === grn.poId);

    // Calculate GRN total value from lines
    let grnValue = 0;
    grn.lines.forEach((line) => {
      const poLine = po?.lines.find((pl) => pl.id === line.poLineId);
      if (poLine) {
        const lineVal = line.receivedQty * poLine.rate * (1 + poLine.gstRate / 100);
        grnValue += lineVal;
      }
    });

    // Calculate total paid against this GRN (summing voucher references or paid requests)
    const grnPaidRequestVoucherIds = paymentRequests
      .filter((pr) => pr.grnId === grn.id && pr.status === "PAID" && pr.paymentVoucherId)
      .map((pr) => pr.paymentVoucherId);

    const grnVouchers = payments.filter((pv) => 
      grnPaidRequestVoucherIds.includes(pv.id) || 
      (pv.reference && pv.reference.includes(grn.number))
    );

    const paidAmount = grnVouchers.reduce((sum, pv) => sum + pv.amount, 0);

    const balanceAmount = grnValue - paidAmount;

    if (balanceAmount > 0.01) {
      // Calculate due date
      const grnDate = grn.postedAt || grn.createdAt;
      const creditDays = po?.paymentTerms
        ? parseCreditDays(po.paymentTerms)
        : vendor?.creditDays || 30; // fallback to vendor's credit days or default to 30

      const dueDate = new Date(grnDate.getTime() + creditDays * 24 * 60 * 60 * 1000);
      const isOverdue = today > dueDate;

      // Calculate diff in days
      const diffTime = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      pendingGrns.push({
        id: grn.id,
        number: grn.number,
        vendorId: grn.vendorId || "",
        vendorName: vendor?.name || "Unknown Vendor",
        poId: grn.poId || "",
        poNumber: po?.number || "",
        amount: balanceAmount, // suggest remaining balance
        totalAmount: grnValue, // original invoice/GRN value
        paidAmount,
        postedAt: grnDate.toISOString().split("T")[0],
        dueDate: dueDate.toISOString().split("T")[0],
        isOverdue,
        daysOverdue: isOverdue ? Math.abs(diffDays) : 0,
        daysUntilDue: !isOverdue ? diffDays : 0,
      });
    }
  });

  return (
    <PaymentsList
      payments={mappedPayments}
      invoices={unpaidInvoices}
      vendors={vendors}
      userRole={userRole}
      paymentRequests={mappedRequests}
      approvedPos={approvedPos}
      pendingGrns={pendingGrns}
      allPos={mappedPOs}
    />
  );
}
