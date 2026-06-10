import { db } from "./db";
import { can } from "./rbac";

export interface ReminderItem {
  category: string;
  label: string;
  count: number;
  severity: "saffron" | "red"; // saffron = action required, red = critical/overdue
  deepLink: string;
}

/**
 * Computes live action items (reminders) for the session user, filtered by role,
 * permissions, department scope, store scope, and approval value limit.
 */
export async function getReminders(sessionUser: {
  id: string;
  role: string;
  companyId: string;
  storeId?: string | null;
  storeScope?: string[];
  deptScope?: string[];
  approvalLimit?: number | null;
}): Promise<ReminderItem[]> {
  const { role, companyId, storeScope = [], deptScope = [], approvalLimit = null } = sessionUser;
  const reminders: ReminderItem[] = [];

  // Check relevant permissions
  const canApproveIndent = can(sessionUser as any, "indent.approve");
  const canApprovePr = can(sessionUser as any, "pr.approve");
  const canApprovePo = can(sessionUser as any, "po.approve");
  const canRecordInspection = can(sessionUser as any, "inspection.record");
  const canRecordPayment = can(sessionUser as any, "payment.record");
  const isStore = ["STORE_MANAGER", "STORE_KEEPER", "ADMIN", "OWNER"].includes(role);
  const isQC = ["QC_INSPECTOR", "STORE_MANAGER", "ADMIN", "OWNER"].includes(role);

  // Get active reminder config or defaults
  const config = await db.reminderConfig.findUnique({
    where: { companyId },
  }) || {
    deliveryDueDays: 3,
    expiryLeadDays: 30,
    paymentDueDays: 7,
  };

  // Get active dismissals/snoozes for this user (where snooze has not expired)
  const dismissals = await db.reminderDismissal.findMany({
    where: {
      companyId,
      userId: sessionUser.id,
      OR: [
        { snoozeUntil: null },
        { snoozeUntil: { gt: new Date() } }
      ]
    }
  });
  const dismissedCategories = new Set(dismissals.map(d => d.category));

  // --- STORES REMINDERS ---
  
  // 1. Indents Awaiting Approval (filtered by deptScope)
  if (canApproveIndent && !dismissedCategories.has("PENDING_INDENT")) {
    const indentWhere: any = { companyId, status: "SUBMITTED" };
    if (deptScope.length > 0) {
      indentWhere.deptId = { in: deptScope };
    }

    const pendingIndents = await db.indent.count({
      where: indentWhere
    });

    if (pendingIndents > 0) {
      reminders.push({
        category: "PENDING_INDENT",
        label: `${pendingIndents} Indents Awaiting Approval`,
        count: pendingIndents,
        severity: "saffron",
        deepLink: "/stores/indents?status=SUBMITTED"
      });
    }
  }

  // 2. Items Below Reorder Level (filtered by storeScope)
  if (isStore && !dismissedCategories.has("LOW_STOCK")) {
    const itemsWithReorder = await db.item.findMany({
      where: { companyId, reorderLevel: { gt: 0 }, status: "ACTIVE", deletedAt: null },
      select: { id: true, code: true, name: true, reorderLevel: true }
    });

    let lowStockCount = 0;
    for (const item of itemsWithReorder) {
      const ledgerWhere: any = { companyId, itemId: item.id };
      if (storeScope.length > 0) {
        ledgerWhere.storeId = { in: storeScope };
      }

      const stockSum = await db.stockLedger.aggregate({
        where: ledgerWhere,
        _sum: { qty: true }
      });
      const currentStock = stockSum._sum.qty || 0;
      if (currentStock < item.reorderLevel) {
        lowStockCount++;
      }
    }

    if (lowStockCount > 0) {
      reminders.push({
        category: "LOW_STOCK",
        label: `${lowStockCount} Items Below Reorder Level`,
        count: lowStockCount,
        severity: "red",
        deepLink: "/stores/reports?type=low-stock"
      });
    }
  }

  // 3. GRNs Awaiting QC Inspection (filtered by storeScope)
  if (isQC && canRecordInspection && !dismissedCategories.has("QC_PENDING")) {
    const grnWhere: any = { companyId, status: "QC_PENDING" };
    if (storeScope.length > 0) {
      grnWhere.storeId = { in: storeScope };
    }

    const qcPendingCount = await db.grn.count({
      where: grnWhere
    });

    if (qcPendingCount > 0) {
      reminders.push({
        category: "QC_PENDING",
        label: `${qcPendingCount} GRNs Awaiting QC Inspection`,
        count: qcPendingCount,
        severity: "saffron",
        deepLink: "/stores/inspection"
      });
    }
  }

  // 4. Expiring Batches (filtered by storeScope stock)
  if (isStore && !dismissedCategories.has("EXPIRING_BATCHES")) {
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + config.expiryLeadDays);

    let expiringBatches = 0;
    if (storeScope.length > 0) {
      const activeBatchesInScope = await db.stockLedger.findMany({
        where: {
          companyId,
          storeId: { in: storeScope },
          batchId: { not: null }
        },
        select: { batchId: true },
        distinct: ["batchId"]
      });

      const batchIds = activeBatchesInScope.map(b => b.batchId as string);
      expiringBatches = await db.batch.count({
        where: {
          id: { in: batchIds },
          companyId,
          expiryDate: {
            gt: new Date(),
            lte: expiryThreshold
          }
        }
      });
    } else {
      expiringBatches = await db.batch.count({
        where: {
          companyId,
          expiryDate: {
            gt: new Date(),
            lte: expiryThreshold
          }
        }
      });
    }

    if (expiringBatches > 0) {
      reminders.push({
        category: "EXPIRING_BATCHES",
        label: `${expiringBatches} Batches Expiring in ${config.expiryLeadDays} Days`,
        count: expiringBatches,
        severity: "red",
        deepLink: "/stores/reports?type=expiring"
      });
    }
  }

  // 5. Overdue Gate Passes
  if (isStore && !dismissedCategories.has("OVERDUE_GATEPASS")) {
    const overdueGatepasses = await db.gatePass.count({
      where: {
        companyId,
        type: "RETURNABLE",
        status: { in: ["OPEN", "PARTIALLY_RETURNED"] },
        dueBack: { lt: new Date() }
      }
    });
    if (overdueGatepasses > 0) {
      reminders.push({
        category: "OVERDUE_GATEPASS",
        label: `${overdueGatepasses} Returnable Gate Passes Overdue`,
        count: overdueGatepasses,
        severity: "red",
        deepLink: "/stores/outwards?status=overdue"
      });
    }
  }

  // --- PURCHASE REMINDERS ---

  // 6. PRs Awaiting Approval (filtered by deptScope of linked indents)
  if (canApprovePr && !dismissedCategories.has("PENDING_PR")) {
    const prWhere: any = { companyId, status: "SUBMITTED" };
    if (deptScope.length > 0) {
      prWhere.lines = {
        some: {
          indentLines: {
            some: {
              indent: {
                deptId: { in: deptScope }
              }
            }
          }
        }
      };
    }

    const pendingPrs = await db.purchaseRequisition.count({
      where: prWhere
    });

    if (pendingPrs > 0) {
      reminders.push({
        category: "PENDING_PR",
        label: `${pendingPrs} PRs Awaiting Approval`,
        count: pendingPrs,
        severity: "saffron",
        deepLink: "/purchase/requisitions?status=SUBMITTED"
      });
    }
  }

  // 7. POs Pending Approval (filtered by approvalLimit & storeScope)
  if (canApprovePo && !dismissedCategories.has("PENDING_PO")) {
    const poWhere: any = { companyId, status: "PENDING_APPROVAL" };

    const pendingPos = await db.purchaseOrder.findMany({
      where: poWhere,
      select: {
        id: true,
        lines: {
          select: {
            qty: true,
            rate: true,
            discount: true,
            gstRate: true
          }
        }
      }
    });

    let matchCount = 0;
    for (const po of pendingPos) {
      const basicTotal = po.lines.reduce((sum, l) => sum + (l.qty * l.rate), 0);
      const discountTotal = po.lines.reduce((sum, l) => sum + l.discount, 0);
      const gstTotal = po.lines.reduce((sum, l) => sum + ((l.qty * l.rate - l.discount) * (l.gstRate / 100)), 0);
      const landedTotal = basicTotal - discountTotal + gstTotal;

      // Filter by approvalLimit ceiling
      if (role === "OWNER" || approvalLimit === null || approvalLimit === undefined || landedTotal <= approvalLimit) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      reminders.push({
        category: "PENDING_PO",
        label: `${matchCount} POs Pending Approval`,
        count: matchCount,
        severity: "saffron",
        deepLink: "/purchase/po?status=PENDING_APPROVAL"
      });
    }
  }

  // 8. PO Delivery Overdue
  if (canApprovePo && !dismissedCategories.has("OVERDUE_PO_DELIVERY")) {
    const overduePoCount = await db.purchaseOrder.count({
      where: {
        companyId,
        status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] },
        deliveryDate: { lt: new Date() }
      }
    });
    if (overduePoCount > 0) {
      reminders.push({
        category: "OVERDUE_PO_DELIVERY",
        label: `${overduePoCount} POs Overdue on Delivery`,
        count: overduePoCount,
        severity: "red",
        deepLink: "/purchase/po?status=overdue"
      });
    }
  }

  // --- ACCOUNTS REMINDERS ---

  // 9. Invoices Failing 3-Way Match
  if (canRecordPayment && !dismissedCategories.has("INVOICE_MISMATCH")) {
    const mismatchedInvoices = await db.supplierInvoice.count({
      where: { companyId, matchStatus: "MISMATCH" }
    });
    if (mismatchedInvoices > 0) {
      reminders.push({
        category: "INVOICE_MISMATCH",
        label: `${mismatchedInvoices} Invoices Failing 3-Way Match`,
        count: mismatchedInvoices,
        severity: "red",
        deepLink: "/purchase/invoices?matchStatus=MISMATCH"
      });
    }
  }

  // 10. Vendor Payments Due/Overdue
  if (canRecordPayment && !dismissedCategories.has("PAYMENTS_DUE")) {
    const dueThreshold = new Date();
    dueThreshold.setDate(dueThreshold.getDate() + config.paymentDueDays);

    const invoices = await db.supplierInvoice.findMany({
      where: {
        companyId,
        dueDate: { lte: dueThreshold },
      },
      select: { id: true, amount: true }
    });

    let paymentsDue = 0;
    for (const inv of invoices) {
      const payments = await db.paymentVoucher.aggregate({
        where: { companyId, invoiceId: inv.id },
        _sum: { amount: true }
      });
      const paidAmt = payments._sum.amount || 0;
      if (paidAmt < inv.amount) {
        paymentsDue++;
      }
    }

    if (paymentsDue > 0) {
      reminders.push({
        category: "PAYMENTS_DUE",
        label: `${paymentsDue} Vendor Payments Due/Overdue`,
        count: paymentsDue,
        severity: "saffron",
        deepLink: "/purchase/payments"
      });
    }
  }

  return reminders;
}
