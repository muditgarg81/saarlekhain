import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { SessionProvider } from "next-auth/react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // If not logged in, redirect to signin
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  // Ensure user has necessary session properties
  const user = {
    id: (session.user as any).id,
    name: session.user.name,
    email: session.user.email,
    role: (session.user as any).role || "VIEWER",
    companyId: (session.user as any).companyId || "demo-company-id",
    storeId: (session.user as any).storeId,
    storeScope: (session.user as any).storeScope || [],
  };

  return (
    <SessionProvider session={session}>
      <div className="flex h-screen overflow-hidden bg-cream">
        {/* Sidebar navigation */}
        <Sidebar user={user} />

        {/* Main workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header bar */}
          <Header user={user} />

          {/* Scrollable page body */}
          <main className="flex-1 overflow-y-auto bg-cream p-8">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
