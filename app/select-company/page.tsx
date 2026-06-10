import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import SelectCompanyClient from "./SelectCompanyClient";

export default async function SelectCompanyPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const userId = (session.user as any).id;

  // Fetch active memberships
  const memberships = await db.companyMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          displayName: true,
          logoUrl: true,
        },
      },
    },
    orderBy: {
      invitedAt: "desc",
    },
  });

  return (
    <SelectCompanyClient
      memberships={JSON.parse(JSON.stringify(memberships))}
      session={session}
    />
  );
}
