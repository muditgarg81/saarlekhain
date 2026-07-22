export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getReminders } from "@/lib/reminders";
import { getItemValuation } from "@/lib/stock";
import { 
  Package,
  ShoppingCart, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  Clock,
  ArrowRight,
  ShieldAlert,
  ArrowUpRight,
  ClipboardList
} from "lucide-react";
import Link from "next/link";
import { getFreshUser } from "@/app/actions/auth";
import { can } from "@/lib/rbac";

export default async function DashboardPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const role = user.role;

  // Check roles/permissions dynamically via RBAC
  const isStoreUser = can(user, "item.manage") || 
                      can(user, "grn.post") || 
                      can(user, "issue.create") || 
                      can(user, "gatepass.create") || 
                      can(user, "indent.create") || 
                      can(user, "indent.approve") || 
                      can(user, "inspection.record") || 
                      ["STORE_MANAGER", "STORE_KEEPER", "QC_INSPECTOR", "ADMIN", "OWNER", "VIEWER"].includes(role);

  const isPurchaseUser = can(user, "pr.create") || 
                         can(user, "pr.approve") || 
                         can(user, "po.create") || 
                         can(user, "po.approve") || 
                         can(user, "vendor.manage") || 
                         ["PURCHASE_MANAGER", "PURCHASE_OFFICER", "ADMIN", "OWNER", "VIEWER"].includes(role);

  const isAccountsUser = can(user, "invoice.match") || 
                         can(user, "payment.record") || 
                         can(user, "ledger.view") || 
                         ["ACCOUNTS", "ADMIN", "OWNER", "VIEWER"].includes(role);

  // Run database queries concurrently
  const [
    reminders,
    vendorsCount,
    activePos,
    invoicesCount,
    prsCount,
    invoicesSum,
    itemsCount,
    pendingIndents,
    pendingRejections
  ] = await Promise.all([
    getReminders(user),
    db.vendor.count({ where: { companyId: user.companyId, deletedAt: null } }),
    db.purchaseOrder.count({ where: { companyId: user.companyId, status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } } }),
    db.supplierInvoice.count({ where: { companyId: user.companyId, matchStatus: "MISMATCH" } }),
    db.purchaseRequisition.count({ where: { companyId: user.companyId, deletedAt: null } }),
    db.supplierInvoice.aggregate({
      where: { companyId: user.companyId, matchStatus: { in: ["MATCHED", "PENDING"] } },
      _sum: { amount: true }
    }),
    db.item.count({ where: { companyId: user.companyId, deletedAt: null } }),
    db.indent.count({ where: { companyId: user.companyId, status: "SUBMITTED" } }),
    db.rejectedMaterial.count({ where: { companyId: user.companyId, status: "PENDING_RETURN" } }),
  ]);

  // Calculate stock inventory valuation and low stock level warnings
  let totalValuation = 0;
  let lowStockAlerts = 0;
  if (isStoreUser) {
    const items = await db.item.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      select: { id: true, reorderLevel: true }
    });

    const valuations = await Promise.all(
      items.map(item => getItemValuation(user.companyId, item.id))
    );

    valuations.forEach((val, idx) => {
      totalValuation += val.totalValue;
      if (val.qty < items[idx].reorderLevel) {
        lowStockAlerts++;
      }
    });
  }

  // Calculate accounts payable amount
  let totalPayable = 0;
  if (isAccountsUser) {
    totalPayable = invoicesSum._sum.amount || 0;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Filter reminders shown on dashboard dynamically based on the modules/profiles the user has access to
  const allowedCategories: string[] = [];
  if (isStoreUser) {
    allowedCategories.push("PENDING_INDENT", "LOW_STOCK", "QC_PENDING", "EXPIRING_BATCHES", "OVERDUE_GATEPASS");
  }
  if (isPurchaseUser) {
    allowedCategories.push("PENDING_PR", "PENDING_PO", "OVERDUE_PO_DELIVERY");
  }
  if (isAccountsUser) {
    allowedCategories.push("INVOICE_MISMATCH", "PAYMENTS_DUE");
  }

  const profileReminders = reminders.filter(r => allowedCategories.includes(r.category));
  const redReminders = profileReminders.filter((r) => r.severity === "red");

  return (
    <div className="space-y-8">
      {/* Critical Reminders Banner */}
      {redReminders.map((reminder) => (
        <div 
          key={reminder.category} 
          className="bg-red-600 text-white p-3 px-5 rounded-xl flex items-center justify-between shadow-md border border-red-700/50 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex items-center space-x-3">
            <ShieldAlert size={16} className="shrink-0" />
            <span className="text-xs font-bold">{reminder.label}</span>
          </div>
          <Link
            href={reminder.deepLink}
            className="text-xs font-bold bg-white hover:bg-cream-light text-red-700 px-3 py-1 rounded-lg transition-all duration-150 flex items-center space-x-1 shrink-0 shadow-sm"
          >
            <span>View Register</span>
            <ArrowRight size={12} />
          </Link>
        </div>
      ))}

      {/* Welcome Heading */}
      <div>
        <h1 className="font-heading text-3xl font-bold text-onyx tracking-tight">
          Welcome back, {user.name || "User"}
        </h1>
        <p className="text-xs text-onyx/50 font-medium mt-1">
          Here is your active factory dashboard for {user.role.replace("_", " ")} role.
        </p>
      </div>

      {/* Role-scoped Reminders Panel */}
      <section className="space-y-4">
        <div className="flex items-center space-x-2">
          <Clock size={16} className="text-saffron-dark" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-onyx/70">
            Action Items Awaiting Your Attention
          </h2>
        </div>

        {profileReminders.length === 0 ? (
          <div className="glass-card p-8 rounded-xl border border-onyx/5 flex flex-col items-center justify-center text-center bg-white">
            <CheckCircle2 size={36} className="text-green-600 mb-2" />
            <p className="text-sm font-semibold text-onyx/80">All caught up! No pending actions.</p>
            <p className="text-xs text-onyx/40 mt-1">Check back later for new requests or alerts.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {profileReminders.map((reminder) => (
              <Link
                key={reminder.category}
                href={reminder.deepLink}
                className={`group block p-5 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 ${
                  reminder.severity === "red"
                    ? "bg-red-50/50 border-red-200/60 hover:bg-red-50 hover:border-red-300"
                    : "bg-saffron/10 border-saffron/20 hover:bg-saffron/15 hover:border-saffron/40"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                      reminder.severity === "red" 
                        ? "bg-red-100 text-red-800" 
                        : "bg-saffron text-onyx"
                    }`}>
                      {reminder.category.replace("_", " ")}
                    </span>
                    <h3 className="text-sm font-bold text-onyx group-hover:text-saffron-dark transition-colors duration-150">
                      {reminder.label}
                    </h3>
                  </div>
                  <ArrowUpRight size={18} className="text-onyx/30 group-hover:text-onyx/80 transition-all duration-200" />
                </div>
                
                <div className="mt-4 flex items-center text-xs font-semibold text-onyx/60 group-hover:text-onyx transition-colors duration-150">
                  <span>Go to register</span>
                  <ArrowRight size={14} className="ml-1 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* KPI Cards Grid - Scoped by Profile */}
      <div className="space-y-8">
        {isStoreUser && (
          <div className="space-y-4">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-onyx/60">
              Stores & Inventory Summary
            </h2>
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Item Master */}
              <Link 
                href="/stores/items"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <Package size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Item Master</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{itemsCount}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Active codings in system</p>
                </div>
              </Link>

              {/* Stock Valuation */}
              <Link 
                href="/stores/reports"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <TrendingUp size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Stock Valuation</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{formatCurrency(totalValuation)}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Weighted Average derived</p>
                </div>
              </Link>

              {/* Pending Indents */}
              <Link 
                href="/stores/indents"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <ClipboardList size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Pending Indents</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{pendingIndents}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Awaiting issue/PR conversion</p>
                </div>
              </Link>

              {/* Pending Rejections */}
              <Link 
                href="/stores/rejected-material"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Pending Rejections</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{pendingRejections}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Awaiting vendor return</p>
                </div>
              </Link>
            </section>
          </div>
        )}

        {isPurchaseUser && (
          <div className="space-y-4">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-onyx/60">
              Purchase Summary
            </h2>
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* PR & RFQs */}
              <Link 
                href="/purchase/requisitions"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <ClipboardList size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">PR & RFQs</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{prsCount}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Purchase Requisitions</p>
                </div>
              </Link>

              {/* Active POs */}
              <Link 
                href="/purchase/po"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <ShoppingCart size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Active POs</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{activePos}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Open purchase orders</p>
                </div>
              </Link>

              {/* Suppliers */}
              <Link 
                href="/purchase/vendors"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Suppliers</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{vendorsCount}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Approved vendors</p>
                </div>
              </Link>
            </section>
          </div>
        )}

        {isAccountsUser && (
          <div className="space-y-4">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-onyx/60">
              Accounts & Payables Summary
            </h2>
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6">
              {/* Outstanding Payables */}
              <Link 
                href="/purchase/payments"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <TrendingUp size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Outstanding Payables</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{formatCurrency(totalPayable)}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Total active bills due</p>
                </div>
              </Link>

              {/* Mismatch Invoices */}
              <Link 
                href="/purchase/invoices?matchStatus=MISMATCH"
                className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
              >
                <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Mismatch Invoices</p>
                  <p className="text-2xl font-bold text-onyx mt-0.5">{invoicesCount}</p>
                  <p className="text-[10px] text-onyx/40 font-medium">Failing 3-Way Match</p>
                </div>
              </Link>
            </section>
          </div>
        )}
      </div>

      {/* Warnings & Alerts banner (if any critical thresholds crossed) */}
      {isStoreUser && lowStockAlerts > 0 && (
        <div className="bg-red-50 border-l-4 border-red-600 p-5 rounded-r-xl flex items-start space-x-4">
          <ShieldAlert size={20} className="text-red-700 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-bold text-red-900">Critical: Low Stock Level Warning</h4>
            <p className="text-xs text-red-800 leading-relaxed mt-1">
              There are currently {lowStockAlerts} items sitting below their designated reorder level thresholds. Please review the stock-on-hand values and trigger Purchase Requisitions (PR) to prevent production delays.
            </p>
            <div className="mt-3">
              <Link 
                href="/stores/reports?type=low-stock"
                className="text-xs font-bold text-red-900 hover:text-red-950 underline flex items-center"
              >
                <span>View Low-Stock Inventory Register</span>
                <ArrowRight size={12} className="ml-1" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
