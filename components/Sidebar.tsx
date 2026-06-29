"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Database, 
  Settings, 
  FileText,
  ClipboardList,
  ShieldCheck,
  Truck,
  Receipt,
  CreditCard,
  History,
  TrendingUp,
  Map,
  MapPin,
  RefreshCw,
  AlertTriangle,
  Building2,
  Users,
  PackageOpen,
  QrCode,
  ChevronDown,
  X
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { can, SessionUser } from "@/lib/rbac";

interface SidebarProps {
  user: SessionUser & {
    name?: string | null;
    storeId?: string | null;
    storeScope?: string[];
  };
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ user, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { update } = useSession();
  const role = user.role;

  const [companyName, setCompanyName] = useState("Saarlekha Factory");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);

  useEffect(() => {
    async function fetchCompanyBranding() {
      try {
        const res = await fetch("/api/profile/memberships");
        if (res.ok) {
          const mems = await res.json();
          setCompanies(mems);
          const current = mems.find((m: any) => m.companyId === user.companyId);
          if (current) {
            setCompanyName(current.companyName);
            setLogoUrl(current.logoUrl);
          }
        }
      } catch (err) {
        console.error("Error loading company branding in Sidebar:", err);
      }
    }
    async function fetchStores() {
      try {
        const res = await fetch("/api/profile/stores");
        if (res.ok) {
          const data = await res.json();
          setStores(data);
        }
      } catch (err) {
        console.error("Error loading stores in Sidebar:", err);
      }
    }
    fetchCompanyBranding();
    fetchStores();
  }, [user.companyId]);

  const handleCompanyChange = async (newCompanyId: string) => {
    if (newCompanyId === user.companyId) return;
    try {
      await update({ companyId: newCompanyId });
      router.refresh();
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch company in Sidebar:", err);
    }
  };

  const handleStoreChange = async (newStoreId: string) => {
    if (newStoreId === (user.storeId || "all")) return;
    try {
      await update({ storeId: newStoreId === "all" ? null : newStoreId });
      router.refresh();
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch store in Sidebar:", err);
    }
  };

  // Close the mobile sidebar whenever the pathname changes (e.g. after clicking a link)
  useEffect(() => {
    if (isOpen && onClose) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleSignOut = () => {
    signOut({ callbackUrl: "/auth/signin" });
  };

  // Helper to check active routes
  const isActive = (path: string) => {
    return pathname.startsWith(path);
  };

  // Check roles permissions dynamically via RBAC
  const isAdmin = can(user, "user.manage") || can(user, "company.settings.edit") || ["ADMIN", "OWNER"].includes(role);
  
  const isStore = can(user, "item.manage") || 
                  can(user, "grn.post") || 
                  can(user, "issue.create") || 
                  can(user, "gatepass.create") || 
                  can(user, "indent.create") || 
                  can(user, "indent.approve") || 
                  ["STORE_MANAGER", "STORE_KEEPER", "ADMIN", "OWNER"].includes(role);

  const isPurchase = can(user, "pr.create") || 
                     can(user, "pr.approve") || 
                     can(user, "po.create") || 
                     can(user, "po.approve") || 
                     can(user, "vendor.manage") || 
                     ["PURCHASE_MANAGER", "PURCHASE_OFFICER", "ADMIN", "OWNER"].includes(role);

  const isQC = can(user, "inspection.record") || ["QC_INSPECTOR", "STORE_MANAGER", "ADMIN", "OWNER"].includes(role);

  const isAccounts = can(user, "invoice.match") ||
                     can(user, "payment.record") ||
                     can(user, "ledger.view") ||
                     ["ACCOUNTS", "ADMIN", "OWNER"].includes(role);

  const isSales = can(user, "customer.manage") ||
                  can(user, "so.create") ||
                  can(user, "so.approve") ||
                  can(user, "dispatch.create") ||
                  can(user, "sales.invoice") ||
                  can(user, "receipt.record") ||
                  ["PURCHASE_MANAGER", "PURCHASE_OFFICER", "STORE_MANAGER", "STORE_KEEPER", "ACCOUNTS", "ADMIN", "OWNER"].includes(role);

  return (
    <>
      {/* Mobile backdrop overlay */}
      {isOpen && (
        <div 
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200 cursor-pointer"
        />
      )}

      <aside className={`w-64 bg-onyx text-cream-light border-r border-onyx-light flex flex-col h-screen font-body
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out md:static md:translate-x-0
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        {/* Brand Header */}
        <div className="p-5 border-b border-onyx-light bg-onyx-dark flex items-center justify-between space-x-3">
          <div className="flex items-center space-x-3 min-w-0">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-9 h-9 object-contain bg-cream-light rounded-lg p-1 shrink-0" />
            ) : (
              <div className="w-9 h-9 bg-saffron text-onyx font-heading font-bold text-lg rounded-lg flex items-center justify-center shrink-0">
                {companyName[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-heading text-sm font-bold text-saffron tracking-tight truncate">
                {companyName}
              </h1>
              <p className="font-body text-[9px] tracking-wider text-cream-dark uppercase font-semibold leading-none mt-1">
                Stores & Purchase
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="md:hidden text-cream-light/60 hover:text-cream-light hover:bg-onyx-light p-1 rounded transition duration-150 cursor-pointer shrink-0"
            title="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mobile Switchers (Only visible on mobile screens) */}
        <div className="md:hidden px-4 py-3 bg-onyx-dark/50 border-b border-onyx-light space-y-2">
          {/* Company switcher select */}
          <div className="relative flex items-center bg-onyx border border-onyx-light rounded-lg text-cream-light px-2.5 py-1.5 text-xs font-semibold">
            <Building2 size={13} className="text-saffron mr-1.5 shrink-0" />
            <select
              value={user.companyId}
              onChange={(e) => handleCompanyChange(e.target.value)}
              className="bg-transparent pr-4 focus:outline-none cursor-pointer appearance-none text-xs font-semibold text-cream-light w-full focus:ring-0 outline-none"
            >
              {companies.map((c) => (
                <option key={c.companyId} value={c.companyId} className="bg-onyx text-cream-light">
                  {c.companyName} ({c.role.replace("_", " ")})
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 pointer-events-none text-cream-dark/50" />
          </div>

          {/* Store switcher select */}
          <div className="relative flex items-center bg-onyx border border-onyx-light rounded-lg text-cream-light px-2.5 py-1.5 text-xs font-semibold">
            <MapPin size={13} className="text-saffron mr-1.5 shrink-0" />
            <select
              value={user.storeId || "all"}
              onChange={(e) => handleStoreChange(e.target.value)}
              className="bg-transparent pr-4 focus:outline-none cursor-pointer appearance-none text-xs font-semibold text-cream-light w-full focus:ring-0 outline-none"
            >
              {(!user.storeScope || user.storeScope.length === 0) && (
                <option value="all" className="bg-onyx text-cream-light">All Stores</option>
              )}
              {stores.map((s) => (
                <option key={s.id} value={s.id} className="bg-onyx text-cream-light">
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 pointer-events-none text-cream-dark/50" />
          </div>
        </div>

      {/* Nav Menu */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-7">
        {/* General Category */}
        <div>
          <h2 className="text-[10px] uppercase font-semibold text-cream-dark/40 tracking-wider mb-3 px-2">
            Main
          </h2>
          <div className="space-y-1">
            <Link
              href="/dashboard"
              className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                pathname === "/dashboard" 
                  ? "bg-saffron text-onyx font-semibold shadow-md" 
                  : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
              }`}
            >
              <LayoutDashboard size={18} />
              <span>Dashboard</span>
            </Link>
          </div>
        </div>

        {/* Stores Category */}
        { (isStore || isQC || role === "INDENTER") && (
          <div>
            <h2 className="text-[10px] uppercase font-semibold text-cream-dark/40 tracking-wider mb-3 px-2">
              Stores & Inventory
            </h2>
            <div className="space-y-1">
              <Link
                href="/stores/items"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/stores/items")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Package size={18} />
                <span>Item Master</span>
              </Link>

              <Link
                href="/stores/departments"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/stores/departments")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Database size={18} />
                <span>Departments Master</span>
              </Link>

              <Link
                href="/stores/indents"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/stores/indents")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <ClipboardList size={18} />
                <span>Indents</span>
              </Link>

              <Link
                href="/stores/reorders"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/stores/reorders")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <RefreshCw size={18} />
                <span>Reorder Basket</span>
              </Link>

              {can(user, "grn.post") && (
                <Link
                  href="/stores/grn"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/stores/grn")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <History size={18} />
                  <span>GRN (Inwards)</span>
                </Link>
              )}

              {can(user, "inspection.record") && (
                <Link
                  href="/stores/inspection"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/stores/inspection")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <ShieldCheck size={18} />
                  <span>QC Inspection</span>
                </Link>
              )}

              {(can(user, "grn.post") || can(user, "inspection.record")) && (
                <Link
                  href="/stores/rejected-material"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/stores/rejected-material")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <AlertTriangle size={18} />
                  <span>Rejected Materials</span>
                </Link>
              )}

              {(can(user, "issue.create") || can(user, "gatepass.create")) && (
                <Link
                  href="/stores/outwards"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/stores/outwards")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <Truck size={18} />
                  <span>Outwards & Gatepass</span>
                </Link>
              )}

              <Link
                href="/stores/reports"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/stores/reports")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <FileText size={18} />
                <span>Stores Reports</span>
              </Link>
            </div>
          </div>
        )}

        {/* Purchase Category */}
        { (isPurchase || isAccounts) && (
          <div>
            <h2 className="text-[10px] uppercase font-semibold text-cream-dark/40 tracking-wider mb-3 px-2">
              Purchase Module
            </h2>
            <div className="space-y-1">
              <Link
                href="/purchase/vendors"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/purchase/vendors")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Database size={18} />
                <span>Vendor Master</span>
              </Link>

              <Link
                href="/purchase/shipto"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/purchase/shipto")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <MapPin size={18} />
                <span>Ship-To Locations</span>
              </Link>

              <Link
                href="/purchase/requisitions"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/purchase/requisitions")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <ShoppingCart size={18} />
                <span>PR & RFQs</span>
              </Link>

              <Link
                href="/purchase/po"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/purchase/po")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <ClipboardList size={18} />
                <span>Purchase Orders</span>
              </Link>

              {(can(user, "po.approve") || can(user, "company.settings.edit") || ["ADMIN", "OWNER", "PURCHASE_MANAGER", "APPROVER"].includes(role)) && (
                <Link
                  href="/purchase/po/settings"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/purchase/po/settings")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <Settings size={18} />
                  <span>PO Terms Settings</span>
                </Link>
              )}

              {can(user, "invoice.match") && (
                <Link
                  href="/purchase/invoices"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/purchase/invoices")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <Receipt size={18} />
                  <span>Invoices (3-Way Match)</span>
                </Link>
              )}

              {(can(user, "invoice.match") || can(user, "payment.record")) && (
                <Link
                  href="/purchase/debit-notes"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/purchase/debit-notes")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <FileText size={18} />
                  <span>Debit/Credit Notes</span>
                </Link>
              )}

              {can(user, "payment.record") && (
                <Link
                  href="/purchase/payments"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/purchase/payments")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <CreditCard size={18} />
                  <span>Supplier Payments</span>
                </Link>
              )}

              <Link
                href="/purchase/reports"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/purchase/reports")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <TrendingUp size={18} />
                <span>Purchase Reports</span>
              </Link>
            </div>
          </div>
        )}

        {/* Sales & Dispatch Category */}
        { isSales && (
          <div>
            <h2 className="text-[10px] uppercase font-semibold text-cream-dark/40 tracking-wider mb-3 px-2">
              Sales & Dispatch
            </h2>
            <div className="space-y-1">
              <Link
                href="/sales/customers"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/sales/customers")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Users size={18} />
                <span>Customer Master</span>
              </Link>

              <Link
                href="/sales/orders"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/sales/orders")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <ClipboardList size={18} />
                <span>Sales Orders</span>
              </Link>

              {(can(user, "dispatch.create") || ["ADMIN", "OWNER", "STORE_MANAGER", "STORE_KEEPER"].includes(role)) && (
                <Link
                  href="/sales/dispatch"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/sales/dispatch")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <PackageOpen size={18} />
                  <span>Dispatch & Delivery</span>
                </Link>
              )}

              {(can(user, "sales.invoice") || ["ADMIN", "OWNER", "ACCOUNTS"].includes(role)) && (
                <Link
                  href="/sales/invoices"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/sales/invoices")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <QrCode size={18} />
                  <span>Invoices & E-Invoice</span>
                </Link>
              )}

              {(can(user, "receipt.record") || ["ADMIN", "OWNER", "ACCOUNTS"].includes(role)) && (
                <Link
                  href="/sales/receipts"
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    isActive("/sales/receipts")
                      ? "bg-saffron text-onyx font-semibold shadow-md"
                      : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                  }`}
                >
                  <CreditCard size={18} />
                  <span>Customer Receipts</span>
                </Link>
              )}

              <Link
                href="/sales/reports"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/sales/reports")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <TrendingUp size={18} />
                <span>Receivables Reports</span>
              </Link>
            </div>
          </div>
        )}

        {/* Integration Category */}
        {can(user, "erp.config") && (
          <div>
            <h2 className="text-[10px] uppercase font-semibold text-cream-dark/40 tracking-wider mb-3 px-2">
              System Admin
            </h2>
            <div className="space-y-1">
              <Link
                href="/integration"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/integration")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Map size={18} />
                <span>ERP & Tally Settings</span>
              </Link>
            </div>
          </div>
        )}

        {/* Settings & Control Category */}
        {isAdmin && (
          <div>
            <h2 className="text-[10px] uppercase font-semibold text-cream-dark/40 tracking-wider mb-3 px-2">
              Settings & Control
            </h2>
            <div className="space-y-1">
              <Link
                href="/settings/company"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/settings/company")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Building2 size={18} />
                <span>Company Profile</span>
              </Link>

              <Link
                href="/settings/documents"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/settings/documents")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <FileText size={18} />
                <span>Document Settings</span>
              </Link>

              <Link
                href="/settings/members"
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive("/settings/members")
                    ? "bg-saffron text-onyx font-semibold shadow-md"
                    : "hover:bg-onyx-light text-cream-light/80 hover:text-cream-light"
                }`}
              >
                <Database size={18} />
                <span>Members & Roles</span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* User Footer Profile & Logout */}
      <div className="p-4 border-t border-onyx-light bg-onyx-dark flex flex-col space-y-2">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-saffron text-onyx flex items-center justify-center font-bold text-sm">
            {user.name ? user.name[0].toUpperCase() : user.email?.[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-cream-light">
              {user.name || "User"}
            </p>
            <p className="text-[10px] text-cream-dark/50 font-mono tracking-wider uppercase">
              {role.replace("_", " ")}
            </p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full mt-2 flex items-center justify-center space-x-2 px-3 py-2 bg-onyx hover:bg-red-950 text-cream-light hover:text-red-200 border border-onyx-light hover:border-red-900 rounded-lg text-xs font-semibold transition-all duration-200"
        >
          <Settings size={14} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  </>
  );
}
