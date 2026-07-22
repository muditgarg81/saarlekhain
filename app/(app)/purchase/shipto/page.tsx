export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import ShipToLocationsList from "./ShipToLocationsList";

export default async function ShipToLocationsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId;
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch ship to locations for this company
  const locations = await db.shipToLocation.findMany({
    where: { companyId },
    orderBy: { code: "asc" }
  });

  return (
    <ShipToLocationsList 
      locations={locations} 
      userRole={userRole}
    />
  );
}
