"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordReceipt } from "@/app/actions/receipts";
import { Plus, X, CreditCard } from "lucide-react";
import { ReceiptMode } from "@prisma/client";
import { can, SessionUser } from "@/lib/rbac";

interface Receipt {
  id: string;
  number: string;
  customer: string;
  amount: number;
  receivedOn: string;
  mode: string;
  reference: string | null;
}
interface CustomerOpt { id: string; code: string; name: string }
interface OpenInvoice { id: string; number: string; customerId: string; outstanding: number }

export default function ReceiptsList({
  initialReceipts,
  customers,
  openInvoices,
  user,
}: {
  initialReceipts: Receipt[];
  customers: CustomerOpt[];
  openInvoices: OpenInvoice[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [receipts] = useState(initialReceipts);
  const [isOpen, setIsOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [mode, setMode] = useState<ReceiptMode>(ReceiptMode.NEFT);
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReceive = can(user, "receipt.record") || ["ADMIN", "OWNER"].includes(user.role);
  const custInvoices = openInvoices.filter((i) => i.customerId === customerId);

  const pickInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = openInvoices.find((i) => i.id === id);
    if (inv) setAmount(inv.outstanding);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const res = await recordReceipt({
      customerId,
      invoiceId: invoiceId || null,
      amount: Number(amount),
      mode,
      reference: reference || null,
      receivedOn: receivedOn || null,
    } as any);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to record receipt");
      return;
    }
    setIsOpen(false);
    setCustomerId("");
    setInvoiceId("");
    setAmount(0);
    setReference("");
    router.refresh();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <CreditCard size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Customer Receipts</h1>
            <p className="text-xs text-onyx/50">Collections against invoices — recorded, not executed</p>
          </div>
        </div>
        {canReceive && (
          <button onClick={() => setIsOpen(true)} className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm">
            <Plus size={16} /> Record Receipt
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Receipt #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-right px-4 py-3 font-semibold">Amount</th>
              <th className="text-left px-4 py-3 font-semibold">Mode</th>
              <th className="text-left px-4 py-3 font-semibold">Reference</th>
              <th className="text-left px-4 py-3 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {receipts.map((r) => (
              <tr key={r.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{r.number}</td>
                <td className="px-4 py-3 text-onyx">{r.customer}</td>
                <td className="px-4 py-3 text-right font-medium text-green-700">
                  ₹{r.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-onyx/70 text-xs">{r.mode}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{r.reference || "—"}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{new Date(r.receivedOn).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">No receipts recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10">
              <h2 className="font-heading font-bold text-onyx">Record Receipt</h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer *</label>
                <select className={inputCls} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(""); }}>
                  <option value="">Select…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Against invoice (optional)</label>
                <select className={inputCls} value={invoiceId} onChange={(e) => pickInvoice(e.target.value)} disabled={!customerId}>
                  <option value="">On account</option>
                  {custInvoices.map((i) => (
                    <option key={i.id} value={i.id}>{i.number} — ₹{i.outstanding.toLocaleString("en-IN")}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Amount (₹) *</label>
                  <input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Mode</label>
                  <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
                    {Object.values(ReceiptMode).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Reference (UTR/Cheque)</label>
                  <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Received on</label>
                  <input type="date" className={inputCls} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                </div>
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || !customerId || amount <= 0} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Saving…" : "Record receipt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
