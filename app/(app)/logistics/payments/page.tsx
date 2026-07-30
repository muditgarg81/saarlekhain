export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getFreshUser } from "@/app/actions/auth";
import { db } from "@/lib/db";
import FreightPaymentsClient from "./FreightPaymentsClient";

export default async function FreightPaymentsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");

  const companyId = user.companyId;

  const bills = await db.transportBill.findMany({
    where: { companyId, deletedAt: null },
    include: {
      transportOrder: { include: { transporter: true } },
      payments: { orderBy: { paymentDate: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = bills.map((b) => {
    const totalPaid = b.payments.reduce((s, p) => s + p.amount, 0);
    return {
      id: b.id,
      billNo: b.billNo,
      billDate: b.billDate.toISOString(),
      amount: b.amount,
      dueDate: b.dueDate ? b.dueDate.toISOString() : null,
      paymentStatus: b.paymentStatus,
      transportOrderNo: b.transportOrder.number,
      transporterName: b.transportOrder.transporter.name,
      totalPaid,
      balance: b.amount - totalPaid,
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

  return <FreightPaymentsClient bills={mapped} />;
}
