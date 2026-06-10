"use client";

import React, { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";

interface AppLayoutClientProps {
  user: any;
  children: React.ReactNode;
}

export default function AppLayoutClient({ user, children }: AppLayoutClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-cream relative">
      {/* Sidebar navigation */}
      <Sidebar user={user} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main workspace */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Header bar */}
        <Header user={user} onMenuClick={() => setSidebarOpen(true)} />

        {/* Scrollable page body */}
        <main className="flex-1 overflow-y-auto bg-cream p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
