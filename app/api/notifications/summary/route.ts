import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getReminders } from "@/lib/reminders";

export async function GET() {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  try {
    const unreadNotificationsCount = await db.notification.count({
      where: {
        companyId,
        userId,
        readAt: null,
      },
    });

    // Compute live reminders
    const reminders = await getReminders(session.user as any);
    const activeRemindersCount = reminders.length; // Count the reminder categories
    const totalReminderUnits = reminders.reduce((sum, r) => sum + r.count, 0);

    const hasCritical = reminders.some((r) => r.severity === "red");

    return NextResponse.json({
      unreadNotifications: unreadNotificationsCount,
      activeReminders: activeRemindersCount,
      totalCount: unreadNotificationsCount + activeRemindersCount, // sum of unread notifications + open action item groups
      totalUnits: unreadNotificationsCount + totalReminderUnits,
      hasCritical,
    });
  } catch (err) {
    console.error("Error fetching notifications summary:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
