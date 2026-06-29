import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import OrdersList from "./OrdersList";
import { getFreshUser } from "@/app/actions/auth";

export default async function OrdersPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [orders, customers, items] = await Promise.all([
    db.salesOrder.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true, code: true } }, lines: true },
      take: 200,
    }),
    db.customer.findMany({
      where: { companyId, deletedAt: null, status: "APPROVED" },
      select: { id: true, code: true, name: true, stateCode: true, paymentTerms: true },
      orderBy: { name: "asc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, code: true, name: true, baseUom: true, gstRate: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);

  const mapped = orders.map((o) => ({
    id: o.id,
    number: o.number,
    customer: `${o.customer.name} (${o.customer.code})`,
    type: o.type,
    status: o.status,
    orderDate: o.orderDate.toISOString(),
    deliveryDate: o.deliveryDate?.toISOString() || null,
    customerPoNo: o.customerPoNo,
    value:
      o.lines.reduce(
        (s, l) => s + l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100),
        0
      ) + o.otherCharges,
    lineCount: o.lines.length,
  }));

  return <OrdersList initialOrders={mapped} customers={customers} items={items} user={user as any} />;
}
