"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSalesOrder,
  submitSalesOrder,
  approveSalesOrder,
  rejectSalesOrder,
  cancelSalesOrder,
} from "@/app/actions/salesOrders";
import { Plus, X, Trash2, Send, Check, Ban, ClipboardList } from "lucide-react";
import { can, SessionUser } from "@/lib/rbac";

interface Order {
  id: string;
  number: string;
  customer: string;
  type: string;
  status: string;
  orderDate: string;
  deliveryDate: string | null;
  customerPoNo: string | null;
  value: number;
  lineCount: number;
}
interface CustomerOpt { id: string; code: string; name: string; stateCode: string | null; paymentTerms: string | null }
interface ItemOpt { id: string; code: string; name: string; baseUom: string; gstRate: number | null }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-200",
  PARTIALLY_DISPATCHED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  DISPATCHED: "bg-violet-100 text-violet-800 border-violet-200",
  INVOICED: "bg-green-100 text-green-800 border-green-200",
  SHORT_CLOSED: "bg-orange-100 text-orange-800 border-orange-200",
  CLOSED: "bg-gray-200 text-gray-700 border-gray-300",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};

type Line = { itemId: string; qty: number; rate: number; discount: number; gstRate: number };

export default function OrdersList({
  initialOrders,
  customers,
  items,
  user,
}: {
  initialOrders: Order[];
  customers: CustomerOpt[];
  items: ItemOpt[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [orders] = useState<Order[]>(initialOrders);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerPoNo, setCustomerPoNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18 }]);

  const canCreate = can(user, "so.create") || ["ADMIN", "OWNER"].includes(user.role);
  const canApprove = can(user, "so.approve") || ["ADMIN", "OWNER"].includes(user.role);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const lineTotal = (l: Line) => l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
  const orderTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  const addLine = () => setLines([...lines, { itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const onItemPick = (i: number, itemId: string) => {
    const it = itemById.get(itemId);
    setLine(i, { itemId, gstRate: it?.gstRate ?? 18 });
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const res = await createSalesOrder({
      customerId,
      type: "REGULAR" as any,
      customerPoNo: customerPoNo || null,
      deliveryDate: deliveryDate || null,
      otherCharges: 0,
      lines: lines
        .filter((l) => l.itemId)
        .map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty),
          rate: Number(l.rate),
          discount: Number(l.discount),
          gstRate: Number(l.gstRate),
        })),
    } as any);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to create order");
      return;
    }
    setIsOpen(false);
    setCustomerId("");
    setCustomerPoNo("");
    setDeliveryDate("");
    setLines([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18 }]);
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
            <ClipboardList size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Sales Orders</h1>
            <p className="text-xs text-onyx/50">Customer order → confirm → dispatch → invoice</p>
          </div>
        </div>
        {canCreate && (
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm"
          >
            <Plus size={16} /> New Order
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">SO #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Cust. PO</th>
              <th className="text-right px-4 py-3 font-semibold">Value</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{o.number}</td>
                <td className="px-4 py-3 text-onyx">{o.customer}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{o.customerPoNo || "—"}</td>
                <td className="px-4 py-3 text-right font-medium text-onyx">
                  ₹{o.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${STATUS_STYLES[o.status]}`}>
                    {o.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {o.status === "DRAFT" && canCreate && (
                      <button title="Submit" onClick={() => act(() => submitSalesOrder(o.id))} className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
                        <Send size={15} />
                      </button>
                    )}
                    {o.status === "PENDING_APPROVAL" && canApprove && (
                      <>
                        <button title="Approve" onClick={() => act(() => approveSalesOrder(o.id))} className="p-1.5 rounded hover:bg-green-50 text-green-600">
                          <Check size={15} />
                        </button>
                        <button title="Reject" onClick={() => act(() => rejectSalesOrder(o.id, "Rejected"))} className="p-1.5 rounded hover:bg-red-50 text-red-600">
                          <Ban size={15} />
                        </button>
                      </>
                    )}
                    {["CONFIRMED", "PARTIALLY_DISPATCHED"].includes(o.status) && canCreate && (
                      <button title="Cancel" onClick={() => act(() => cancelSalesOrder(o.id, "Cancelled"))} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">No sales orders yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10 sticky top-0 bg-white">
              <h2 className="font-heading font-bold text-onyx">New Sales Order</h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer *</label>
                  <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Select…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer PO #</label>
                  <input className={inputCls} value={customerPoNo} onChange={(e) => setCustomerPoNo(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Delivery date</label>
                  <input type="date" className={inputCls} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                </div>
              </div>

              <div className="border border-onyx/10 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-cream-light text-onyx/60 uppercase">
                    <tr>
                      <th className="text-left px-2 py-2">Item</th>
                      <th className="px-2 py-2 w-16">Qty</th>
                      <th className="px-2 py-2 w-20">Rate</th>
                      <th className="px-2 py-2 w-16">Disc%</th>
                      <th className="px-2 py-2 w-16">GST%</th>
                      <th className="px-2 py-2 w-24 text-right">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t border-onyx/5">
                        <td className="px-2 py-1">
                          <select className={cellCls} value={l.itemId} onChange={(e) => onItemPick(i, e.target.value)}>
                            <option value="">Select…</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>{it.name} ({it.code})</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.rate} onChange={(e) => setLine(i, { rate: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.discount} onChange={(e) => setLine(i, { discount: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1 text-right font-medium">₹{lineTotal(l).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                        <td className="px-2 py-1 text-center">
                          {lines.length > 1 && (
                            <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <button onClick={addLine} className="text-sm text-saffron-dark font-semibold flex items-center gap-1">
                  <Plus size={14} /> Add line
                </button>
                <div className="text-sm font-bold text-onyx">
                  Order total: ₹{orderTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || !customerId} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Creating…" : "Create order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
const cellCls = "w-full px-2 py-1 border border-onyx/15 rounded text-xs outline-none focus:ring-1 focus:ring-saffron/40";
