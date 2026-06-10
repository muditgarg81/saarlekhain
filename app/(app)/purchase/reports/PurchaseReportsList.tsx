"use client";

import { useState } from "react";
import { 
  Search, 
  FileSpreadsheet, 
  ShoppingBag, 
  TrendingUp, 
  Users, 
  Receipt,
  ArrowRight,
  ChevronRight,
  TrendingDown,
  AlertCircle,
  Clock,
  Coins
} from "lucide-react";
import * as xlsx from "xlsx";

interface PoRow {
  id: string;
  number: string;
  vendorName: string;
  vendorCode: string;
  orderDate: string;
  status: string;
  totalValue: number;
  fulfillmentPercent: number;
  itemCount: number;
}

interface VendorRow {
  id: string;
  code: string;
  name: string;
  rating: number;
  totalSpend: number;
  poCount: number;
  outstandingAmount: number;
}

interface ItemRow {
  id: string;
  code: string;
  name: string;
  baseUom: string;
  totalQtyOrdered: number;
  totalSpent: number;
  avgPrice: number;
  lastPrice: number;
}

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  vendorName: string;
  amount: number;
  matchStatus: string;
  dueDate: string | null;
}

interface Stats {
  totalPoSpend: number;
  totalInvoiceLiability: number;
  totalPaymentsMade: number;
  accountsPayable: number;
  mismatchCount: number;
  pendingMatchCount: number;
  matchedCount: number;
  onHoldCount: number;
}

interface PurchaseReportsListProps {
  pos: PoRow[];
  vendors: VendorRow[];
  items: ItemRow[];
  invoices: InvoiceRow[];
  stats: Stats;
}

type TabType = "pos" | "vendors" | "items" | "ap";

