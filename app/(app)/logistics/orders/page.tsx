export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getFreshUser } from "@/app/actions/auth";
import { getLogisticsData } from "@/lib/logistics-data";
import TransportManagementClient from "@/app/(app)/purchase/transport/TransportManagementClient";

export default async function LogisticsOrdersPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");

  const data = await getLogisticsData(user.companyId);

  return <TransportManagementClient {...data} defaultTab="orders" />;
}
