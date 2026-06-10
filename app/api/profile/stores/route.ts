import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const storeScope = (session.user as any).storeScope as string[] || [];

  try {
    const whereClause: any = {
      companyId,
      status: "ACTIVE",
    };

    if (storeScope.length > 0) {
      whereClause.id = { in: storeScope };
    }

    const stores = await db.store.findMany({
      where: whereClause,
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json(stores);
  } catch (err) {
    console.error("Error fetching stores:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
