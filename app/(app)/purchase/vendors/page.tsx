import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import VendorsList from "./VendorsList";
import { getFreshUser } from "@/app/actions/auth";

export default async function VendorsPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const companyId = user.companyId;

  // Fetch all active vendors for the company
  const vendors = await db.vendor.findMany({
    where: {
      companyId,
      deletedAt: null,
    },
    orderBy: {
      code: "asc",
    },
  });

  // Map db json to expected bankDetails shape
  const mappedVendors = vendors.map((v) => {
    let parsedBank = null;
    if (v.bankDetails) {
      try {
        parsedBank = typeof v.bankDetails === 'string' ? JSON.parse(v.bankDetails) : v.bankDetails;
      } catch (e) {
        parsedBank = v.bankDetails;
      }
    }

    return {
      id: v.id,
      code: v.code,
      name: v.name,
      gstin: v.gstin,
      pan: v.pan,
      udyamNo: v.udyamNo,
      category: v.category,
      paymentTerms: v.paymentTerms,
      creditDays: v.creditDays,
      tdsApplicable: v.tdsApplicable,
      bankDetails: parsedBank,
      status: v.status,
    };
  });

  return (
    <VendorsList
      initialVendors={mappedVendors}
      user={user}
    />
  );
}
