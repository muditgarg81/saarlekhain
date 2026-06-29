"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSalesInvoiceFromDispatch,
  generateEInvoice,
  cancelSalesInvoice,
} from "@/app/actions/salesInvoices";
import { Plus, X, Receipt, QrCode, Ban } from "lucide-react";
import { can, SessionUser } from "@/lib/rbac";

interface Invoice {
  id: string;
  number: string;
  customer: string;
  dispatchNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  taxableAmount: number;
  totalAmount: number;
  paidAmount: number;
  status: string;
  einvoiceStatus: string;
  irn: string | null;
}
interface Dispatch { id: string; label: string }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  ISSUED: "bg-blue-100 text-blue-800 border-blue-200",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800 border-amber-200",
  PAID: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};
const EINV_STYLES: Record<string, string> = {
  NOT_APPLICABLE: "text-onyx/40",
  PENDING: "text-amber-600",
  GENERATED: "text-green-600",
  CANCELLED: "text-red-500",
  FAILED: "text-red-600",
};

export default function SalesInvoicesList({
  initialInvoices,
  eligibleDispatches,
  user,
}: {
  initialInvoices: Invoice[];
  eligibleDispatches: Dispatch[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [invoices] = useState(initialInvoices);
  const [isOpen, setIsOpen] = useState(false);
  const [dispatchId, setDispatchId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canInvoice = can(user, "sales.invoice") || ["ADMIN", "OWNER"].includes(user.role);
  const canEinvoice = can(user, "einvoice.generate") || ["ADMIN", "OWNER"].includes(user.role);

  const submit = async () => {
    setLoading(true);
    setError(null);
    const res = await createSalesInvoiceFromDispatch({ dispatchId, invoiceDate: invoiceDate || null, otherCharges: 0 } as any);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to raise invoice");
      return;
    }
    setIsOpen(false);
    setDispatchId("");
    router.refresh();
  };

  const act = async (fn: () => Promise<any>) => {
    const res = await fn();
    if (!res.success) alert(res.error);
    router.refresh();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <Receipt size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Sales Invoices</h1>
            <p className="text-xs text-onyx/50">Tax invoices, GST split & e-invoice (IRN)</p>
          </div>
        </div>
        {canInvoice && (
          <button onClick={() => setIsOpen(true)} className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm">
            <Plus size={16} /> Raise Invoice
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Invoice #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-right px-4 py-3 font-semibold">Total</th>
              <th className="text-right px-4 py-3 font-semibold">Outstanding</th>
              <th className="text-left px-4 py-3 font-semibold">E-invoice</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">
                  {inv.number}
                  {inv.dispatchNumber && <span className="block text-[10px] text-onyx/40">{inv.dispatchNumber}</span>}
                </td>
                <td className="px-4 py-3 text-onyx">{inv.customer}</td>
                <td className="px-4 py-3 text-right font-medium text-onyx">
                  ₹{inv.totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-right text-onyx/70">
                  ₹{(inv.totalAmount - inv.paidAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={EINV_STYLES[inv.einvoiceStatus]} title={inv.irn || ""}>
                    {inv.irn ? `IRN ✓` : inv.einvoiceStatus.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${STATUS_STYLES[inv.status]}`}>
                    {inv.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {canEinvoice && inv.einvoiceStatus === "PENDING" && (
                      <button title="Generate e-invoice (IRN)" onClick={() => act(() => generateEInvoice(inv.id))} className="p-1.5 rounded hover:bg-green-50 text-green-600">
                        <QrCode size={15} />
                      </button>
                    )}
                    {canInvoice && inv.status !== "CANCELLED" && inv.paidAmount === 0 && (
                      <button title="Cancel" onClick={() => act(() => cancelSalesInvoice(inv.id, "Cancelled"))} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                        <Ban size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-onyx/40 text-sm">No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10">
              <h2 className="font-heading font-bold text-onyx">Raise Invoice from Dispatch</h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Dispatch *</label>
                <select className={inputCls} value={dispatchId} onChange={(e) => setDispatchId(e.target.value)}>
                  <option value="">Select a dispatch…</option>
                  {eligibleDispatches.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                {eligibleDispatches.length === 0 && (
                  <p className="text-[11px] text-onyx/40 mt-1">No un-invoiced dispatches. Dispatch an order first.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Invoice date</label>
                <input type="date" className={inputCls} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <p className="text-[11px] text-onyx/40">
                GST is split CGST+SGST (intra-state) or IGST (inter-state) automatically from place of supply.
              </p>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || !dispatchId} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Raising…" : "Raise invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
