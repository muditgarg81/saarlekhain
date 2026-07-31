"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Truck, FileText, BarChart2, Route, CreditCard, FileSpreadsheet,
  TrendingUp, AlertCircle, Clock, CheckCircle2, Search, X
} from "lucide-react";
import * as xlsx from "xlsx";

interface OrderRow {
  id: string; number: string; createdAt: string; status: string;
  transporterName: string; transporterCode: string;
  fromLocation: string; toLocation: string; vehicleCapacity: string;
  vehicleNo: string | null; driverName: string | null;
  freightAmount: number; otherCharges: number; taxRate: number; totalAmount: number;
  poNumber: string | null; tripDescription: string | null;
  totalBilled: number; totalPaid: number; outstanding: number;
}

interface BillRow {
  id: string; billNo: string; billDate: string; dueDate: string | null;
  amount: number; paid: number; balance: number; paymentStatus: string;
  transportOrderNo: string; transporterName: string; daysOverdue: number | null;
}

interface TransporterStat {
  name: string; code: string; orderCount: number; totalFreight: number;
  delivered: number; billed: number; paid: number;
}

interface RouteStat {
  from: string; to: string; orderCount: number; totalFreight: number; avgFreight: number;
}

interface MonthlyTrend {
  label: string; count: number; freight: number;
}

interface ContractRow {
  id: string; contractNo: string | null; transporterName: string;
  fromLocation: string; toLocation: string; vehicleCapacity: string;
  rate: number; usageCount: number;
}

interface Kpis {
  totalOrders: number; totalFreight: number; totalBilled: number;
  totalPaid: number; totalOutstanding: number; overdueCount: number; deliveredPct: number;
}

interface Props {
  orders: OrderRow[]; bills: BillRow[]; transporterStats: TransporterStat[];
  routeStats: RouteStat[]; monthlyTrend: MonthlyTrend[]; contracts: ContractRow[];
  kpis: Kpis; period: string; startDate: string; endDate: string;
}

const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  PLANNED: "bg-amber-100 text-amber-700",
  IN_TRANSIT: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-600",
  PAID: "bg-green-100 text-green-700",
  PARTIALLY_PAID: "bg-amber-100 text-amber-700",
  PENDING: "bg-gray-100 text-gray-600",
};

type Tab = "orders" | "transporters" | "routes" | "bills" | "contracts" | "trend";

