import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import DispatchList from "./DispatchList";
import { getFreshUser } from "@/app/actions/auth";

export default async function DispatchPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [dispatches, openOrders, stores, items, customers] = await Promise.all([
    db.dispatch.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { lines: true, so: { select: { number: true } } },
      take: 200,
    }),
    db.salesOrder.findMany({
      where: { companyId, deletedAt: null, status: { in: ["CONFIRMED", "PARTIALLY_DISPATCHED"] } },
      include: { customer: { select: { name: true, code: true } }, lines: true },
      orderBy: { createdAt: "desc" },
    }),
    db.store.findMany({ where: { companyId }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { companyId, deletedAt: null }, select: { id: true, code: true, name: true } }),
    db.customer.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);

  const itemName = new Map(items.map((i) => [i.id, `${i.name} (${i.code})`]));
  const custName = new Map(customers.map((c) => [c.id, c.name]));

  const mappedDispatches = dispatches.map((d) => ({
    id: d.id,
    number: d.number,
    soNumber: d.so?.number || null,
    customer: custName.get(d.customerId) || "—",
    status: d.status,
    dispatchDate: d.dispatchDate.toISOString(),
    vehicleNo: d.vehicleNo,
    ewayBillNo: d.ewayBillNo,
    ewayBillStatus: d.ewayBillStatus,
    lineCount: d.lines.length,
  }));

  const mappedOrders = openOrders.map((o) => ({
    id: o.id,
    number: o.number,
    customer: `${o.customer.name} (${o.customer.code})`,
    lines: o.lines
      .map((l) => ({
        soLineId: l.id,
        itemId: l.itemId,
        itemName: itemName.get(l.itemId) || l.itemId,
        open: +(l.qty - l.dispatchedQty).toFixed(3),
        rate: l.rate,
      }))
      .filter((l) => l.open > 0),
  })).filter((o) => o.lines.length > 0);

  return (
    <DispatchList
      initialDispatches={mappedDispatches}
      openOrders={mappedOrders}
      stores={stores}
      user={user as any}
    />
  );
}
