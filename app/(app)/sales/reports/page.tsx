import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getFreshUser } from "@/app/actions/auth";
import { TrendingUp, Landmark, Users, AlertTriangle } from "lucide-react";

function bucketOf(dueDate: Date | null): "current" | "b30" | "b60" | "b90" {
  if (!dueDate) return "current";
  const days = Math.ceil((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "current";
  if (days <= 30) return "b30";
  if (days <= 60) return "b60";
  return "b90";
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default async function SalesReportsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [openInvoices, customers, statements, bills] = await Promise.all([
    db.salesInvoice.findMany({
      where: { companyId, deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      select: { customerId: true, totalAmount: true, paidAmount: true, dueDate: true },
    }),
    db.customer.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true, code: true } }),
    db.debtorStatement.findMany({ where: { companyId }, select: { customerId: true, outstanding: true, asOf: true } }),
    db.debtorBill.findMany({ where: { companyId }, select: { overdueDays: true, pendingAmount: true } }),
  ]);

  const custName = new Map(customers.map((c) => [c.id, `${c.name} (${c.code})`]));

  // Receivables aging from our own open invoices.
  type Row = { name: string; current: number; b30: number; b60: number; b90: number; total: number };
  const byCustomer = new Map<string, Row>();
  for (const inv of openInvoices) {
    const out = inv.totalAmount - inv.paidAmount;
    if (out <= 0) continue;
    const row =
      byCustomer.get(inv.customerId) ||
      { name: custName.get(inv.customerId) || "—", current: 0, b30: 0, b60: 0, b90: 0, total: 0 };
    row[bucketOf(inv.dueDate)] += out;
    row.total += out;
    byCustomer.set(inv.customerId, row);
  }
  const agingRows = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  const totals = agingRows.reduce(
    (t, r) => ({ current: t.current + r.current, b30: t.b30 + r.b30, b60: t.b60 + r.b60, b90: t.b90 + r.b90, total: t.total + r.total }),
    { current: 0, b30: 0, b60: 0, b90: 0, total: 0 }
  );

  // Tally bridge debtor outstanding (mirror of creditor statements).
  const tallyOutstanding = statements.reduce((s, st) => s + st.outstanding, 0);
  const tallyOverdue = bills.filter((b) => (b.overdueDays || 0) > 0).reduce((s, b) => s + b.pendingAmount, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
          <TrendingUp size={20} />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-onyx">Sales & Receivables Reports</h1>
          <p className="text-xs text-onyx/50">Debtor aging from invoices + Tally bridge reconciliation</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Kpi icon={<Users size={16} />} label="Total receivable" value={inr(totals.total)} />
        <Kpi icon={<AlertTriangle size={16} />} label="Overdue (>0d)" value={inr(totals.b30 + totals.b60 + totals.b90)} accent="text-orange-600" />
        <Kpi icon={<Landmark size={16} />} label="Tally debtor o/s" value={inr(tallyOutstanding)} />
        <Kpi icon={<AlertTriangle size={16} />} label="Tally overdue" value={inr(tallyOverdue)} accent="text-red-600" />
      </div>

      {/* Aging table */}
      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden mb-8">
        <div className="px-4 py-3 border-b border-onyx/10 font-semibold text-onyx text-sm">
          Receivables aging (from open invoices)
        </div>
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-right px-4 py-3 font-semibold">Current</th>
              <th className="text-right px-4 py-3 font-semibold">1–30d</th>
              <th className="text-right px-4 py-3 font-semibold">31–60d</th>
              <th className="text-right px-4 py-3 font-semibold">60d+</th>
              <th className="text-right px-4 py-3 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {agingRows.map((r, i) => (
              <tr key={i} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 text-onyx">{r.name}</td>
                <td className="px-4 py-3 text-right text-onyx/70">{inr(r.current)}</td>
                <td className="px-4 py-3 text-right text-amber-700">{inr(r.b30)}</td>
                <td className="px-4 py-3 text-right text-orange-700">{inr(r.b60)}</td>
                <td className="px-4 py-3 text-right text-red-700">{inr(r.b90)}</td>
                <td className="px-4 py-3 text-right font-semibold text-onyx">{inr(r.total)}</td>
              </tr>
            ))}
            {agingRows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-onyx/40 text-sm">No outstanding receivables.</td></tr>
            )}
          </tbody>
          {agingRows.length > 0 && (
            <tfoot className="bg-cream-light/60 font-semibold text-onyx">
              <tr>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right">{inr(totals.current)}</td>
                <td className="px-4 py-3 text-right">{inr(totals.b30)}</td>
                <td className="px-4 py-3 text-right">{inr(totals.b60)}</td>
                <td className="px-4 py-3 text-right">{inr(totals.b90)}</td>
                <td className="px-4 py-3 text-right">{inr(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Tally bridge reconciliation */}
      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-onyx/10 font-semibold text-onyx text-sm flex items-center gap-2">
          <Landmark size={15} className="text-saffron-dark" /> Tally debtor statements (bridge)
        </div>
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-right px-4 py-3 font-semibold">Outstanding</th>
              <th className="text-left px-4 py-3 font-semibold">As of</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {statements.map((s, i) => (
              <tr key={i} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 text-onyx">{custName.get(s.customerId) || "—"}</td>
                <td className="px-4 py-3 text-right font-medium text-onyx">{inr(s.outstanding)}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{new Date(s.asOf).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
            {statements.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-onyx/40 text-sm">
                No debtor statements pulled yet. Map customers to Tally ledgers and sync from ERP &amp; Tally Settings.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white border border-onyx/10 rounded-xl p-4">
      <div className="flex items-center gap-2 text-onyx/50 text-xs font-semibold mb-2">
        {icon} {label}
      </div>
      <div className={`text-2xl font-heading font-bold ${accent || "text-onyx"}`}>{value}</div>
    </div>
  );
}
