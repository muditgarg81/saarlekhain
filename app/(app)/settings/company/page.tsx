export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import CompanySettingsForm from "./CompanySettingsForm";

export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const user = session.user as any;
  const isAllowed = can(user, "company.settings.edit");

  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center font-body bg-white border border-onyx/5 rounded-xl p-8">
        <h2 className="text-lg font-bold text-red-700">Access Denied</h2>
        <p className="text-xs text-onyx/60 mt-2">
          You do not have administrative permissions to edit company settings.
        </p>
      </div>
    );
  }

  const company = await db.company.findUnique({
    where: { id: user.companyId },
  });

  if (!company) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-red-600">Active company not found in database.</p>
      </div>
    );
  }

  const stores = await db.store.findMany({
    where: { companyId: user.companyId, status: "ACTIVE" },
    select: { id: true, name: true },
  });

  return (
    <CompanySettingsForm
      initialCompany={JSON.parse(JSON.stringify(company))}
      stores={stores}
    />
  );
}