export default function PurchaseReportsList({
  pos,
  vendors,
  items,
  invoices,
  stats
}: PurchaseReportsListProps) {
  const [activeTab, setActiveTab] = useState<TabType>("pos");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  };

  // 1. Filtering Logic
  const getFilteredData = () => {
    switch (activeTab) {
      case "pos":
        return pos.filter(po => {
          const matchesSearch = po.number.toLowerCase().includes(search.toLowerCase()) ||
                                po.vendorName.toLowerCase().includes(search.toLowerCase());
          const matchesStatus = statusFilter === "all" || po.status === statusFilter;
          return matchesSearch && matchesStatus;
        });
      case "vendors":
        return vendors.filter(v => 
          v.name.toLowerCase().includes(search.toLowerCase()) || 
          v.code.toLowerCase().includes(search.toLowerCase())
        );
      case "items":
        return items.filter(item => 
          item.name.toLowerCase().includes(search.toLowerCase()) || 
          item.code.toLowerCase().includes(search.toLowerCase())
        );
      case "ap":
        return invoices.filter(inv => {
          const matchesSearch = inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
                                inv.vendorName.toLowerCase().includes(search.toLowerCase());
          const matchesStatus = statusFilter === "all" || inv.matchStatus === statusFilter;
          return matchesSearch && matchesStatus;
        });
      default:
        return [];
    }
  };

  const filteredData = getFilteredData();

  // 2. Excel Export Logic
  const handleExport = () => {
    let dataToExport: any[] = [];
    let fileName = "";
    let sheetName = "";

    if (activeTab === "pos") {
      dataToExport = (filteredData as PoRow[]).map(po => ({
        "PO Number": po.number,
        "Order Date": formatDate(po.orderDate),
        "Vendor": po.vendorName,
        "Vendor Code": po.vendorCode,
        "PO Value (INR)": po.totalValue.toFixed(2),
        "Fulfillment %": po.fulfillmentPercent.toFixed(1) + "%",
        "Items Ordered": po.itemCount,
        "Status": po.status
      }));
      fileName = "Saarlekha_Purchase_Orders_Report.xlsx";
      sheetName = "Purchase Orders";
    } else if (activeTab === "vendors") {
      dataToExport = (filteredData as VendorRow[]).map(v => ({
        "Vendor Code": v.code,
        "Vendor Name": v.name,
        "POs Raised": v.poCount,
        "Total Spend (INR)": v.totalSpend.toFixed(2),
        "Outstanding Payable (INR)": v.outstandingAmount.toFixed(2),
        "Rating": v.rating.toFixed(1)
      }));
      fileName = "Saarlekha_Vendor_Spend_Analysis.xlsx";
      sheetName = "Vendor Spend";
    } else if (activeTab === "items") {
      dataToExport = (filteredData as ItemRow[]).map(item => ({
        "Item Code": item.code,
        "Item Name": item.name,
        "Base UOM": item.baseUom,
        "Total Qty Ordered": item.totalQtyOrdered,
        "Avg Purchase Price (INR)": item.avgPrice.toFixed(2),
        "Last Purchase Price (INR)": item.lastPrice.toFixed(2),
        "Total Spent (INR)": item.totalSpent.toFixed(2)
      }));
      fileName = "Saarlekha_Item_Purchase_Trends.xlsx";
      sheetName = "Item Purchase Trends";
    } else if (activeTab === "ap") {
      dataToExport = (filteredData as InvoiceRow[]).map(inv => ({
        "Invoice No": inv.invoiceNo,
        "Invoice Date": formatDate(inv.invoiceDate),
        "Vendor": inv.vendorName,
        "Amount (INR)": inv.amount.toFixed(2),
        "Match Status": inv.matchStatus,
        "Due Date": inv.dueDate ? formatDate(inv.dueDate) : "N/A"
      }));
      fileName = "Saarlekha_Accounts_Payable_Report.xlsx";
      sheetName = "Accounts Payable";
    }

    const worksheet = xlsx.utils.json_to_sheet(dataToExport);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
    xlsx.writeFile(workbook, fileName);
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Purchase & Spend Reports</h2>
          <p className="text-xs text-onyx/50 mt-1">
            Real-time visual metrics, price trend tracking, and reconciliation audits.
          </p>
        </div>
        <div>
          <button
            onClick={handleExport}
            className="flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-cream-dark/50 border border-onyx/10 rounded-lg text-xs font-semibold text-onyx shadow-sm transition-all duration-150 cursor-pointer"
          >
            <FileSpreadsheet size={15} className="text-emerald-700" />
            <span>Export Active Report</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Spend */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total PO Commitments</p>
            <p className="text-xl font-bold text-onyx mt-0.5">{formatCurrency(stats.totalPoSpend)}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Approved procurement value</p>
          </div>
        </div>

        {/* Total Liability */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark">
            <Receipt size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total Invoice Liability</p>
            <p className="text-xl font-bold text-onyx mt-0.5">{formatCurrency(stats.totalInvoiceLiability)}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Billed by vendors</p>
          </div>
        </div>

        {/* Net Accounts Payable */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark">
            <Coins size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Accounts Payable</p>
            <p className="text-xl font-bold text-onyx mt-0.5">{formatCurrency(stats.accountsPayable)}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Net unpaid balance</p>
          </div>
        </div>

        {/* Mismatches */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className={`p-3 border rounded-lg ${
            stats.mismatchCount > 0 
              ? "bg-red-50 border-red-100 text-red-600 animate-pulse" 
              : "bg-cream-dark border-onyx/5 text-green-600"
          }`}>
            <AlertCircle size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Invoice Mismatches</p>
            <p className="text-xl font-bold text-onyx mt-0.5">{stats.mismatchCount}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Failed 3-way match audits</p>
          </div>
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="border-b border-onyx/10 flex space-x-6">
        <button
          onClick={() => { setActiveTab("pos"); setSearch(""); setStatusFilter("all"); }}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === "pos" 
              ? "border-b-2 border-saffron text-onyx" 
              : "text-onyx/40 hover:text-onyx/70"
          }`}
        >
          Purchase Orders
        </button>
        <button
          onClick={() => { setActiveTab("vendors"); setSearch(""); }}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === "vendors" 
              ? "border-b-2 border-saffron text-onyx" 
              : "text-onyx/40 hover:text-onyx/70"
          }`}
        >
          Vendor Spend Analysis
        </button>
        <button
          onClick={() => { setActiveTab("items"); setSearch(""); }}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === "items" 
              ? "border-b-2 border-saffron text-onyx" 
              : "text-onyx/40 hover:text-onyx/70"
          }`}
        >
          Price & Rate Trends
        </button>
        <button
          onClick={() => { setActiveTab("ap"); setSearch(""); setStatusFilter("all"); }}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === "ap" 
              ? "border-b-2 border-saffron text-onyx" 
              : "text-onyx/40 hover:text-onyx/70"
          }`}
        >
          Invoices & AP Aging
        </button>
      </div>

      {/* Search & Filter Controls */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder={
              activeTab === "pos" ? "Search by PO number, vendor..." :
              activeTab === "vendors" ? "Search by vendor code, name..." :
              activeTab === "items" ? "Search by item code, name..." :
              "Search by invoice no, vendor..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        {/* Conditional Filters */}
        {activeTab === "pos" && (
          <div className="w-full md:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron w-full"
            >
              <option value="all">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="SENT">Sent</option>
              <option value="PARTIALLY_RECEIVED">Partially Received</option>
              <option value="RECEIVED">Received</option>
              <option value="CLOSED">Closed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        )}

        {activeTab === "ap" && (
          <div className="w-full md:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron w-full"
            >
              <option value="all">All Match Statuses</option>
              <option value="PENDING">Pending Match</option>
              <option value="MATCHED">Matched</option>
              <option value="MISMATCH">Mismatch Alert</option>
              <option value="ON_HOLD">On Hold</option>
            </select>
          </div>
        )}
      </div>

      {/* Main Report Table Container */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          {activeTab === "pos" && (
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Order Date</th>
                  <th>Vendor</th>
                  <th className="text-right">PO Value</th>
                  <th className="text-center">Fulfillment</th>
                  <th>Lines</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-onyx/40 font-medium">
                      No purchase orders found.
                    </td>
                  </tr>
                ) : (
                  (filteredData as PoRow[]).map(po => {
                    let statusColor = "bg-gray-100 text-gray-800";
                    if (po.status === "APPROVED" || po.status === "SENT") statusColor = "bg-blue-100 text-blue-800";
                    else if (po.status === "RECEIVED" || po.status === "CLOSED") statusColor = "bg-green-100 text-green-800";
                    else if (po.status === "PENDING_APPROVAL") statusColor = "bg-amber-100 text-amber-800";
                    else if (po.status === "CANCELLED") statusColor = "bg-red-100 text-red-800";

                    return (
                      <tr key={po.id}>
                        <td className="font-mono font-bold text-xs text-onyx/85">{po.number}</td>
                        <td>{formatDate(po.orderDate)}</td>
                        <td className="font-semibold">{po.vendorName}</td>
                        <td className="text-right font-mono font-bold text-onyx">{formatCurrency(po.totalValue)}</td>
                        <td className="align-middle">
                          <div className="flex items-center space-x-2 justify-center">
                            <div className="w-16 bg-cream-dark border border-onyx/5 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-saffron h-full rounded-full" 
                                style={{ width: `${Math.min(100, po.fulfillmentPercent)}%` }} 
                              />
                            </div>
                            <span className="text-[10px] font-mono font-bold text-onyx/65">
                              {po.fulfillmentPercent.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="font-mono text-xs">{po.itemCount} items</td>
                        <td className="text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${statusColor}`}>
                            {po.status.replace("_", " ")}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {activeTab === "vendors" && (
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th>Vendor Code</th>
                  <th>Vendor Name</th>
                  <th className="text-right">Orders Raised</th>
                  <th className="text-right">Total Commited spend</th>
                  <th className="text-right">Outstanding Payable</th>
                  <th className="text-center">Vendor Rating</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-onyx/40 font-medium">
                      No vendor analytics found.
                    </td>
                  </tr>
                ) : (
                  (filteredData as VendorRow[]).map(v => (
                    <tr key={v.id}>
                      <td className="font-mono font-bold text-xs text-onyx/85">{v.code}</td>
                      <td className="font-semibold">{v.name}</td>
                      <td className="text-right font-mono">{v.poCount} POs</td>
                      <td className="text-right font-mono font-bold text-onyx">{formatCurrency(v.totalSpend)}</td>
                      <td className="text-right font-mono text-red-700 font-semibold">{formatCurrency(v.outstandingAmount)}</td>
                      <td className="text-center">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          ★ {v.rating > 0 ? v.rating.toFixed(1) : "N/A"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "items" && (
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Description</th>
                  <th>UOM</th>
                  <th className="text-right">Total Qty Ordered</th>
                  <th className="text-right">Avg Purchase Price</th>
                  <th className="text-right">Last Purchase Price</th>
                  <th className="text-right">Total Spent</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-onyx/40 font-medium">
                      No item rate trends found.
                    </td>
                  </tr>
                ) : (
                  (filteredData as ItemRow[]).map(item => (
                    <tr key={item.id}>
                      <td className="font-mono font-bold text-xs text-onyx/85">{item.code}</td>
                      <td className="font-semibold">{item.name}</td>
                      <td>{item.baseUom}</td>
                      <td className="text-right font-mono font-bold">{item.totalQtyOrdered}</td>
                      <td className="text-right font-mono text-onyx">{formatCurrency(item.avgPrice)}</td>
                      <td className="text-right font-mono text-saffron-dark font-semibold">{formatCurrency(item.lastPrice)}</td>
                      <td className="text-right font-mono font-bold text-onyx">{formatCurrency(item.totalSpent)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "ap" && (
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Invoice Date</th>
                  <th>Supplier Name</th>
                  <th className="text-right">Billed Amount</th>
                  <th className="text-center">Match Status</th>
                  <th>Payment Due Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-onyx/40 font-medium">
                      No invoice aging data found.
                    </td>
                  </tr>
                ) : (
                  (filteredData as InvoiceRow[]).map(inv => {
                    let matchBadge = "bg-gray-100 text-gray-800";
                    if (inv.matchStatus === "MATCHED") matchBadge = "bg-green-100 text-green-800";
                    else if (inv.matchStatus === "MISMATCH") matchBadge = "bg-red-100 text-red-800";
                    else if (inv.matchStatus === "PENDING") matchBadge = "bg-amber-100 text-amber-800";
                    else if (inv.matchStatus === "ON_HOLD") matchBadge = "bg-orange-100 text-orange-850";

                    return (
                      <tr key={inv.id}>
                        <td className="font-mono font-bold text-xs text-onyx/85">{inv.invoiceNo}</td>
                        <td>{formatDate(inv.invoiceDate)}</td>
                        <td className="font-semibold">{inv.vendorName}</td>
                        <td className="text-right font-mono font-bold text-onyx">{formatCurrency(inv.amount)}</td>
                        <td className="text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${matchBadge}`}>
                            {inv.matchStatus.replace("_", " ")}
                          </span>
                        </td>
                        <td className="font-medium text-onyx/75">
                          {inv.dueDate ? (
                            <div className="flex items-center space-x-1">
                              <Clock size={12} className="text-onyx/40" />
                              <span>{formatDate(inv.dueDate)}</span>
                            </div>
                          ) : (
                            <span className="text-onyx/30">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
