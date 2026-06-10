"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ErpType, ErpConnStatus, ErpMapStatus } from "@prisma/client";

export async function saveErpConnection(data: {
  type: ErpType;
  erpCompanyName: string;
  writebackEnabled: boolean;
  demoMode: boolean;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    const conn = await db.erpConnection.upsert({
      where: {
        companyId_type_erpCompanyName: {
          companyId,
          type: data.type,
          erpCompanyName: data.erpCompanyName
        }
      },
      update: {
        writebackEnabled: data.writebackEnabled,
        status: data.demoMode ? ErpConnStatus.ACTIVE : ErpConnStatus.AGENT_OFFLINE,
        config: { demoMode: data.demoMode }
      },
      create: {
        companyId,
        type: data.type,
        erpCompanyName: data.erpCompanyName,
        writebackEnabled: data.writebackEnabled,
        status: data.demoMode ? ErpConnStatus.ACTIVE : ErpConnStatus.AGENT_OFFLINE,
        config: { demoMode: data.demoMode }
      }
    });

    revalidatePath("/integration");
    return { success: true, connection: conn };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to save ERP configuration" };
  }
}

export async function mapVendorLedger(data: {
  connectionId: string;
  vendorId: string;
  erpLedgerName: string;
  billwise: boolean;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    const map = await db.vendorErpMap.upsert({
      where: {
        companyId_connectionId_vendorId: {
          companyId,
          connectionId: data.connectionId,
          vendorId: data.vendorId
        }
      },
      update: {
        erpLedgerName: data.erpLedgerName,
        billwise: data.billwise,
        status: data.billwise ? ErpMapStatus.MAPPED : ErpMapStatus.NOT_BILLWISE
      },
      create: {
        companyId,
        connectionId: data.connectionId,
        vendorId: data.vendorId,
        erpLedgerName: data.erpLedgerName,
        billwise: data.billwise,
        status: data.billwise ? ErpMapStatus.MAPPED : ErpMapStatus.NOT_BILLWISE
      }
    });

    revalidatePath("/integration");
    return { success: true, mapping: map };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to map vendor" };
  }
}

export async function generateBridgeAgentToken(connectionId: string, name: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    const token = `agent_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`;
    
    const agent = await db.bridgeAgent.create({
      data: {
        companyId,
        connectionId,
        name,
        tokenHash: token, // Using plaintext token directly as ID for simple auth in this demo
        version: "1.0.0"
      }
    });

    revalidatePath("/integration");
    return { success: true, token: agent.id }; // return the agent ID to show to user once
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to register bridge agent" };
  }
}

export async function syncCreditorsMock(connectionId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    // 1. Fetch all mapped vendors
    const maps = await db.vendorErpMap.findMany({
      where: { companyId, connectionId },
      include: { connection: true }
    });

    if (maps.length === 0) {
      return { success: false, error: "Please map at least one vendor first" };
    }

    // 2. Generate simulated statements and bills for each mapped vendor
    for (const map of maps) {
      // Mock outstanding amount
      const outstanding = Math.floor(Math.random() * 450000) + 50000;
      
      const statement = await db.creditorStatement.upsert({
        where: {
          companyId_connectionId_vendorId: {
            companyId,
            connectionId,
            vendorId: map.vendorId
          }
        },
        update: {
          outstanding,
          asOf: new Date()
        },
        create: {
          companyId,
          connectionId,
          vendorId: map.vendorId,
          outstanding,
          asOf: new Date()
        }
      });

      // Clear existing bills
      await db.creditorBill.deleteMany({
        where: { companyId, statementId: statement.id }
      });

      // Create 2-3 mock outstanding bills
      const billCount = Math.floor(Math.random() * 2) + 2;
      const billsData = [];

      for (let i = 1; i <= billCount; i++) {
        const amt = Math.floor(outstanding / billCount);
        const billRef = `BILL-26-${1000 + Math.floor(Math.random() * 9000)}`;
        const billDate = new Date();
        billDate.setDate(billDate.getDate() - (Math.floor(Math.random() * 60) + 10)); // 10-70 days ago
        
        const dueDate = new Date(billDate);
        dueDate.setDate(dueDate.getDate() + 30); // Net 30

        const today = new Date();
        const diffTime = today.getTime() - dueDate.getTime();
        const overdueDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        billsData.push({
          companyId,
          statementId: statement.id,
          billRef,
          billDate,
          dueDate,
          openingAmount: amt + Math.floor(Math.random() * 2000),
          pendingAmount: amt,
          overdueDays
        });
      }

      await db.creditorBill.createMany({
        data: billsData
      });
    }

    // Update connection lastSync
    await db.erpConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() }
    });

    revalidatePath("/integration");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to sync mock data" };
  }
}
