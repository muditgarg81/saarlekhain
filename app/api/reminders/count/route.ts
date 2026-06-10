import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getReminders } from "@/lib/reminders";

export async function GET() {
  const session = await auth();

  if (!session || !session.user) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }

  const user = {
    id: (session.user as any).id,
    role: (session.user as any).role || "VIEWER",
    companyId: (session.user as any).companyId || "demo-company-id",
    storeId: (session.user as any).storeId,
  };

  try {
    const reminders = await getReminders(user);
    const totalCount = reminders.reduce((sum, item) => sum + item.count, 0);
    return NextResponse.json({ count: totalCount });
  } catch (err) {
    console.error("Error getting reminders count:", err);
    return NextResponse.json({ count: 0 });
  }
}
