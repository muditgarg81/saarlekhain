import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  try {
    const body = await req.json();
    const { category, snoozeHours } = body;

    if (!category) {
      return NextResponse.json({ error: "Bad Request: category is required" }, { status: 400 });
    }

    let snoozeUntil: Date | null = null;
    if (snoozeHours && typeof snoozeHours === "number" && snoozeHours > 0) {
      snoozeUntil = new Date();
      snoozeUntil.setHours(snoozeUntil.getHours() + snoozeHours);
    }

    // Upsert or create dismissal
    // Since unique constraint is not on [companyId, userId, category] (it only has an index),
    // let's check if one already exists, or just create it or update it.
    const existing = await db.reminderDismissal.findFirst({
      where: {
        companyId,
        userId,
        category,
      },
    });

    if (existing) {
      await db.reminderDismissal.update({
        where: { id: existing.id },
        data: {
          snoozeUntil,
          createdAt: new Date(),
        },
      });
    } else {
      await db.reminderDismissal.create({
        data: {
          companyId,
          userId,
          category,
          snoozeUntil,
        },
      });
    }

    return NextResponse.json({ success: true, category, snoozeUntil });
  } catch (err) {
    console.error("Error snoozing/dismissing reminder:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