export default function LogisticsReportsList({
  orders, bills, transporterStats, routeStats, monthlyTrend, contracts, kpis,
  period, startDate, endDate,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("orders");
  const [search, setSearch] = useState("");

  const applyPeriod = (p: string) => {
    const params = new URLSearchParams();
    params.set("period", p);
    if (startDate) params.set("startDate", startDate);
    if (endDate)   params.set("endDate", endDate);
    router.push(`/logistics/reports?${params}`);
  };

  const applyCustom = (sd: string, ed: string) => {
    router.push(`/logistics/reports?period=custom&startDate=${sd}&endDate=${ed}`);
  };

  // filtered orders
  const filteredOrders = orders.filter(o =>
    [o.number, o.transporterName, o.fromLocation, o.toLocation, o.vehicleNo, o.tripDescription]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredBills = bills.filter(b =>
    [b.billNo, b.transportOrderNo, b.transporterName]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const exportOrders = () => {
    const rows = filteredOrders.map(o => ({
      "TO Number": o.number,
      "Date": fmtDate(o.createdAt),
      "Status": o.status,
      "Transporter": o.transporterName,
      "From": o.fromLocation,
      "To": o.toLocation,
      "Capacity": o.vehicleCapacity,
      "Vehicle No": o.vehicleNo || "",
      "Driver": o.driverName || "",
      "Base Freight": o.freightAmount,
      "Other Charges": o.otherCharges,
      "GST %": o.taxRate,
      "Total Amount": o.totalAmount,
      "Billed": o.totalBilled,
      "Paid": o.totalPaid,
      "Outstanding": o.outstanding,
      "Linked PO": o.poNumber || "",
      "Trip Remarks": o.tripDescription || "",
    }));
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Transport Orders");
    xlsx.writeFile(wb, `Logistics-Orders-${period}.xlsx`);
  };

  const exportBills = () => {
    const rows = filteredBills.map(b => ({
      "Bill No": b.billNo,
      "Bill Date": fmtDate(b.billDate),
      "Due Date": b.dueDate ? fmtDate(b.dueDate) : "",
      "Transport Order": b.transportOrderNo,
      "Transporter": b.transporterName,
      "Amount": b.amount,
      "Paid": b.paid,
      "Balance": b.balance,
      "Status": b.paymentStatus,
      "Days Overdue": b.daysOverdue !== null && b.daysOverdue > 0 ? b.daysOverdue : "",
    }));
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Freight Bills");
    xlsx.writeFile(wb, `Logistics-Bills-${period}.xlsx`);
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "orders",      label: "Orders Register",     icon: <Truck size={14} /> },
    { id: "transporters",label: "Transporter Analysis", icon: <BarChart2 size={14} /> },
    { id: "routes",      label: "Route Analysis",       icon: <Route size={14} /> },
    { id: "bills",       label: "Payment Ageing",       icon: <CreditCard size={14} /> },
    { id: "contracts",   label: "Contract Utilisation", icon: <FileText size={14} /> },
    { id: "trend",       label: "Monthly Trend",        icon: <TrendingUp size={14} /> },
  ];

  const maxFreight = Math.max(...monthlyTrend.map(m => m.freight), 1);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-onyx flex items-center gap-2">
            <Truck className="text-saffron" size={22} />
            Logistics Reports
          </h1>
          <p className="text-xs text-onyx/50 mt-0.5">Transport costs, transporter performance, route analysis, and payment ageing</p>
        </div>

        {/* Period filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {["all","1m","3m","6m","1y","custom"].map(p => (
            <button key={p} onClick={() => p !== "custom" ? applyPeriod(p) : undefined}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${period === p ? "bg-saffron text-onyx border-saffron shadow" : "border-onyx/10 hover:bg-cream-dark/15 text-onyx/60"}`}>
              {p === "all" ? "All Time" : p === "1m" ? "1 Month" : p === "3m" ? "3 Months" : p === "6m" ? "6 Months" : p === "1y" ? "1 Year" : "Custom"}
            </button>
          ))}
          {period === "custom" && (
            <div className="flex items-center gap-1">
              <input type="date" defaultValue={startDate} className="text-xs border border-onyx/10 rounded px-2 py-1"
                onChange={e => applyCustom(e.target.value, endDate)} />
              <span className="text-xs text-onyx/40">to</span>
              <input type="date" defaultValue={endDate} className="text-xs border border-onyx/10 rounded px-2 py-1"
                onChange={e => applyCustom(startDate, e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Total Orders",    value: kpis.totalOrders.toString(),       sub: "transport orders",   icon: <Truck size={16} />,         color: "text-saffron" },
          { label: "Total Freight",   value: fmt(kpis.totalFreight),             sub: "all orders",         icon: <TrendingUp size={16} />,    color: "text-blue-500" },
          { label: "Total Billed",    value: fmt(kpis.totalBilled),             sub: "freight bills raised", icon: <FileText size={16} />,   color: "text-purple-500" },
          { label: "Total Paid",      value: fmt(kpis.totalPaid),               sub: "payments recorded",  icon: <CheckCircle2 size={16} />,  color: "text-green-500" },
          { label: "Outstanding",     value: fmt(kpis.totalOutstanding),        sub: "unpaid balance",     icon: <CreditCard size={16} />,    color: "text-amber-500" },
          { label: "Overdue Bills",   value: kpis.overdueCount.toString(),       sub: "past due date",      icon: <AlertCircle size={16} />,   color: "text-red-500" },
          { label: "Delivery Rate",   value: `${kpis.deliveredPct}%`,           sub: "orders delivered",   icon: <Clock size={16} />,         color: "text-emerald-500" },
        ].map(k => (
          <div key={k.label} className="bg-white border border-onyx/5 rounded-xl p-3 shadow-sm">
            <div className={`mb-1 ${k.color}`}>{k.icon}</div>
            <p className="text-lg font-bold text-onyx leading-tight">{k.value}</p>
            <p className="text-[10px] text-onyx/40 font-semibold uppercase tracking-wide mt-0.5">{k.label}</p>
            <p className="text-[9px] text-onyx/30 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="bg-white border border-onyx/5 rounded-xl shadow-sm overflow-hidden">
        <div className="flex border-b border-onyx/5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setSearch(""); }}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap transition border-b-2 cursor-pointer ${activeTab === t.id ? "border-saffron text-saffron bg-saffron/5" : "border-transparent text-onyx/50 hover:text-onyx hover:bg-cream-dark/10"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Search bar for list tabs */}
        {(activeTab === "orders" || activeTab === "bills") && (
          <div className="p-3 border-b border-onyx/5 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-onyx/30" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={activeTab === "orders" ? "Search orders..." : "Search bills..."}
                className="w-full pl-8 pr-3 py-2 text-xs border border-onyx/10 rounded-lg bg-cream-dark/10 focus:outline-none focus:ring-1 focus:ring-saffron" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-onyx/30 hover:text-onyx cursor-pointer"><X size={12} /></button>}
            </div>
            <button
              onClick={activeTab === "orders" ? exportOrders : exportBills}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition cursor-pointer">
              <FileSpreadsheet size={13} /> Export Excel
            </button>
          </div>
        )}

        {/* ── ORDERS REGISTER ── */}
        {activeTab === "orders" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-dark/20 border-b border-onyx/5">
                <tr>
                  {["TO No.", "Date", "Transporter", "Route", "Capacity", "Vehicle", "Base Freight", "Other", "GST%", "Total", "Billed", "Paid", "Outstanding", "Status", "Linked PO"].map(h => (
                    <th key={h} className="p-3 text-left font-bold uppercase text-[10px] text-onyx/50 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredOrders.map(o => (
                  <tr key={o.id} className="hover:bg-cream-dark/10 transition-colors">
                    <td className="p-3 font-mono font-bold text-onyx">{o.number}</td>
                    <td className="p-3 whitespace-nowrap text-onyx/60">{fmtDate(o.createdAt)}</td>
                    <td className="p-3 font-semibold text-onyx">{o.transporterName}</td>
                    <td className="p-3 whitespace-nowrap text-onyx/70">{o.fromLocation} → {o.toLocation}</td>
                    <td className="p-3 text-onyx/60">{o.vehicleCapacity}</td>
                    <td className="p-3 font-mono text-onyx/70">{o.vehicleNo || "—"}</td>
                    <td className="p-3 text-right font-mono">{fmt(o.freightAmount)}</td>
                    <td className="p-3 text-right font-mono text-onyx/60">{o.otherCharges > 0 ? fmt(o.otherCharges) : "—"}</td>
                    <td className="p-3 text-center text-onyx/60">{o.taxRate > 0 ? `${o.taxRate}%` : "—"}</td>
                    <td className="p-3 text-right font-mono font-bold">{fmt(o.totalAmount)}</td>
                    <td className="p-3 text-right font-mono text-purple-600">{o.totalBilled > 0 ? fmt(o.totalBilled) : "—"}</td>
                    <td className="p-3 text-right font-mono text-green-600">{o.totalPaid > 0 ? fmt(o.totalPaid) : "—"}</td>
                    <td className="p-3 text-right font-mono text-amber-600">{o.outstanding > 0 ? fmt(o.outstanding) : "—"}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_BADGE[o.status] || "bg-gray-100 text-gray-600"}`}>{o.status.replace("_"," ")}</span>
                    </td>
                    <td className="p-3 font-mono text-onyx/50">{o.poNumber || "—"}</td>
                  </tr>
                ))}
                {filteredOrders.length === 0 && (
                  <tr><td colSpan={15} className="p-8 text-center text-onyx/30 font-medium">No orders found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── TRANSPORTER ANALYSIS ── */}
        {activeTab === "transporters" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-dark/20 border-b border-onyx/5">
                <tr>
                  {["Transporter", "Code", "Orders", "Delivered", "Delivery Rate", "Total Freight", "Billed", "Paid", "Outstanding"].map(h => (
                    <th key={h} className="p-3 text-left font-bold uppercase text-[10px] text-onyx/50 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {transporterStats.map((t, i) => {
                  const deliveryRate = t.orderCount > 0 ? Math.round(t.delivered / t.orderCount * 100) : 0;
                  const outstanding = t.billed - t.paid;
                  return (
                    <tr key={i} className="hover:bg-cream-dark/10 transition-colors">
                      <td className="p-3 font-semibold text-onyx">{t.name}</td>
                      <td className="p-3 font-mono text-onyx/50">{t.code}</td>
                      <td className="p-3 font-bold text-onyx">{t.orderCount}</td>
                      <td className="p-3 text-green-600 font-semibold">{t.delivered}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-onyx/10 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${deliveryRate}%` }} />
                          </div>
                          <span className="font-mono">{deliveryRate}%</span>
                        </div>
                      </td>
                      <td className="p-3 font-mono font-bold">{fmt(t.totalFreight)}</td>
                      <td className="p-3 font-mono text-purple-600">{t.billed > 0 ? fmt(t.billed) : "—"}</td>
                      <td className="p-3 font-mono text-green-600">{t.paid > 0 ? fmt(t.paid) : "—"}</td>
                      <td className="p-3 font-mono text-amber-600">{outstanding > 0 ? fmt(outstanding) : "—"}</td>
                    </tr>
                  );
                })}
                {transporterStats.length === 0 && (
                  <tr><td colSpan={9} className="p-8 text-center text-onyx/30 font-medium">No transporter data.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── ROUTE ANALYSIS ── */}
        {activeTab === "routes" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-dark/20 border-b border-onyx/5">
                <tr>
                  {["From", "To", "Trips", "Total Freight", "Avg. Freight / Trip", "Cost Share"].map(h => (
                    <th key={h} className="p-3 text-left font-bold uppercase text-[10px] text-onyx/50 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {routeStats.map((r, i) => {
                  const totalFreight = routeStats.reduce((s, x) => s + x.totalFreight, 0);
                  const share = totalFreight > 0 ? (r.totalFreight / totalFreight * 100).toFixed(1) : "0";
                  return (
                    <tr key={i} className="hover:bg-cream-dark/10 transition-colors">
                      <td className="p-3 font-semibold text-onyx">{r.from}</td>
                      <td className="p-3 font-semibold text-onyx">{r.to}</td>
                      <td className="p-3 font-bold">{r.orderCount}</td>
                      <td className="p-3 font-mono font-bold">{fmt(r.totalFreight)}</td>
                      <td className="p-3 font-mono text-onyx/70">{fmt(r.avgFreight)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-onyx/10 rounded-full overflow-hidden">
                            <div className="h-full bg-saffron rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="font-mono text-onyx/60">{share}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {routeStats.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-onyx/30 font-medium">No route data.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── PAYMENT AGEING ── */}
        {activeTab === "bills" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-dark/20 border-b border-onyx/5">
                <tr>
                  {["Bill No.", "Bill Date", "Due Date", "Transport Order", "Transporter", "Amount", "Paid", "Balance", "Status", "Ageing"].map(h => (
                    <th key={h} className="p-3 text-left font-bold uppercase text-[10px] text-onyx/50 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredBills.map(b => {
                  const overdue = b.daysOverdue !== null && b.daysOverdue > 0 && b.balance > 0;
                  return (
                    <tr key={b.id} className={`hover:bg-cream-dark/10 transition-colors ${overdue ? "bg-red-50/30" : ""}`}>
                      <td className="p-3 font-mono font-bold text-onyx">{b.billNo}</td>
                      <td className="p-3 whitespace-nowrap text-onyx/60">{fmtDate(b.billDate)}</td>
                      <td className="p-3 whitespace-nowrap text-onyx/60">{b.dueDate ? fmtDate(b.dueDate) : "—"}</td>
                      <td className="p-3 font-mono text-onyx/70">{b.transportOrderNo}</td>
                      <td className="p-3 font-semibold text-onyx">{b.transporterName}</td>
                      <td className="p-3 text-right font-mono font-bold">{fmt(b.amount)}</td>
                      <td className="p-3 text-right font-mono text-green-600">{b.paid > 0 ? fmt(b.paid) : "—"}</td>
                      <td className="p-3 text-right font-mono text-amber-600">{b.balance > 0 ? fmt(b.balance) : "—"}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_BADGE[b.paymentStatus] || "bg-gray-100 text-gray-600"}`}>{b.paymentStatus.replace("_"," ")}</span>
                      </td>
                      <td className="p-3">
                        {b.daysOverdue !== null ? (
                          b.daysOverdue > 0 && b.balance > 0
                            ? <span className="text-red-600 font-bold">{b.daysOverdue}d overdue</span>
                            : b.balance > 0
                              ? <span className="text-blue-500">due in {Math.abs(b.daysOverdue)}d</span>
                              : <span className="text-green-500">Cleared</span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {filteredBills.length === 0 && (
                  <tr><td colSpan={10} className="p-8 text-center text-onyx/30 font-medium">No bills found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── CONTRACT UTILISATION ── */}
        {activeTab === "contracts" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-dark/20 border-b border-onyx/5">
                <tr>
                  {["Contract No.", "Transporter", "From", "To", "Capacity", "Contract Rate", "Times Used", "Usage"].map(h => (
                    <th key={h} className="p-3 text-left font-bold uppercase text-[10px] text-onyx/50 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {contracts.map(c => {
                  const maxUsage = Math.max(...contracts.map(x => x.usageCount), 1);
                  return (
                    <tr key={c.id} className="hover:bg-cream-dark/10 transition-colors">
                      <td className="p-3 font-mono font-bold text-onyx">{c.contractNo || "—"}</td>
                      <td className="p-3 font-semibold text-onyx">{c.transporterName}</td>
                      <td className="p-3 text-onyx/70">{c.fromLocation}</td>
                      <td className="p-3 text-onyx/70">{c.toLocation}</td>
                      <td className="p-3 text-onyx/60">{c.vehicleCapacity}</td>
                      <td className="p-3 font-mono font-bold text-saffron">{fmt(c.rate)}</td>
                      <td className="p-3 font-bold">{c.usageCount}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-onyx/10 rounded-full overflow-hidden">
                            <div className="h-full bg-saffron rounded-full" style={{ width: `${(c.usageCount / maxUsage * 100).toFixed(0)}%` }} />
                          </div>
                          {c.usageCount === 0 && <span className="text-onyx/30 text-[10px]">Unused</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {contracts.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-onyx/30 font-medium">No contracts defined.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── MONTHLY TREND ── */}
        {activeTab === "trend" && (
          <div className="p-6 space-y-6">
            {monthlyTrend.length === 0 ? (
              <p className="text-center text-onyx/30 py-8">No data for selected period.</p>
            ) : (
              <>
                {/* Bar chart */}
                <div>
                  <p className="text-xs font-bold uppercase text-onyx/40 tracking-wider mb-4">Monthly Freight Spend</p>
                  <div className="flex items-end gap-3 h-40 overflow-x-auto pb-2">
                    {monthlyTrend.map((m, i) => (
                      <div key={i} className="flex flex-col items-center gap-1 min-w-[52px]">
                        <span className="text-[10px] font-mono text-onyx/50">₹{(m.freight/1000).toFixed(0)}k</span>
                        <div className="w-10 bg-saffron/20 rounded-t relative overflow-hidden"
                          style={{ height: `${Math.max(4, (m.freight / maxFreight) * 120)}px` }}>
                          <div className="absolute bottom-0 left-0 right-0 bg-saffron rounded-t transition-all" style={{ height: "100%" }} />
                        </div>
                        <span className="text-[9px] text-onyx/40 font-semibold text-center leading-tight">{m.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <table className="w-full text-xs border border-onyx/5 rounded-lg overflow-hidden">
                  <thead className="bg-cream-dark/20">
                    <tr>
                      <th className="p-3 text-left font-bold uppercase text-[10px] text-onyx/50">Month</th>
                      <th className="p-3 text-right font-bold uppercase text-[10px] text-onyx/50">Orders</th>
                      <th className="p-3 text-right font-bold uppercase text-[10px] text-onyx/50">Total Freight</th>
                      <th className="p-3 text-right font-bold uppercase text-[10px] text-onyx/50">Avg / Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-onyx/5">
                    {monthlyTrend.map((m, i) => (
                      <tr key={i} className="hover:bg-cream-dark/10 transition-colors">
                        <td className="p-3 font-semibold text-onyx">{m.label}</td>
                        <td className="p-3 text-right font-bold">{m.count}</td>
                        <td className="p-3 text-right font-mono font-bold">{fmt(m.freight)}</td>
                        <td className="p-3 text-right font-mono text-onyx/60">{m.count > 0 ? fmt(m.freight / m.count) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
