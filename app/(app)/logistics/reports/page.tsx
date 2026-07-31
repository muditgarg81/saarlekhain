export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import LogisticsReportsList from "./LogisticsReportsList";

interface PageProps {
  searchParams: Promise<{ period?: string; startDate?: string; endDate?: string }>;
}

export default async function LogisticsReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const period = params.period || "all";
  const startDateStr = params.startDate;
  const endDateStr = params.endDate;

  const session = await auth();
  if (!session || !session.user) redirect("/auth/signin");
  const companyId = (session.user as any).companyId;

  let dateFilter: any = {};
  if (period === "custom") {
    if (startDateStr) { const s = new Date(startDateStr); s.setHours(0,0,0,0); dateFilter.gte = s; }
    if (endDateStr)   { const e = new Date(endDateStr);   e.setHours(23,59,59,999); dateFilter.lte = e; }
  } else if (period !== "all") {
    const s = new Date();
    if (period === "1m") s.setMonth(s.getMonth() - 1);
    else if (period === "3m") s.setMonth(s.getMonth() - 3);
    else if (period === "6m") s.setMonth(s.getMonth() - 6);
    else if (period === "1y") s.setFullYear(s.getFullYear() - 1);
    s.setHours(0,0,0,0);
    dateFilter = { gte: s };
  }
  const hasDateFilter = period !== "all" && Object.keys(dateFilter).length > 0;

  const [orders, bills, rates] = await Promise.all([
    db.transportOrder.findMany({
      where: {
        companyId, deletedAt: null,
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: {
        transporter: true,
        po: { select: { number: true } },
        bills: { where: { deletedAt: null }, include: { payments: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.transportBill.findMany({
      where: {
        companyId, deletedAt: null,
        ...(hasDateFilter ? { billDate: dateFilter } : {}),
      },
      include: {
        transportOrder: { include: { transporter: true } },
        payments: true,
      },
      orderBy: { billDate: "desc" },
    }),
    db.transportRate.findMany({
      where: { companyId, deletedAt: null },
      include: { transporter: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Map orders
  const mappedOrders = orders.map(o => {
    const totalBilled = o.bills.reduce((s, b) => s + b.amount, 0);
    const totalPaid  = o.bills.reduce((s, b) => s + b.payments.reduce((ps, p) => ps + p.amount, 0), 0);
    return {
      id: o.id,
      number: o.number,
      createdAt: o.createdAt.toISOString(),
      status: o.status as string,
      transporterName: o.transporter.name,
      transporterCode: o.transporter.code,
      fromLocation: o.fromLocation,
      toLocation: o.toLocation,
      vehicleCapacity: o.vehicleCapacity,
      vehicleNo: o.vehicleNo,
      driverName: o.driverName,
      freightAmount: o.freightAmount,
      otherCharges: o.otherCharges,
      taxRate: o.taxRate,
      totalAmount: o.totalAmount,
      poNumber: o.po?.number || null,
      tripDescription: o.tripDescription,
      totalBilled,
      totalPaid,
      outstanding: totalBilled - totalPaid,
    };
  });

  // Transporter summary
  const tMap: Record<string, { name: string; code: string; orderCount: number; totalFreight: number; delivered: number; billed: number; paid: number }> = {};
  orders.forEach(o => {
    if (!tMap[o.transporterId]) tMap[o.transporterId] = { name: o.transporter.name, code: o.transporter.code, orderCount: 0, totalFreight: 0, delivered: 0, billed: 0, paid: 0 };
    const t = tMap[o.transporterId];
    t.orderCount++;
    t.totalFreight += o.totalAmount;
    if (o.status === "DELIVERED") t.delivered++;
    t.billed += o.bills.reduce((s, b) => s + b.amount, 0);
    t.paid   += o.bills.reduce((s, b) => s + b.payments.reduce((ps, p) => ps + p.amount, 0), 0);
  });
  const transporterStats = Object.values(tMap).sort((a, b) => b.totalFreight - a.totalFreight);

  // Route summary
  const rMap: Record<string, { from: string; to: string; orderCount: number; totalFreight: number; avgFreight: number }> = {};
  orders.forEach(o => {
    const key = `${o.fromLocation}||${o.toLocation}`;
    if (!rMap[key]) rMap[key] = { from: o.fromLocation, to: o.toLocation, orderCount: 0, totalFreight: 0, avgFreight: 0 };
    rMap[key].orderCount++;
    rMap[key].totalFreight += o.totalAmount;
  });
  Object.values(rMap).forEach(r => { r.avgFreight = r.orderCount > 0 ? r.totalFreight / r.orderCount : 0; });
  const routeStats = Object.values(rMap).sort((a, b) => b.totalFreight - a.totalFreight);

  // Monthly freight trend
  const monthMap: Record<string, { label: string; count: number; freight: number }> = {};
  orders.forEach(o => {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    if (!monthMap[key]) monthMap[key] = { label, count: 0, freight: 0 };
    monthMap[key].count++;
    monthMap[key].freight += o.totalAmount;
  });
  const monthlyTrend = Object.entries(monthMap).sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v);

  // Bills / payment ageing
  const mappedBills = bills.map(b => {
    const paid = b.payments.reduce((s, p) => s + p.amount, 0);
    const daysOverdue = b.dueDate ? Math.floor((Date.now() - new Date(b.dueDate).getTime()) / 86400000) : null;
    return {
      id: b.id,
      billNo: b.billNo,
      billDate: b.billDate.toISOString(),
      dueDate: b.dueDate ? b.dueDate.toISOString() : null,
      amount: b.amount,
      paid,
      balance: b.amount - paid,
      paymentStatus: b.paymentStatus as string,
      transportOrderNo: b.transportOrder.number,
      transporterName: b.transportOrder.transporter.name,
      daysOverdue,
    };
  });

  // Contracts
  const mappedContracts = rates.map(r => ({
    id: r.id,
    contractNo: r.contractNo,
    transporterName: r.transporter.name,
    fromLocation: r.fromLocation,
    toLocation: r.toLocation,
    vehicleCapacity: r.vehicleCapacity,
    rate: r.rate,
    usageCount: orders.filter(o =>
      o.transporterId === r.transporterId &&
      o.fromLocation === r.fromLocation &&
      o.toLocation === r.toLocation &&
      o.vehicleCapacity === r.vehicleCapacity
    ).length,
  }));

  // KPIs
  const totalOrders     = mappedOrders.length;
  const totalFreight    = mappedOrders.reduce((s, o) => s + o.totalAmount, 0);
  const totalBilled     = mappedBills.reduce((s, b) => s + b.amount, 0);
  const totalPaid       = mappedBills.reduce((s, b) => s + b.paid, 0);
  const totalOutstanding = totalBilled - totalPaid;
  const overdueCount    = mappedBills.filter(b => b.daysOverdue !== null && b.daysOverdue > 0 && b.balance > 0).length;
  const deliveredPct    = totalOrders > 0 ? Math.round(mappedOrders.filter(o => o.status === "DELIVERED").length / totalOrders * 100) : 0;

  const kpis = { totalOrders, totalFreight, totalBilled, totalPaid, totalOutstanding, overdueCount, deliveredPct };

  return (
    <LogisticsReportsList
      orders={mappedOrders}
      bills={mappedBills}
      transporterStats={transporterStats}
      routeStats={routeStats}
      monthlyTrend={monthlyTrend}
      contracts={mappedContracts}
      kpis={kpis}
      period={period}
      startDate={startDateStr || ""}
      endDate={endDateStr || ""}
    />
  );
}
