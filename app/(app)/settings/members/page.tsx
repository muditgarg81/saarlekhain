import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import MembersList from "./MembersList";

export default async function MembersPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const user = session.user as any;
  const isAllowed = can(user, "user.manage");

  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center font-body bg-white border border-onyx/5 rounded-xl p-8">
        <h2 className="text-lg font-bold text-red-700">Access Denied</h2>
        <p className="text-xs text-onyx/60 mt-2">
          You do not have administrative permissions to manage company users and memberships.
        </p>
      </div>
    );
  }

  // Fetch memberships for this company
  const memberships = await db.companyMembership.findMany({
    where: { companyId: user.companyId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      invitedAt: "desc",
    },
  });

  const stores = await db.store.findMany({
    where: { companyId: user.companyId, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });

  const departments = await db.department.findMany({
    where: { companyId: user.companyId },
    select: { id: true, code: true, name: true },
  });

  const currentUserMembership = memberships.find((m) => m.userId === user.id);

  const rolePermissions = await db.rolePermission.findMany({
    where: { companyId: user.companyId },
  });

  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { baseCurrency: true },
  });

  return (
    <MembersList
      initialMembers={JSON.parse(JSON.stringify(memberships))}
      stores={stores}
      departments={departments}
      currentUserRole={currentUserMembership?.role || "VIEWER"}
      currentUserId={user.id}
      initialRolePermissions={JSON.parse(JSON.stringify(rolePermissions))}
      baseCurrency={company?.baseCurrency || "INR"}
    />
  );
}
