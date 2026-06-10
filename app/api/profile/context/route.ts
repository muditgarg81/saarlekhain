import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const storeId = (session.user as any).storeId;

  try {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true, displayName: true }
    });

    const storeScope = (session.user as any).storeScope || [];
    let storeName = "All Stores";

    if (storeId) {
      const store = await db.store.findUnique({
        where: { id: storeId },
        select: { name: true }
      });
      if (store) storeName = store.name;
    } else if (storeScope.length > 0) {
      // If scoped but no active storeId, show the first scoped store
      const store = await db.store.findUnique({
        where: { id: storeScope[0] },
        select: { name: true }
      });
      if (store) storeName = store.name;
    }

    return NextResponse.json({
      companyName: company?.displayName || company?.name || "Saarlekha Factory",
      storeName: storeName
    });
  } catch (err) {
    console.error("Error fetching context profile details:", err);
    return NextResponse.json({
      companyName: "Saarlekha Factory",
      storeName: "All Stores"
    });
  }
}
