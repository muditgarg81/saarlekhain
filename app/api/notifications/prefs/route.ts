import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NotifCategory } from "@prisma/client";

export async function GET() {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  try {
    let pref = await db.notificationPref.findUnique({
      where: {
        companyId_userId: { companyId, userId },
      },
    });

    if (!pref) {
      // Create default preferences if they don't exist
      pref = await db.notificationPref.create({
        data: {
          companyId,
          userId,
          inApp: true,
          email: false,
          emailDigest: "DAILY",
          mutedCategories: [],
        },
      });
    }

    return NextResponse.json(pref);
  } catch (err) {
    console.error("Error fetching notification preferences:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  try {
    const body = await req.json();
    const { inApp, email, emailDigest, mutedCategories } = body;

    const updated = await db.notificationPref.upsert({
      where: {
        companyId_userId: { companyId, userId },
      },
      update: {
        inApp: inApp !== undefined ? inApp : undefined,
        email: email !== undefined ? email : undefined,
        emailDigest: emailDigest !== undefined ? emailDigest : undefined,
        mutedCategories: mutedCategories !== undefined ? (mutedCategories as NotifCategory[]) : undefined,
      },
      create: {
        companyId,
        userId,
        inApp: inApp !== undefined ? inApp : true,
        email: email !== undefined ? email : false,
        emailDigest: emailDigest !== undefined ? emailDigest : "DAILY",
        mutedCategories: mutedCategories !== undefined ? (mutedCategories as NotifCategory[]) : [],
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Error updating notification preferences:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
