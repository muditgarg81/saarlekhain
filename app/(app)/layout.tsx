import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AppLayoutClient from "@/components/AppLayoutClient";
import { SessionProvider } from "next-auth/react";
import { getFreshUser } from "@/app/actions/auth";

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

  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  return (
    <SessionProvider session={session}>
      <AppLayoutClient user={user}>
        {children}
      </AppLayoutClient>
    </SessionProvider>
  );
}
