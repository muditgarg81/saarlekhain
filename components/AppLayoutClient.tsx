"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { 
  LayoutDashboard, 
  ClipboardList, 
  History, 
  ShoppingCart, 
  Receipt 
} from "lucide-react";
import { can } from "@/lib/rbac";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";

interface AppLayoutClientProps {
  user: any;
  children: React.ReactNode;
}

export default function AppLayoutClient({ user, children }: AppLayoutClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const role = user.role;

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

  const mobileTabItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, show: true },
    { name: "Indents", href: "/stores/indents", icon: ClipboardList, show: isStore || role === "INDENTER" },
    { name: "GRN", href: "/stores/grn", icon: History, show: can(user, "grn.post") },
    { name: "POs", href: "/purchase/po", icon: ShoppingCart, show: isPurchase },
    { name: "Invoices", href: "/purchase/invoices", icon: Receipt, show: can(user, "invoice.match") }
  ].filter(item => item.show);

  return (
    <div className="flex h-screen overflow-hidden bg-cream relative">
      {/* Sidebar navigation */}
      <Sidebar user={user} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main workspace */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Header bar */}
        <Header user={user} onMenuClick={() => setSidebarOpen(true)} />

        {/* Scrollable page body */}
        <main className="flex-1 overflow-y-auto bg-cream p-4 md:p-8 pb-20 md:pb-8">
          {children}
        </main>

        {/* Mobile Bottom Tab Bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-onyx border-t border-onyx-light flex items-stretch h-16">
          {mobileTabItems.map(item => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors ${
                  isActive ? 'text-saffron font-bold' : 'text-cream-dark/60 hover:text-cream-light'
                }`}
              >
                <item.icon className={`h-5 w-5 ${isActive ? 'text-saffron' : 'text-cream-dark/50'}`} />
                <span className={`font-semibold ${isActive ? 'text-saffron' : 'text-cream-dark/60'}`}>
                  {item.name}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
