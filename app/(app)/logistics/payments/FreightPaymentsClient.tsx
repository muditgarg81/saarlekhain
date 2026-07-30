"use client";

import React, { useState, useMemo } from "react";
import { Banknote, Search, ChevronDown, ChevronUp, CreditCard, Clock } from "lucide-react";
import { recordTransportPayment } from "@/app/actions/transport";

interface Payment {
  id: string;
  paymentNo: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNo: string | null;
}

interface Bill {
  id: string;
  billNo: string;
  billDate: string;
  amount: number;
  dueDate: string | null;
  paymentStatus: string;
  transportOrderNo: string;
  transporterName: string;
  totalPaid: number;
  balance: number;
  payments: Payment[];
}

export default function FreightPaymentsClient({ bills }: { bills: Bill[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "PARTIALLY_PAID" | "PAID">("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [form, setForm] = useState({
    amount: 0,
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "Bank Transfer",
    referenceNo: "",
  });

  const today = new Date();

  const ageing = (dueDateStr: string | null) => {
    if (!dueDateStr) return null;
    const days = Math.floor((today.getTime() - new Date(dueDateStr).getTime()) / 86400000);
    return days;
  };

  const filtered = useMemo(() => {
    return bills.filter((b) => {
      const q = searchTerm.toLowerCase();
      const matchSearch =
        b.billNo.toLowerCase().includes(q) ||
        b.transporterName.toLowerCase().includes(q) ||
        b.transportOrderNo.toLowerCase().includes(q);
      const matchFilter = filter === "ALL" || b.paymentStatus === filter;
      return matchSearch && matchFilter;
    });
  }, [bills, searchTerm, filter]);

  const summary = useMemo(() => {
    const total = bills.reduce((s, b) => s + b.amount, 0);
    const paid = bills.reduce((s, b) => s + b.totalPaid, 0);
    const pending = bills.filter((b) => b.paymentStatus !== "PAID").reduce((s, b) => s + b.balance, 0);
    const overdue = bills.filter((b) => {
      const days = ageing(b.dueDate);
      return days !== null && days > 0 && b.paymentStatus !== "PAID";
    }).reduce((s, b) => s + b.balance, 0);
    return { total, paid, pending, overdue };
  }, [bills]);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBill || form.amount <= 0) return;
    const res = await recordTransportPayment({
      transportBillId: selectedBill.id,
      ...form,
    });
    if (res.success) {
      setShowPayModal(false);
      setSelectedBill(null);
      setForm({ amount: 0, paymentDate: new Date().toISOString().split("T")[0], paymentMethod: "Bank Transfer", referenceNo: "" });
    } else {
      alert(res.error);
    }
  };

  const statusBadge = (status: string) => {
    if (status === "PAID") return "bg-emerald-100 text-emerald-800";
    if (status === "PARTIALLY_PAID") return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-onyx flex items-center">
          <Banknote className="text-saffron mr-2" size={24} />
          Freight Payments
        </h2>
        <p className="text-xs text-onyx/50 mt-1">
          View outstanding freight bills, record payments, and track payment ageing.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Billed", value: summary.total, color: "text-onyx" },
          { label: "Total Paid", value: summary.paid, color: "text-emerald-600" },
          { label: "Outstanding", value: summary.pending, color: "text-amber-600" },
          { label: "Overdue", value: summary.overdue, color: "text-red-600" },
        ].map((k) => (
          <div key={k.label} className="glass-card bg-white border border-onyx/5 rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">{k.label}</p>
            <p className={`text-xl font-extrabold font-mono mt-1 ${k.color}`}>
              ₹{k.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-onyx/40" size={14} />
          <input
            type="text"
            placeholder="Search bills..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-white border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["ALL", "PENDING", "PARTIALLY_PAID", "PAID"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded-full border transition cursor-pointer ${
                filter === f
                  ? "bg-saffron text-onyx border-saffron"
                  : "bg-white text-onyx/50 border-onyx/10 hover:border-onyx/30"
              }`}
            >
              {f.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Bills table */}
      <div className="glass-card bg-white border border-onyx/5 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-cream-dark/50 border-b border-onyx/5">
              <tr>
                <th className="p-3 w-8"></th>
                <th className="p-3 font-bold uppercase text-onyx/60">Bill No</th>
                <th className="p-3 font-bold uppercase text-onyx/60">Transporter / Order</th>
                <th className="p-3 font-bold uppercase text-right text-onyx/60">Bill Amt</th>
                <th className="p-3 font-bold uppercase text-right text-onyx/60">Paid</th>
                <th className="p-3 font-bold uppercase text-right text-onyx/60">Balance</th>
                <th className="p-3 font-bold uppercase text-center text-onyx/60">Ageing</th>
                <th className="p-3 font-bold uppercase text-center text-onyx/60">Status</th>
                <th className="p-3 font-bold uppercase text-center text-onyx/60">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-onyx/5">
              {filtered.map((b) => {
                const days = ageing(b.dueDate);
                const isExpanded = expandedId === b.id;
                return (
                  <React.Fragment key={b.id}>
                    <tr className="hover:bg-cream-dark/15 transition-colors">
                      <td className="p-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : b.id)}
                          className="p-1 text-onyx/40 hover:text-onyx cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-onyx">{b.billNo}</div>
                        <div className="text-[10px] text-onyx/40 font-mono">
                          {new Date(b.billDate).toLocaleDateString("en-IN")}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-onyx">{b.transporterName}</div>
                        <div className="text-[10px] text-onyx/50 font-mono">{b.transportOrderNo}</div>
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        ₹{b.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-600">
                        ₹{b.totalPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-red-600">
                        ₹{b.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-center">
                        {b.paymentStatus !== "PAID" && days !== null ? (
                          <span className={`text-[10px] font-bold ${days > 0 ? "text-red-600" : "text-onyx/50"}`}>
                            {days > 0 ? `${days}d overdue` : `due in ${Math.abs(days)}d`}
                          </span>
                        ) : (
                          <span className="text-[10px] text-onyx/30">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-block text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${statusBadge(b.paymentStatus)}`}>
                          {b.paymentStatus.replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {b.paymentStatus !== "PAID" && (
                          <button
                            onClick={() => {
                              setSelectedBill(b);
                              setForm((f) => ({ ...f, amount: b.balance }));
                              setShowPayModal(true);
                            }}
                            className="text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-1 rounded font-bold transition cursor-pointer"
                          >
                            Pay
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-cream-dark/5">
                        <td colSpan={9} className="px-6 py-3">
                          <div className="border-l-2 border-saffron pl-4 space-y-1">
                            <p className="text-[10px] font-bold uppercase text-onyx/50 tracking-wider">Payment History</p>
                            {b.payments.length === 0 ? (
                              <p className="text-[11px] text-onyx/40 italic">No payments recorded yet.</p>
                            ) : (
                              b.payments.map((p) => (
                                <div key={p.id} className="flex items-center gap-6 text-[11px] py-1 border-b border-onyx/5 max-w-2xl">
                                  <span className="font-mono text-onyx/60 w-28">{p.paymentNo}</span>
                                  <span className="text-onyx/60 w-24">{new Date(p.paymentDate).toLocaleDateString("en-IN")}</span>
                                  <span className="text-onyx/60 flex-1">{p.paymentMethod}{p.referenceNo ? ` · ${p.referenceNo}` : ""}</span>
                                  <span className="font-mono font-bold text-onyx">₹{p.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-onyx/40 font-medium">
                    No bills found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayModal && selectedBill && (
        <div className="fixed inset-0 bg-onyx-dark/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handlePay} className="bg-white rounded-xl shadow-xl w-full max-w-md border border-onyx/10">
            <div className="p-4 border-b border-onyx/5 bg-cream-dark/15 flex items-center justify-between">
              <h3 className="font-bold text-onyx flex items-center text-sm uppercase">
                <CreditCard className="mr-2 text-saffron" size={16} />
                Record Payment
              </h3>
              <button type="button" onClick={() => { setShowPayModal(false); setSelectedBill(null); }} className="text-onyx/40 hover:text-onyx text-lg">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-cream-dark/10 p-3 rounded-lg text-xs space-y-1">
                <div><strong>Bill:</strong> {selectedBill.billNo}</div>
                <div><strong>Transporter:</strong> {selectedBill.transporterName}</div>
                <div><strong>Outstanding:</strong> ₹{selectedBill.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Amount (₹) *</label>
                <input type="number" required value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Date *</label>
                  <input type="date" required value={form.paymentDate}
                    onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Method *</label>
                  <select value={form.paymentMethod}
                    onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none">
                    <option>Bank Transfer</option>
                    <option>UPI</option>
                    <option>Cash</option>
                    <option>Cheque</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Reference / UTR No</label>
                <input type="text" placeholder="e.g. UTR-123456"
                  value={form.referenceNo}
                  onChange={(e) => setForm((f) => ({ ...f, referenceNo: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron" />
              </div>
            </div>
            <div className="p-4 border-t border-onyx/5 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowPayModal(false); setSelectedBill(null); }}
                className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/10 cursor-pointer">Cancel</button>
              <button type="submit"
                className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow cursor-pointer">Record Payment</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
