import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getReminders } from "@/lib/reminders";

export async function GET() {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reminders = await getReminders(session.user as any);
    return NextResponse.json(reminders);
  } catch (err) {
    console.error("Error fetching action items:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
