import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  try {
    const memberships = await db.companyMembership.findMany({
      where: {
        userId,
        status: "ACTIVE",
      },
      include: {
        company: {
          select: {
            name: true,
            displayName: true,
            logoUrl: true,
          },
        },
      },
    });

    const result = memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.displayName || m.company.name,
      logoUrl: m.company.logoUrl,
      role: m.role,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("Error fetching memberships:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
