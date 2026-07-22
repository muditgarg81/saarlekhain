"use client";

import React, { useState, useMemo } from "react";
import { 
  FileText, 
  Search, 
  Download, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  Package, 
  Building2, 
  ChevronRight 
} from "lucide-react";

interface InvoiceLine {
  id: string;
  itemId: string;
  qty: number;
  rate: number;
}

interface InvoiceRecord {
  id: string;
  invoiceNo: string;
  invoiceDate: string; // ISO string
  amount: number;
  vendorId: string;
  poId: string | null;
  lines: InvoiceLine[];
}

interface GrnLine {
  id: string;
  itemId: string;
  poLineId: string | null;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
}

interface GrnRecord {
  id: string;
  number: string;
  source: string;
  vendorId: string | null;
  poId: string | null;
  invoiceNo: string | null;
  postedAt: string; // ISO string
  lines: GrnLine[];
}

interface PoLine {
  id: string;
  itemId: string;
  qty: number;
  rate: number;
  discount: number;
  gstRate: number;
}

interface PoRecord {
  id: string;
  number: string;
  vendorId: string;
  lines: PoLine[];
}

interface Item {
  id: string;
  code: string;
  name: string;
  baseUom: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface PurchaseRegisterClientProps {
  invoices: InvoiceRecord[];
  grns: GrnRecord[];
  purchaseOrders: PoRecord[];
  items: Item[];
  vendors: Vendor[];
}

// Helper to determine Indian Financial Year (April - March) for a given date string
function getFinancialYear(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (0 = Jan, 11 = Dec)
  // If month is Jan, Feb, or Mar (0, 1, 2), it belongs to previous calendar year's FY
  if (month < 3) {
    return `FY ${year - 1}-${String(year).slice(-2)}`;
  } else {
    return `FY ${year}-${String(year + 1).slice(-2)}`;
  }
}

// Check if a date string falls within a specific Indian Financial Year
function isDateInFY(dateStr: string, fy: string): boolean {
  const match = fy.match(/FY (\d{4})-\d{2}/);
  if (!match) return false;
  const startYear = parseInt(match[1]);
  const startDate = new Date(startYear, 3, 1); // April 1st
  const endDate = new Date(startYear + 1, 2, 31, 23, 59, 59); // March 31st
  const date = new Date(dateStr);
  return date >= startDate && date <= endDate;
}

const MONTHS = [
  { name: "April", index: 3 },
  { name: "May", index: 4 },
  { name: "June", index: 5 },
  { name: "July", index: 6 },
  { name: "August", index: 7 },
  { name: "September", index: 8 },
  { name: "October", index: 9 },
  { name: "November", index: 10 },
  { name: "December", index: 11 },
  { name: "January", index: 0 },
  { name: "February", index: 1 },
  { name: "March", index: 2 }
];

export default function PurchaseRegisterClient({
  invoices,
  grns,
  purchaseOrders,
  items,
  vendors
}: PurchaseRegisterClientProps) {
  const [selectedFY, setSelectedFY] = useState<string>(() => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    if (currentMonth < 3) {
      return `FY ${currentYear - 1}-${String(currentYear).slice(-2)}`;
    }
    return `FY ${currentYear}-${String(currentYear + 1).slice(-2)}`;
  });
  const [selectedVendorId, setSelectedVendorId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"summary" | "bills-pending" | "goods-pending">("summary");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Dynamically compile list of all available Financial Years from the transaction logs
  const availableFYs = useMemo(() => {
    const years = new Set<string>();
    invoices.forEach(inv => years.add(getFinancialYear(inv.invoiceDate)));
    grns.forEach(grn => years.add(getFinancialYear(grn.postedAt)));
    
    // Add current FY if not present
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const currentFY = currentMonth < 3 
      ? `FY ${currentYear - 1}-${String(currentYear).slice(-2)}` 
      : `FY ${currentYear}-${String(currentYear + 1).slice(-2)}`;
    years.add(currentFY);
    
    return Array.from(years).sort().reverse();
  }, [invoices, grns]);

  // Map helper: find item/vendor by ID
  const itemMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const vendorMap = useMemo(() => new Map(vendors.map(v => [v.id, v])), [vendors]);
  const poMap = useMemo(() => new Map(purchaseOrders.map(p => [p.id, p])), [purchaseOrders]);

  // Find the last known rate for an item to use as a fallback pricing mechanism
  const getFallbackItemRate = (itemId: string): number => {
    // Try to find rate in POs first
    for (const po of purchaseOrders) {
      const line = po.lines.find(l => l.itemId === itemId);
      if (line) return line.rate;
    }
    // Try invoices
    for (const inv of invoices) {
      const line = inv.lines.find(l => l.itemId === itemId);
      if (line) return line.rate;
    }
    return 0;
  };

  // RECONCILIATION LOGIC: Compare Invoices and GRNs for the selected FY
  const reconciliationData = useMemo(() => {
    // 1. Group GRN line items and Invoice line items by PO or Direct Invoice/GRN
    // We group by a unique key:
    // - For PO transactions: `po_[poId]_[itemId]`
    // - For Direct transactions: `direct_[vendorId]_[invoiceNo]_[itemId]`
    const grnGroups: Record<string, { qty: number; grns: GrnRecord[]; itemId: string; vendorId: string; poId: string | null; invoiceNo: string | null }> = {};
    const invoiceGroups: Record<string, { qty: number; invoices: InvoiceRecord[]; itemId: string; vendorId: string; poId: string | null; invoiceNo: string | null }> = {};

    // Process all posted GRNs in the selected FY
    grns.forEach(grn => {
      if (!isDateInFY(grn.postedAt, selectedFY)) return;
      const vId = grn.vendorId || "";
      if (selectedVendorId !== "all" && vId !== selectedVendorId) return;

      grn.lines.forEach(line => {
        let key = "";
        if (grn.poId) {
          key = `po_${grn.poId}_${line.itemId}`;
        } else {
          key = `direct_${vId}_${grn.invoiceNo || "no_invoice"}_${line.itemId}`;
        }

        if (!grnGroups[key]) {
          grnGroups[key] = {
            qty: 0,
            grns: [],
            itemId: line.itemId,
            vendorId: vId,
            poId: grn.poId,
            invoiceNo: grn.invoiceNo
          };
        }
        grnGroups[key].qty += line.acceptedQty;
        if (!grnGroups[key].grns.some(g => g.id === grn.id)) {
          grnGroups[key].grns.push(grn);
        }
      });
    });

    // Process all Supplier Invoices in the selected FY
    invoices.forEach(inv => {
      if (!isDateInFY(inv.invoiceDate, selectedFY)) return;
      if (selectedVendorId !== "all" && inv.vendorId !== selectedVendorId) return;

      inv.lines.forEach(line => {
        let key = "";
        if (inv.poId) {
          key = `po_${inv.poId}_${line.itemId}`;
        } else {
          key = `direct_${inv.vendorId}_${inv.invoiceNo}_${line.itemId}`;
        }

        if (!invoiceGroups[key]) {
          invoiceGroups[key] = {
            qty: 0,
            invoices: [],
            itemId: line.itemId,
            vendorId: inv.vendorId,
            poId: inv.poId,
            invoiceNo: inv.invoiceNo
          };
        }
        invoiceGroups[key].qty += line.qty;
        if (!invoiceGroups[key].invoices.some(i => i.id === inv.id)) {
          invoiceGroups[key].invoices.push(inv);
        }
      });
    });

    // 2. Identify mismatch states:
    const billsPendingLines: any[] = [];
    const goodsPendingLines: any[] = [];
    const allKeys = new Set([...Object.keys(grnGroups), ...Object.keys(invoiceGroups)]);

    allKeys.forEach(key => {
      const grnData = grnGroups[key];
      const invData = invoiceGroups[key];

      const itemId = grnData?.itemId || invData.itemId;
      const vendorId = grnData?.vendorId || invData.vendorId;
      const poId = grnData?.poId || invData.poId;
      const invoiceNo = grnData?.invoiceNo || invData.invoiceNo;

      const grnQty = grnData?.qty || 0;
      const invQty = invData?.qty || 0;

      const item = itemMap.get(itemId);
      const vendor = vendorMap.get(vendorId);
      const po = poId ? poMap.get(poId) : null;

      // Determine the rate
      let rate = 0;
      if (po) {
        const poLine = po.lines.find(l => l.itemId === itemId);
        if (poLine) rate = poLine.rate * (1 - poLine.discount / 100);
      } else if (invData?.invoices[0]) {
        const invLine = invData.invoices[0].lines.find(l => l.itemId === itemId);
        if (invLine) rate = invLine.rate;
      } else {
        rate = getFallbackItemRate(itemId);
      }

      if (grnQty > invQty) {
        // Goods received but bills pending
        const diffQty = grnQty - invQty;
        const value = diffQty * rate;
        billsPendingLines.push({
          key,
          itemId,
          itemCode: item?.code || "N/A",
          itemName: item?.name || "Unknown Item",
          baseUom: item?.baseUom || "UOM",
          vendorId,
          vendorCode: vendor?.code || "N/A",
          vendorName: vendor?.name || "Unknown Supplier",
          poId,
          poNumber: po?.number || null,
          invoiceNo,
          grnQty,
          invQty,
          pendingQty: diffQty,
          rate,
          value,
          documents: grnData?.grns.map(g => g.number).join(", ") || "Direct Receipt",
          date: grnData?.grns[0]?.postedAt || new Date().toISOString()
        });
      } else if (invQty > grnQty) {
        // Bills received but goods pending
        const diffQty = invQty - grnQty;
        const value = diffQty * rate;
        goodsPendingLines.push({
          key,
          itemId,
          itemCode: item?.code || "N/A",
          itemName: item?.name || "Unknown Item",
          baseUom: item?.baseUom || "UOM",
          vendorId,
          vendorCode: vendor?.code || "N/A",
          vendorName: vendor?.name || "Unknown Supplier",
          poId,
          poNumber: po?.number || null,
          invoiceNo,
          grnQty,
          invQty,
          pendingQty: diffQty,
          rate,
          value,
          documents: invData?.invoices.map(i => i.invoiceNo).join(", ") || "Direct Invoice",
          date: invData?.invoices[0]?.invoiceDate || new Date().toISOString()
        });
      }
    });

    return {
      billsPendingLines,
      goodsPendingLines
    };
  }, [grns, invoices, selectedFY, selectedVendorId, itemMap, vendorMap, poMap]);

  // Aggregate monthly values for Invoices, GRNs, and mismatch logs
  const monthlySummary = useMemo(() => {
    const data = MONTHS.map(m => ({
      name: m.name,
      index: m.index,
      billed: 0,
      grn: 0,
      billsPendingVal: 0,
      goodsPendingVal: 0
    }));

    // Billed amount month-wise
    invoices.forEach(inv => {
      if (!isDateInFY(inv.invoiceDate, selectedFY)) return;
      if (selectedVendorId !== "all" && inv.vendorId !== selectedVendorId) return;

      const date = new Date(inv.invoiceDate);
      const monthIndex = date.getMonth();
      const monthData = data.find(m => m.index === monthIndex);
      if (monthData) {
        monthData.billed += inv.amount;
      }
    });

    // GRN value month-wise
    grns.forEach(grn => {
      if (!isDateInFY(grn.postedAt, selectedFY)) return;
      const vId = grn.vendorId || "";
      if (selectedVendorId !== "all" && vId !== selectedVendorId) return;

      const date = new Date(grn.postedAt);
      const monthIndex = date.getMonth();
      const monthData = data.find(m => m.index === monthIndex);
      if (monthData) {
        // Sum lines
        let grnVal = 0;
        grn.lines.forEach(line => {
          let rate = 0;
          if (grn.poId) {
            const po = poMap.get(grn.poId);
            const poLine = po?.lines.find(l => l.itemId === line.itemId);
            if (poLine) rate = poLine.rate * (1 - poLine.discount / 100);
          } else {
            rate = getFallbackItemRate(line.itemId);
          }
          grnVal += line.acceptedQty * rate;
        });
        monthData.grn += grnVal;
      }
    });

    // Add up month-wise totals for pending mismatches
    reconciliationData.billsPendingLines.forEach(line => {
      const monthIndex = new Date(line.date).getMonth();
      const monthData = data.find(m => m.index === monthIndex);
      if (monthData) monthData.billsPendingVal += line.value;
    });

    reconciliationData.goodsPendingLines.forEach(line => {
      const monthIndex = new Date(line.date).getMonth();
      const monthData = data.find(m => m.index === monthIndex);
      if (monthData) monthData.goodsPendingVal += line.value;
    });

    return data;
  }, [invoices, grns, selectedFY, selectedVendorId, reconciliationData, poMap]);

  // Compute final totals for KPI blocks
  const totals = useMemo(() => {
    return monthlySummary.reduce((acc, m) => {
      acc.billed += m.billed;
      acc.grn += m.grn;
      acc.billsPendingVal += m.billsPendingVal;
      acc.goodsPendingVal += m.goodsPendingVal;
      return acc;
    }, { billed: 0, grn: 0, billsPendingVal: 0, goodsPendingVal: 0 });
  }, [monthlySummary]);

  // Filter pending lists based on search term
  const filteredBillsPending = useMemo(() => {
    return reconciliationData.billsPendingLines.filter(line => {
      const query = searchTerm.toLowerCase();
      return (
        line.itemCode.toLowerCase().includes(query) ||
        line.itemName.toLowerCase().includes(query) ||
        line.vendorName.toLowerCase().includes(query) ||
        (line.poNumber && line.poNumber.toLowerCase().includes(query)) ||
        line.documents.toLowerCase().includes(query)
      );
    });
  }, [reconciliationData.billsPendingLines, searchTerm]);

  const filteredGoodsPending = useMemo(() => {
    return reconciliationData.goodsPendingLines.filter(line => {
      const query = searchTerm.toLowerCase();
      return (
        line.itemCode.toLowerCase().includes(query) ||
        line.itemName.toLowerCase().includes(query) ||
        line.vendorName.toLowerCase().includes(query) ||
        (line.poNumber && line.poNumber.toLowerCase().includes(query)) ||
        line.documents.toLowerCase().includes(query)
      );
    });
  }, [reconciliationData.goodsPendingLines, searchTerm]);

  // Simple CSV download generator for Excel
  const handleExportCSV = () => {
    let headers: string[] = [];
    let rows: any[] = [];
    let filename = `PurchaseRegister_${selectedFY}`;

    if (activeTab === "summary") {
      filename += "_Summary.csv";
      headers = ["Month", "Billed Amount (₹)", "GRN Value (₹)", "Bills Pending (₹)", "Goods Pending (₹)"];
      rows = monthlySummary.map(m => [
        m.name,
        m.billed.toFixed(2),
        m.grn.toFixed(2),
        m.billsPendingVal.toFixed(2),
        m.goodsPendingVal.toFixed(2)
      ]);
      rows.push([
        "TOTAL",
        totals.billed.toFixed(2),
        totals.grn.toFixed(2),
        totals.billsPendingVal.toFixed(2),
        totals.goodsPendingVal.toFixed(2)
      ]);
    } else if (activeTab === "bills-pending") {
      filename += "_BillsPending.csv";
      headers = ["Date", "GRN / Receipt Docs", "PO No", "Supplier", "Item Code", "Item Name", "GRN Accepted", "Billed Qty", "Pending Qty", "Pending Value (₹)"];
      rows = filteredBillsPending.map(l => [
        new Date(l.date).toLocaleDateString(),
        l.documents,
        l.poNumber || "N/A",
        l.vendorName,
        l.itemCode,
        l.itemName,
        l.grnQty,
        l.invQty,
        l.pendingQty,
        l.value.toFixed(2)
      ]);
    } else {
      filename += "_GoodsPending.csv";
      headers = ["Date", "Invoice No", "PO No", "Supplier", "Item Code", "Item Name", "Billed Qty", "GRN Accepted", "Pending Qty", "Pending Value (₹)"];
      rows = filteredGoodsPending.map(l => [
        new Date(l.date).toLocaleDateString(),
        l.documents,
        l.poNumber || "N/A",
        l.vendorName,
        l.itemCode,
        l.itemName,
        l.invQty,
        l.grnQty,
        l.pendingQty,
        l.value.toFixed(2)
      ]);
    }

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.map((x: any) => `"${String(x).replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx flex items-center">
            <FileText className="text-saffron mr-2" size={22} />
            Purchase Register
          </h2>
          <p className="text-xs text-onyx/50 mt-1">
            Month-wise purchase reconciliation of logged supplier bills vs accepted warehouse goods receipts (GRNs).
          </p>
        </div>

        <div className="flex items-center space-x-3 self-end md:self-auto">
          <button
            onClick={handleExportCSV}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-cream-dark border border-onyx/10 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 cursor-pointer"
          >
            <Download size={14} className="text-onyx" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Global Filter Bar */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-cream-dark/20 flex flex-wrap items-center gap-4">
        {/* FY Selector */}
        <div className="flex items-center space-x-2">
          <Calendar size={14} className="text-onyx/60" />
          <span className="text-xs font-bold uppercase text-onyx/60">FY:</span>
          <select
            value={selectedFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            className="text-xs bg-white border border-onyx/10 rounded-lg px-3 py-1.5 focus:outline-none focus:border-saffron font-bold text-onyx"
          >
            {availableFYs.map(fy => (
              <option key={fy} value={fy}>{fy}</option>
            ))}
          </select>
        </div>

        {/* Vendor Selector */}
        <div className="flex items-center space-x-2">
          <Building2 size={14} className="text-onyx/60" />
          <span className="text-xs font-bold uppercase text-onyx/60">Supplier:</span>
          <select
            value={selectedVendorId}
            onChange={(e) => setSelectedVendorId(e.target.value)}
            className="text-xs bg-white border border-onyx/10 rounded-lg px-3 py-1.5 focus:outline-none focus:border-saffron font-bold text-onyx max-w-[200px]"
          >
            <option value="all">All Suppliers</option>
            {vendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        {(activeTab !== "summary") && (
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-onyx/40" size={14} />
            <input
              type="text"
              placeholder="Search by code, name, supplier, PO..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-4 py-1.5 bg-white border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
            />
          </div>
        )}
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Billed Amount */}
        <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Billed Purchase</p>
            <h3 className="text-lg font-extrabold text-onyx font-mono">
              ₹{totals.billed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[9px] text-onyx/50">Total Supplier Invoices</p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <TrendingUp size={20} />
          </div>
        </div>

        {/* KPI 2: GRN Value */}
        <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">GRN Receipts</p>
            <h3 className="text-lg font-extrabold text-onyx font-mono">
              ₹{totals.grn.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[9px] text-onyx/50">Value of Warehouse Receipts</p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Package size={20} />
          </div>
        </div>

        {/* KPI 3: Bills Pending */}
        <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Bills Pending</p>
            <h3 className="text-lg font-extrabold text-amber-700 font-mono">
              ₹{totals.billsPendingVal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[9px] text-onyx/50">Goods received, no bill logged</p>
          </div>
          <div className="p-3 bg-amber-50 text-amber-700 rounded-lg">
            <Clock size={20} />
          </div>
        </div>

        {/* KPI 4: Goods Pending */}
        <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Goods Pending</p>
            <h3 className="text-lg font-extrabold text-red-650 font-mono">
              ₹{totals.goodsPendingVal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[9px] text-onyx/50">Billed but not yet received</p>
          </div>
          <div className="p-3 bg-red-50 text-red-650 rounded-lg">
            <AlertCircle size={20} />
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-onyx/10">
        <button
          onClick={() => setActiveTab("summary")}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-150 cursor-pointer ${
            activeTab === "summary" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          Month Summary
        </button>
        <button
          onClick={() => setActiveTab("bills-pending")}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-150 cursor-pointer flex items-center space-x-1.5 ${
            activeTab === "bills-pending" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          <span>Goods Received but Bills Pending</span>
          <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono">
            {reconciliationData.billsPendingLines.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("goods-pending")}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-150 cursor-pointer flex items-center space-x-1.5 ${
            activeTab === "goods-pending" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          <span>Bills Received but Goods Pending</span>
          <span className="bg-red-100 text-red-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono">
            {reconciliationData.goodsPendingLines.length}
          </span>
        </button>
      </div>

      {/* Tab Panel Render */}
      <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm overflow-hidden">
        {activeTab === "summary" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-cream-dark/50 border-b border-onyx/5">
                <tr>
                  <th className="p-3 font-bold uppercase text-onyx/60">Month</th>
                  <th className="p-3 font-bold uppercase text-right text-onyx/60">Billed Purchase (₹)</th>
                  <th className="p-3 font-bold uppercase text-right text-onyx/60">GRN Receipts (₹)</th>
                  <th className="p-3 font-bold uppercase text-right text-amber-800">Bills Pending (₹)</th>
                  <th className="p-3 font-bold uppercase text-right text-red-650">Goods Pending (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5 font-mono">
                {monthlySummary.map((m) => (
                  <tr key={m.name} className="hover:bg-cream-dark/15 transition-colors">
                    <td className="p-3 font-sans font-bold text-onyx">{m.name}</td>
                    <td className="p-3 text-right">
                      {m.billed > 0 ? m.billed.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "-"}
                    </td>
                    <td className="p-3 text-right">
                      {m.grn > 0 ? m.grn.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "-"}
                    </td>
                    <td className="p-3 text-right text-amber-700 font-bold">
                      {m.billsPendingVal > 0 ? m.billsPendingVal.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "-"}
                    </td>
                    <td className="p-3 text-right text-red-650 font-bold">
                      {m.goodsPendingVal > 0 ? m.goodsPendingVal.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "-"}
                    </td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="bg-cream-dark/30 border-t-2 border-onyx/10 font-bold">
                  <td className="p-3 font-sans font-extrabold text-onyx">TOTAL</td>
                  <td className="p-3 text-right text-onyx">
                    ₹{totals.billed.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right text-onyx">
                    ₹{totals.grn.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right text-amber-700">
                    ₹{totals.billsPendingVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right text-red-650">
                    ₹{totals.goodsPendingVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "bills-pending" && (
          <div className="overflow-x-auto">
            {filteredBillsPending.length === 0 ? (
              <div className="p-8 text-center text-onyx/40 font-medium">
                No pending bills found for the selected filters.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-cream-dark/50 border-b border-onyx/5">
                  <tr>
                    <th className="p-3 font-bold uppercase text-onyx/60">Receipt Date</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">GRN No.</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">PO Reference</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">Supplier</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">Item Description</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">GRN Qty</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">Billed Qty</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">Pending Qty</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">Pending Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {filteredBillsPending.map((line) => (
                    <tr key={line.key} className="hover:bg-cream-dark/15 transition-colors">
                      <td className="p-3 text-onyx/60 font-mono whitespace-nowrap">
                        {new Date(line.date).toLocaleDateString()}
                      </td>
                      <td className="p-3 font-mono font-semibold text-onyx whitespace-nowrap">
                        {line.documents}
                      </td>
                      <td className="p-3 font-mono text-onyx/50 whitespace-nowrap">
                        {line.poNumber ? line.poNumber : <span className="text-[10px] uppercase font-bold text-onyx/30">Direct</span>}
                      </td>
                      <td className="p-3 font-medium text-onyx">
                        {line.vendorName}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-onyx">[{line.itemCode}] {line.itemName}</div>
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">{line.grnQty} {line.baseUom}</td>
                      <td className="p-3 text-right font-mono text-onyx/55">{line.invQty} {line.baseUom}</td>
                      <td className="p-3 text-right font-mono font-bold text-amber-700">{line.pendingQty} {line.baseUom}</td>
                      <td className="p-3 text-right font-mono font-bold text-onyx">
                        ₹{line.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "goods-pending" && (
          <div className="overflow-x-auto">
            {filteredGoodsPending.length === 0 ? (
              <div className="p-8 text-center text-onyx/40 font-medium">
                No pending warehouse receipts found for the selected filters.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-cream-dark/50 border-b border-onyx/5">
                  <tr>
                    <th className="p-3 font-bold uppercase text-onyx/60">Invoice Date</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">Invoice No.</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">PO Reference</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">Supplier</th>
                    <th className="p-3 font-bold uppercase text-onyx/60">Item Description</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">Billed Qty</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">GRN Qty</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">Pending Qty</th>
                    <th className="p-3 font-bold uppercase text-right text-onyx/60">Pending Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {filteredGoodsPending.map((line) => (
                    <tr key={line.key} className="hover:bg-cream-dark/15 transition-colors">
                      <td className="p-3 text-onyx/60 font-mono whitespace-nowrap">
                        {new Date(line.date).toLocaleDateString()}
                      </td>
                      <td className="p-3 font-mono font-semibold text-onyx whitespace-nowrap">
                        {line.documents}
                      </td>
                      <td className="p-3 font-mono text-onyx/50 whitespace-nowrap">
                        {line.poNumber ? line.poNumber : <span className="text-[10px] uppercase font-bold text-onyx/30">Direct</span>}
                      </td>
                      <td className="p-3 font-medium text-onyx">
                        {line.vendorName}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-onyx">[{line.itemCode}] {line.itemName}</div>
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">{line.invQty} {line.baseUom}</td>
                      <td className="p-3 text-right font-mono text-onyx/55">{line.grnQty} {line.baseUom}</td>
                      <td className="p-3 text-right font-mono font-bold text-red-650">{line.pendingQty} {line.baseUom}</td>
                      <td className="p-3 text-right font-mono font-bold text-onyx">
                        ₹{line.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
