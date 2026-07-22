export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  } else {
    redirect("/select-company");
  }
}
