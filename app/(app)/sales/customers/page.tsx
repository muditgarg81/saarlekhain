import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import CustomersList from "./CustomersList";
import { getFreshUser } from "@/app/actions/auth";

export default async function CustomersPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const companyId = user.companyId;

  const customers = await db.customer.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { code: "asc" },
  });

  const mapped = customers.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    type: c.type,
    gstin: c.gstin,
    pan: c.pan,
    stateCode: c.stateCode,
    billingAddress: c.billingAddress,
    shippingAddress: c.shippingAddress,
    contactPerson: c.contactPerson,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    paymentTerms: c.paymentTerms,
    creditDays: c.creditDays,
    creditLimit: c.creditLimit,
    tcsApplicable: c.tcsApplicable,
    status: c.status,
  }));

  return <CustomersList initialCustomers={mapped} user={user as any} />;
}
