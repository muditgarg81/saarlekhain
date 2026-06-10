import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NotifCategory } from "@prisma/client";

export async function GET(req: Request) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const categoryParam = searchParams.get("category");

  try {
    const whereClause: any = {
      companyId,
      userId,
    };

    if (unreadOnly) {
      whereClause.readAt = null;
    }

    if (categoryParam) {
      whereClause.category = categoryParam as NotifCategory;
    }

    const notifications = await db.notification.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(notifications);
  } catch (err) {
    console.error("Error listing notifications:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  try {
    const body = await req.json();
    const { notificationId, all } = body;

    if (all) {
      await db.notification.updateMany({
        where: {
          companyId,
          userId,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });
      return NextResponse.json({ success: true, message: "All notifications marked as read" });
    }

    if (notificationId) {
      const updated = await db.notification.updateMany({
        where: {
          id: notificationId,
          companyId,
          userId,
        },
        data: {
          readAt: new Date(),
        },
      });
      return NextResponse.json({ success: true, updatedCount: updated.count });
    }

    return NextResponse.json({ error: "Bad Request: Specify notificationId or all=true" }, { status: 400 });
  } catch (err) {
    console.error("Error updating notifications:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
