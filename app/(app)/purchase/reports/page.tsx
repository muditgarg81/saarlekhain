import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import PurchaseReportsList from "./PurchaseReportsList";

export default async function PurchaseReportsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // Fetch all necessary database records concurrently
  const [purchaseOrders, supplierInvoices, paymentVouchers, items, vendors] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        lines: true,
      },
      orderBy: { orderDate: "desc" },
    }),
    db.supplierInvoice.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lines: true,
      },
      orderBy: { invoiceDate: "desc" },
    }),
    db.paymentVoucher.findMany({
      where: { companyId },
      orderBy: { paidOn: "desc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        baseUom: true,
      },
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        rating: true,
      },
    }),
  ]);

  // Helper to calculate total value of a PO
  const calculatePoValue = (lines: any[]) => {
    return lines.reduce((sum, line) => {
      const lineNet = line.qty * line.rate * (1 - line.discount / 100);
      const lineGross = lineNet * (1 + line.gstRate / 100);
      return sum + lineGross;
    }, 0);
  };

  // 1. Map Purchase Orders for UI
  const mappedPos = purchaseOrders.map((po) => {
    const totalValue = calculatePoValue(po.lines);
    const totalQty = po.lines.reduce((sum, l) => sum + l.qty, 0);
    const totalReceived = po.lines.reduce((sum, l) => sum + l.receivedQty, 0);
    const fulfillmentPercent = totalQty > 0 ? (totalReceived / totalQty) * 100 : 0;

    return {
      id: po.id,
      number: po.number,
      vendorName: po.vendor?.name || "Unknown Vendor",
      vendorCode: po.vendor?.code || "N/A",
      orderDate: po.orderDate.toISOString(),
      status: po.status,
      totalValue,
      fulfillmentPercent,
      itemCount: po.lines.length,
    };
  });

  // 2. Map Vendors Spend Analysis
  const vendorSpendMap: { [vendorId: string]: { totalSpend: number; poCount: number; outstandingAmount: number } } = {};
  
  // Initialize with all vendors
  vendors.forEach(v => {
    vendorSpendMap[v.id] = { totalSpend: 0, poCount: 0, outstandingAmount: 0 };
  });

  // Aggregate PO spends
  purchaseOrders.forEach(po => {
    if (po.vendorId && vendorSpendMap[po.vendorId] && po.status !== "CANCELLED") {
      vendorSpendMap[po.vendorId].totalSpend += calculatePoValue(po.lines);
      vendorSpendMap[po.vendorId].poCount += 1;
    }
  });

  // Aggregate unpaid supplier invoices outstanding
  supplierInvoices.forEach(inv => {
    if (inv.vendorId && vendorSpendMap[inv.vendorId]) {
      // If payment is pending/matched/mismatch/onhold, it contributes to accounts payable
      vendorSpendMap[inv.vendorId].outstandingAmount += inv.amount;
    }
  });

  // Deduct payment vouchers from outstandings
  paymentVouchers.forEach(pv => {
    if (pv.vendorId && vendorSpendMap[pv.vendorId]) {
      vendorSpendMap[pv.vendorId].outstandingAmount = Math.max(0, vendorSpendMap[pv.vendorId].outstandingAmount - pv.amount);
    }
  });

  const mappedVendors = vendors.map(v => ({
    id: v.id,
    code: v.code,
    name: v.name,
    rating: v.rating || 0,
    totalSpend: vendorSpendMap[v.id]?.totalSpend || 0,
    poCount: vendorSpendMap[v.id]?.poCount || 0,
    outstandingAmount: vendorSpendMap[v.id]?.outstandingAmount || 0,
  }));

  // 3. Map Items Spend/Rate Trends
  const itemAnalysisMap: { 
    [itemId: string]: { 
      totalQtyOrdered: number; 
      totalSpent: number; 
      lastPrice: number | null; 
      lastOrderDate: string | null 
    } 
  } = {};

  items.forEach(item => {
    itemAnalysisMap[item.id] = { totalQtyOrdered: 0, totalSpent: 0, lastPrice: null, lastOrderDate: null };
  });

  // Scan PO lines to calculate item stats
  purchaseOrders.forEach(po => {
    po.lines.forEach(line => {
      if (itemAnalysisMap[line.itemId]) {
        const itemStats = itemAnalysisMap[line.itemId];
        const lineNet = line.qty * line.rate * (1 - line.discount / 100);
        itemStats.totalQtyOrdered += line.qty;
        itemStats.totalSpent += lineNet;

        // Track last purchase price by order date
        const orderDateStr = po.orderDate.toISOString();
        if (!itemStats.lastOrderDate || orderDateStr > itemStats.lastOrderDate) {
          itemStats.lastOrderDate = orderDateStr;
          itemStats.lastPrice = line.rate;
        }
      }
    });
  });

  const mappedItems = items.map(item => {
    const stats = itemAnalysisMap[item.id];
    const avgPrice = stats?.totalQtyOrdered > 0 ? stats.totalSpent / stats.totalQtyOrdered : 0;
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      baseUom: item.baseUom,
      totalQtyOrdered: stats?.totalQtyOrdered || 0,
      totalSpent: stats?.totalSpent || 0,
      avgPrice,
      lastPrice: stats?.lastPrice || 0,
    };
  });

  // 4. Map Invoices & Accounts Payable
  let totalPoSpend = 0;
  let totalInvoiceLiability = 0;
  let totalPaymentsMade = 0;
  
  purchaseOrders.forEach(po => {
    if (po.status !== "CANCELLED") {
      totalPoSpend += calculatePoValue(po.lines);
    }
  });

  supplierInvoices.forEach(inv => {
    totalInvoiceLiability += inv.amount;
  });

  paymentVouchers.forEach(pv => {
    totalPaymentsMade += pv.amount;
  });

  const accountsPayable = Math.max(0, totalInvoiceLiability - totalPaymentsMade);

  const invoiceStats = {
    totalPoSpend,
    totalInvoiceLiability,
    totalPaymentsMade,
    accountsPayable,
    mismatchCount: supplierInvoices.filter(i => i.matchStatus === "MISMATCH").length,
    pendingMatchCount: supplierInvoices.filter(i => i.matchStatus === "PENDING").length,
    matchedCount: supplierInvoices.filter(i => i.matchStatus === "MATCHED").length,
    onHoldCount: supplierInvoices.filter(i => i.matchStatus === "ON_HOLD").length,
  };

  const mappedInvoices = supplierInvoices.map(inv => {
    const vendor = vendors.find(v => v.id === inv.vendorId);
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate.toISOString(),
      vendorName: vendor?.name || "Unknown Vendor",
      amount: inv.amount,
      matchStatus: inv.matchStatus,
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    };
  });

  return (
    <PurchaseReportsList
      pos={mappedPos}
      vendors={mappedVendors}
      items={mappedItems}
      invoices={mappedInvoices}
      stats={invoiceStats}
    />
  );
}
