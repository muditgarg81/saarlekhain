import { db } from "@/lib/db";

export async function getLogisticsData(companyId: string) {
  const [transporters, rates, orders, bills, purchaseOrders, grns] = await Promise.all([
    db.vendor.findMany({
      where: { companyId, category: "TRANSPORTER", deletedAt: null },
      orderBy: { code: "asc" },
    }),
    db.transportRate.findMany({
      where: { companyId, deletedAt: null },
      include: { transporter: true },
      orderBy: { createdAt: "desc" },
    }),
    db.transportOrder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        transporter: true,
        po: true,
        grn: true,
        bills: {
          where: { deletedAt: null },
          include: { payments: true },
        },
      },
      orderBy: { number: "desc" },
    }),
    db.transportBill.findMany({
      where: { companyId, deletedAt: null },
      include: {
        transportOrder: { include: { transporter: true } },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.purchaseOrder.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, number: true },
      orderBy: { number: "desc" },
    }),
    db.grn.findMany({
      where: { companyId, status: "POSTED", deletedAt: null },
      select: { id: true, number: true },
      orderBy: { number: "desc" },
    }),
  ]);

  const mappedTransporters = transporters.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    gstin: t.gstin,
    address: t.address,
    creditDays: t.creditDays,
  }));

  const mappedRates = rates.map((r) => ({
    id: r.id,
    transporterId: r.transporterId,
    transporterName: r.transporter.name,
    fromLocation: r.fromLocation,
    toLocation: r.toLocation,
    vehicleCapacity: r.vehicleCapacity,
    rate: r.rate,
  }));

  const mappedOrders = orders.map((o) => {
    const totalBilled = o.bills.reduce((sum, b) => sum + b.amount, 0);
    const totalPaid = o.bills.reduce(
      (sum, b) => sum + b.payments.reduce((s, p) => s + p.amount, 0),
      0
    );
    return {
      id: o.id,
      number: o.number,
      transporterId: o.transporterId,
      transporterName: o.transporter.name,
      vehicleCapacity: o.vehicleCapacity,
      fromLocation: o.fromLocation,
      toLocation: o.toLocation,
      vehicleNo: o.vehicleNo,
      driverName: o.driverName,
      driverPhone: o.driverPhone,
      loadingPoint: o.loadingPoint,
      unloadingPoint: o.unloadingPoint,
      freightAmount: o.freightAmount,
      otherCharges: o.otherCharges,
      taxRate: o.taxRate,
      totalAmount: o.totalAmount,
      status: o.status,
      poId: o.poId,
      poNumber: o.po?.number || null,
      grnId: o.grnId,
      grnNumber: o.grn?.number || null,
      createdAt: o.createdAt.toISOString(),
      totalBilled,
      totalPaid,
    };
  });

  const mappedBills = bills.map((b) => {
    const totalPaid = b.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = b.amount - totalPaid;
    return {
      id: b.id,
      billNo: b.billNo,
      billDate: b.billDate.toISOString(),
      amount: b.amount,
      dueDate: b.dueDate ? b.dueDate.toISOString() : null,
      paymentStatus: b.paymentStatus,
      transportOrderId: b.transportOrderId,
      transportOrderNo: b.transportOrder.number,
      transporterName: b.transportOrder.transporter.name,
      totalPaid,
      balance,
      payments: b.payments.map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        amount: p.amount,
        paymentDate: p.paymentDate.toISOString(),
        paymentMethod: p.paymentMethod,
        referenceNo: p.referenceNo,
      })),
    };
  });

  return {
    transporters: mappedTransporters,
    rates: mappedRates,
    orders: mappedOrders,
    bills: mappedBills,
    purchaseOrders,
    grns,
  };
}
