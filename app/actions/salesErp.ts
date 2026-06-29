"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { DebtorMapStatus } from "@prisma/client";

// Debtor-side ERP / Tally bridge. The same ErpConnection (and the same on-prem
// bridge agent) that pulls creditor "Bills Payable" pulls debtor "Bills
// Receivable". These actions mirror app/actions/erp.ts, on the sales schema.

export async function mapCustomerLedger(data: {
  connectionId: string;
  customerId: string;
  erpLedgerName: string;
  billwise: boolean;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const map = await db.customerErpMap.upsert({
      where: {
        companyId_connectionId_customerId: {
          companyId,
          connectionId: data.connectionId,
          customerId: data.customerId,
        },
      },
      update: {
        erpLedgerName: data.erpLedgerName,
        billwise: data.billwise,
        status: data.billwise ? DebtorMapStatus.MAPPED : DebtorMapStatus.NOT_BILLWISE,
      },
      create: {
        companyId,
        connectionId: data.connectionId,
        customerId: data.customerId,
        erpLedgerName: data.erpLedgerName,
        billwise: data.billwise,
        status: data.billwise ? DebtorMapStatus.MAPPED : DebtorMapStatus.NOT_BILLWISE,
      },
    });

    revalidatePath("/integration");
    return { success: true, mapping: map };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to map customer" };
  }
}

/**
 * Pulls debtor outstandings for all mapped customers on a connection. Mirrors
 * syncCreditorsMock — generates statements + bills receivable in demo mode.
 * Swap the body for the bridge agent's "Bills Receivable" report ingestion.
 */
export async function syncDebtorsMock(connectionId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const maps = await db.customerErpMap.findMany({
      where: { companyId, connectionId },
      include: { connection: true },
    });
    if (maps.length === 0) {
      return { success: false, error: "Please map at least one customer first" };
    }

    for (const map of maps) {
      const outstanding = Math.floor(Math.random() * 450000) + 50000;

      const statement = await db.debtorStatement.upsert({
        where: {
          companyId_connectionId_customerId: {
            companyId,
            connectionId,
            customerId: map.customerId,
          },
        },
        update: { outstanding, asOf: new Date() },
        create: { companyId, connectionId, customerId: map.customerId, outstanding, asOf: new Date() },
      });

      await db.debtorBill.deleteMany({ where: { companyId, statementId: statement.id } });

      const billCount = Math.floor(Math.random() * 2) + 2;
      const billsData = [];
      for (let i = 1; i <= billCount; i++) {
        const amt = Math.floor(outstanding / billCount);
        const billRef = `SI-26-${1000 + Math.floor(Math.random() * 9000)}`;
        const billDate = new Date();
        billDate.setDate(billDate.getDate() - (Math.floor(Math.random() * 60) + 10));
        const dueDate = new Date(billDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const overdueDays = Math.max(0, Math.ceil((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

        billsData.push({
          companyId,
          statementId: statement.id,
          billRef,
          billDate,
          dueDate,
          openingAmount: amt + Math.floor(Math.random() * 2000),
          pendingAmount: amt,
          overdueDays,
        });
      }
      await db.debtorBill.createMany({ data: billsData });
    }

    await db.erpConnection.update({ where: { id: connectionId }, data: { lastSyncAt: new Date() } });

    revalidatePath("/integration");
    revalidatePath("/sales/reports");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to sync debtor data" };
  }
}
