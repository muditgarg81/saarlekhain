import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPresets, getTermsConfig, getCompanyProfile } from "@/app/actions/termsPresets";
import PoTermsSettingsClient from "./PoTermsSettingsClient";

export default async function PoTermsSettingsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const userRole = (session.user as any).role || "VIEWER";

  // Only allow admin, manager, owner, or approver to modify terms settings
  const hasAccess = ["ADMIN", "OWNER", "PURCHASE_MANAGER", "APPROVER"].includes(userRole);
  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center bg-cream rounded-xl border border-onyx/5">
        <h3 className="text-lg font-bold text-onyx mb-2">Access Denied</h3>
        <p className="text-sm text-onyx/50 max-w-md">You do not have the required permissions to access the PO Terms and Conditions settings page. Please contact your administrator.</p>
      </div>
    );
  }

  // Load configuration, presets, and profile concurrently
  const [presets, config, companyProfile] = await Promise.all([
    getPresets(),
    getTermsConfig(),
    getCompanyProfile()
  ]);

  return (
    <PoTermsSettingsClient
      initialPresets={presets}
      initialConfig={config}
      initialProfile={companyProfile}
    />
  );
}
