"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { getItemStock } from "@/lib/stock";
import { revalidatePath } from "next/cache";
import { 
  IndentStatus, 
  IndentSource, 
  ReorderReason, 
  ReorderRunTrigger, 
  SuggestionStatus, 
  ReorderMethod, 
  PrStatus, 
  RfqStatus, 
  PoStatus 
} from "@prisma/client";

async function logAudit(
  tx: any,
  companyId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any
) {
  await tx.auditLog.create({
    data: {
      companyId,
      actorId,
      action,
      entity,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    },
  });
}

function ceilToLot(qty: number, lotRounding: number) {
  if (lotRounding <= 0) return qty;
  return Math.ceil(qty / lotRounding) * lotRounding;
}

/**
 * Gets or creates the default reorder policy for the company.
 */
async function getOrCreatePolicy(tx: any, companyId: string) {
  let policy = await tx.reorderPolicy.findUnique({
    where: { companyId }
  });
  if (!policy) {
    policy = await tx.reorderPolicy.create({
      data: {
        companyId,
        enabled: true,
        scanCron: "0 * * * *",
        method: ReorderMethod.REORDER_TO_MAX,
        lotRounding: 1,
        criticalClasses: ["A"]
      }
    });
  }
  return policy;
}

/**
 * Runs a scan for active items and stores, calculates shortages,
 * and creates or updates suggestions in the Reorder Basket.
 */
export async function runReplenishmentScan(storeId?: string | null) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const result = await db.$transaction(async (tx) => {
      const policy = await getOrCreatePolicy(tx, companyId);
      if (!policy.enabled) {
        throw new Error("Reorder policy is currently disabled");
      }

      // Fetch active items
      const items = await tx.item.findMany({
        where: { companyId, status: "ACTIVE", deletedAt: null }
      });

      // Fetch active stores
      const stores = await tx.store.findMany({
        where: { companyId, status: "ACTIVE" }
      });

      // Filter stores if storeId is provided
      const targetStores = storeId ? stores.filter(s => s.id === storeId) : stores;

      let scannedCount = 0;
      let suggestedCount = 0;

      // Create a replenishment run record
      const run = await tx.replenishmentRun.create({
        data: {
          companyId,
          storeId: storeId || null,
          trigger: ReorderRunTrigger.MANUAL,
        }
      });

      // --- BULK FETCH stock levels and open orders/pipelines to resolve N+1 ---
      
      // 1. Stock ledger quantities grouped by itemId and storeId
      const stockLedgerSums = await tx.stockLedger.groupBy({
        by: ["itemId", "storeId"],
        where: { companyId },
        _sum: {
          qty: true,
        },
      });
      const stockMap = new Map<string, number>();
      for (const sum of stockLedgerSums) {
        stockMap.set(`${sum.itemId}_${sum.storeId}`, sum._sum.qty || 0);
      }

      // 2. Open PO quantities not yet received
      const openPoLines = await tx.poLine.findMany({
        where: {
          po: {
            companyId,
            status: {
              in: [PoStatus.APPROVED, PoStatus.SENT, PoStatus.PARTIALLY_RECEIVED]
            }
          }
        }
      });
      const poMap = new Map<string, number>();
      for (const line of openPoLines) {
        const current = poMap.get(line.itemId) || 0;
        poMap.set(line.itemId, current + Math.max(0, line.qty - line.receivedQty));
      }

      // 3. Approved Indents (not yet in PR)
      const openIndentLines = await tx.indentLine.findMany({
        where: {
          prLineId: null,
          indent: {
            companyId,
            status: { in: [IndentStatus.APPROVED, IndentStatus.PARTIALLY_ISSUED] }
          }
        }
      });
      const indentMap = new Map<string, number>();
      for (const line of openIndentLines) {
        const current = indentMap.get(line.itemId) || 0;
        indentMap.set(line.itemId, current + Math.max(0, line.qty - line.issuedQty));
      }

      // 4. Approved PRs (not yet in RFQ or PO)
      const openPrLines = await tx.prLine.findMany({
        where: {
          poRaised: false,
          rfqLines: { none: {} },
          pr: {
            companyId,
            status: { in: [PrStatus.APPROVED, PrStatus.SUBMITTED] }
          }
        }
      });
      const prMap = new Map<string, number>();
      for (const line of openPrLines) {
        const current = prMap.get(line.itemId) || 0;
        prMap.set(line.itemId, current + line.qty);
      }

      // 5. Open RFQs (not yet in PO)
      const openRfqLines = await tx.rfqLine.findMany({
        where: {
          rfq: {
            companyId,
            status: { in: [RfqStatus.DRAFT, RfqStatus.ISSUED, RfqStatus.QUOTES_RECEIVED, RfqStatus.AWARDED] }
          }
        },
        include: { prLine: true }
      });
      const rfqMap = new Map<string, number>();
      for (const line of openRfqLines) {
        if (!line.prLine || !line.prLine.poRaised) {
          const current = rfqMap.get(line.itemId) || 0;
          rfqMap.set(line.itemId, current + line.qty);
        }
      }

      // 6. Latest approved/closed PO rates for mapping last purchase price
      const latestPoLines = await tx.poLine.findMany({
        where: {
          po: {
            companyId,
            status: { in: [PoStatus.APPROVED, PoStatus.SENT, PoStatus.CLOSED] }
          }
        },
        select: {
          itemId: true,
          rate: true,
          po: {
            select: {
              orderDate: true
            }
          }
        }
      });
      const lastPriceMap = new Map<string, { rate: number; orderDate: Date }>();
      for (const line of latestPoLines) {
        const orderDate = line.po.orderDate;
        const existing = lastPriceMap.get(line.itemId);
        if (!existing || orderDate > existing.orderDate) {
          lastPriceMap.set(line.itemId, { rate: line.rate, orderDate });
        }
      }

      // 7. Existing open suggestions (PENDING or REVIEWED)
      const existingSuggestions = await tx.reorderSuggestion.findMany({
        where: {
          companyId,
          status: { in: [SuggestionStatus.PENDING, SuggestionStatus.REVIEWED] }
        }
      });
      const existingSuggestionMap = new Map<string, any>();
      for (const s of existingSuggestions) {
        existingSuggestionMap.set(`${s.itemId}_${s.storeId}`, s);
      }

      // --- END OF BULK FETCH ---

      for (const store of targetStores) {
        for (const item of items) {
          // Only scan if configured with reorder level
          if (item.reorderLevel <= 0) continue;

          scannedCount++;

          // 1. Calculate onHand
          const onHand = stockMap.get(`${item.id}_${store.id}`) || 0;

          // 2. Calculate onOrder
          const onOrder = poMap.get(item.id) || 0;

          // 3. Calculate inPipeline
          const indentPipeline = indentMap.get(item.id) || 0;
          const prPipeline = prMap.get(item.id) || 0;
          const rfqPipeline = rfqMap.get(item.id) || 0;
          const inPipeline = indentPipeline + prPipeline + rfqPipeline;
          
          const netAvailable = onHand + onOrder + inPipeline; // reserved is 0 (not tracked)

          if (netAvailable <= item.reorderLevel) {
            const reason = netAvailable <= item.minStock ? ReorderReason.BELOW_MIN : ReorderReason.BELOW_REORDER;
            const priority = reason === ReorderReason.BELOW_MIN ? "URGENT" : "NORMAL";

            // Calculate target qty based on policy method
            let target = item.maxStock;
            if (policy.method === ReorderMethod.REORDER_TO_MAX) {
              target = Math.max(item.maxStock, item.reorderLevel);
            } else if (policy.method === ReorderMethod.FIXED_QTY) {
              target = item.reorderLevel + 10; // fixed lot fallback
            }

            const rawSuggested = target - netAvailable;
            const suggestedQty = ceilToLot(rawSuggested, policy.lotRounding);

            if (suggestedQty > 0) {
              suggestedCount++;

              // Fetch last purchase price from map
              const latestPoLine = lastPriceMap.get(item.id);
              const lastPurchasePrice = latestPoLine ? latestPoLine.rate : null;
              const estValue = lastPurchasePrice ? suggestedQty * lastPurchasePrice : null;

              // Check if an OPEN suggestion (PENDING or REVIEWED) already exists
              const existingSuggestion = existingSuggestionMap.get(`${item.id}_${store.id}`);

              if (existingSuggestion) {
                // Update existing suggestion
                await tx.reorderSuggestion.update({
                  where: { id: existingSuggestion.id },
                  data: {
                    runId: run.id,
                    onHand,
                    onOrder,
                    inPipeline,
                    netAvailable,
                    reorderLevel: item.reorderLevel,
                    minStock: item.minStock,
                    maxStock: item.maxStock,
                    suggestedQty,
                    approvedQty: existingSuggestion.status === SuggestionStatus.REVIEWED ? existingSuggestion.approvedQty : suggestedQty,
                    reason,
                    priority,
                    lastPurchasePrice,
                    leadTimeDays: item.leadTimeDays,
                    estValue
                  }
                });
              } else {
                // Create new suggestion
                const newSuggestion = await tx.reorderSuggestion.create({
                  data: {
                    companyId,
                    runId: run.id,
                    itemId: item.id,
                    storeId: store.id,
                    onHand,
                    onOrder,
                    inPipeline,
                    netAvailable,
                    reorderLevel: item.reorderLevel,
                    minStock: item.minStock,
                    maxStock: item.maxStock,
                    suggestedQty,
                    approvedQty: suggestedQty,
                    reason,
                    priority,
                    lastPurchasePrice,
                    leadTimeDays: item.leadTimeDays,
                    estValue,
                    status: SuggestionStatus.PENDING
                  }
                });

                // Auto-approve policy check
                const isCritical = policy.criticalClasses.includes(item.abcClass) || reason === ReorderReason.BELOW_MIN;
                if (
                  policy.autoApproveBelowValue !== null &&
                  estValue !== null &&
                  estValue < policy.autoApproveBelowValue &&
                  !isCritical
                ) {
                  await tx.reorderSuggestion.update({
                    where: { id: newSuggestion.id },
                    data: {
                      status: SuggestionStatus.APPROVED,
                      approvedById: "SYSTEM",
                      approvedQty: suggestedQty
                    }
                  });
                  await logAudit(tx, companyId, "SYSTEM", "AUTO_APPROVE_SUGGESTION", "ReorderSuggestion", newSuggestion.id, null, newSuggestion);
                }
              }
            }
          } else {
            // If stock recovered or covered, mark any existing open suggestion as SUPERSEDED
            const existingSuggestion = existingSuggestionMap.get(`${item.id}_${store.id}`);
            if (existingSuggestion) {
              await tx.reorderSuggestion.update({
                where: { id: existingSuggestion.id },
                data: { status: SuggestionStatus.SUPERSEDED }
              });
            }
          }
        }
      }

      // Update run counts
      await tx.replenishmentRun.update({
        where: { id: run.id },
        data: { scannedCount, suggestedCount }
      });

      await logAudit(tx, companyId, actorId, "RUN_REPLENISHMENT_SCAN", "ReplenishmentRun", run.id, null, run);
      return { success: true, runId: run.id, scannedCount, suggestedCount };
    }, {
      maxWait: 15000,
      timeout: 60000,
    });


    revalidatePath("/stores/reorders");
    return { success: true, scannedCount: result.scannedCount, suggestedCount: result.suggestedCount };
  } catch (err: any) {
    console.error("Error running replenishment scan:", err);
    return { success: false, error: err.message || "Failed to run scan" };
  }
}

/**
 * Reviews and updates a suggestion's quantity, priority, and vendor.
 */
export async function reviewSuggestion(
  id: string,
  data: {
    approvedQty?: number;
    priority?: string;
    preferredVendorId?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.reorderSuggestion.findFirst({
      where: { id, companyId }
    });
    if (!original) return { success: false, error: "Suggestion not found" };
    if (original.status !== SuggestionStatus.PENDING && original.status !== SuggestionStatus.REVIEWED) {
      return { success: false, error: "Only open suggestions can be reviewed" };
    }

    const updated = await db.$transaction(async (tx) => {
      const up = await tx.reorderSuggestion.update({
        where: { id },
        data: {
          approvedQty: data.approvedQty !== undefined ? data.approvedQty : original.approvedQty,
          priority: data.priority !== undefined ? data.priority : original.priority,
          preferredVendorId: data.preferredVendorId !== undefined ? data.preferredVendorId : original.preferredVendorId,
          status: SuggestionStatus.REVIEWED,
          reviewedById: actorId
        }
      });
      await logAudit(tx, companyId, actorId, "REVIEW_SUGGESTION", "ReorderSuggestion", id, original, up);
      return up;
    });

    revalidatePath("/stores/reorders");
    return { success: true, suggestion: updated };
  } catch (err: any) {
    console.error("Error reviewing suggestion:", err);
    return { success: false, error: err.message || "Failed to review suggestion" };
  }
}

/**
 * Rejects a suggestion with a reason.
 */
export async function rejectSuggestion(id: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.reorderSuggestion.findFirst({
      where: { id, companyId }
    });
    if (!original) return { success: false, error: "Suggestion not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.reorderSuggestion.update({
        where: { id },
        data: {
          status: SuggestionStatus.REJECTED,
          approvedById: actorId
        }
      });
      await logAudit(tx, companyId, actorId, "REJECT_SUGGESTION", "ReorderSuggestion", id, original, { ...updated, reason });
      return updated;
    });

    revalidatePath("/stores/reorders");
    return { success: true, suggestion: result };
  } catch (err: any) {
    console.error("Error rejecting suggestion:", err);
    return { success: false, error: err.message || "Failed to reject suggestion" };
  }
}

/**
 * Approves and converts suggestions into a set of store-grouped Indents.
 */
export async function approveAndConvertSuggestions(suggestionIds: string[], clubAll: boolean = false) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const suggestions = await db.reorderSuggestion.findMany({
      where: { id: { in: suggestionIds }, companyId },
      include: { run: true }
    });

    if (suggestions.length === 0) {
      return { success: false, error: "No suggestions selected" };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Check idempotency
      const sortedIds = [...suggestionIds].sort().join(",");
      const idempotencyKey = `reorder-to-indent-${sortedIds}`;
      const existingConv = await tx.flowConversion.findFirst({
        where: { companyId, idempotencyKey }
      });
      if (existingConv) {
        return { success: true, alreadyRun: true };
      }

      // Group suggestions
      const storeGroups: { [storeId: string]: typeof suggestions } = {};
      if (clubAll) {
        storeGroups["ALL"] = [];
      }

      // Pre-fetch stock levels and open POs in bulk for the scope of the suggestions to avoid N+1 queries
      const itemIds = Array.from(new Set(suggestions.map(s => s.itemId)));
      const storeIds = Array.from(new Set(suggestions.map(s => s.storeId)));

      const stockLedgerSums = await tx.stockLedger.groupBy({
        by: ["itemId", "storeId"],
        where: {
          companyId,
          itemId: { in: itemIds },
          storeId: { in: storeIds }
        },
        _sum: {
          qty: true
        }
      });
      const stockMap = new Map<string, number>();
      for (const sum of stockLedgerSums) {
        stockMap.set(`${sum.itemId}_${sum.storeId}`, sum._sum.qty || 0);
      }

      const openPoLines = await tx.poLine.findMany({
        where: {
          itemId: { in: itemIds },
          po: {
            companyId,
            status: { in: [PoStatus.APPROVED, PoStatus.SENT, PoStatus.PARTIALLY_RECEIVED] }
          }
        }
      });
      const poMap = new Map<string, number>();
      for (const line of openPoLines) {
        const current = poMap.get(line.itemId) || 0;
        poMap.set(line.itemId, current + Math.max(0, line.qty - line.receivedQty));
      }

      for (const s of suggestions) {
        // Re-check coverage safeguard: if item netAvailable is now above reorder point due to other receipt, mark SUPERSEDED
        const onHand = stockMap.get(`${s.itemId}_${s.storeId}`) || 0;
        const onOrder = poMap.get(s.itemId) || 0;
        const netAvailable = onHand + onOrder; // simplified check
        
        if (netAvailable > s.reorderLevel) {
          await tx.reorderSuggestion.update({
            where: { id: s.id },
            data: { status: SuggestionStatus.SUPERSEDED }
          });
          continue;
        }

        if (clubAll) {
          storeGroups["ALL"].push(s);
        } else {
          if (!storeGroups[s.storeId]) {
            storeGroups[s.storeId] = [];
          }
          storeGroups[s.storeId].push(s);
        }
      }

      const indentIds: string[] = [];

      // Create an Indent per store group
      for (const [storeId, storeSuggestions] of Object.entries(storeGroups)) {
        if (storeSuggestions.length === 0) continue;

        const indentNumber = await getNextSequence(companyId, "IND");
        const maxPriority = storeSuggestions.some(s => s.priority === "URGENT") ? "URGENT" : "NORMAL";

        // Create the Indent with status APPROVED directly since it went through suggestions approval
        const indent = await tx.indent.create({
          data: {
            companyId,
            number: indentNumber,
            priority: maxPriority,
            purpose: clubAll ? "Auto-replenishment scan (Clubbed)" : "Auto-replenishment scan",
            status: IndentStatus.APPROVED,
            source: IndentSource.AUTO_REORDER,
            requestedById: actorId,
            approvedById: actorId,
            approvedAt: new Date(),
            lines: {
              create: storeSuggestions.map(s => {
                const finalQty = s.approvedQty || s.suggestedQty;
                return {
                  itemId: s.itemId,
                  qty: finalQty,
                  purchaseQty: finalQty,
                  requiredBy: new Date(Date.now() + s.leadTimeDays * 24 * 60 * 60 * 1000),
                  reorderSuggestionId: s.id
                };
              })
            }
          },
          include: { lines: true }
        });

        indentIds.push(indent.id);

        // Update suggestions status to CONVERTED and link them to indent
        for (const s of storeSuggestions) {
          const line = indent.lines.find(l => l.reorderSuggestionId === s.id);
          await tx.reorderSuggestion.update({
            where: { id: s.id },
            data: {
              status: SuggestionStatus.CONVERTED,
              approvedById: actorId,
              indentId: indent.id,
              indentLineId: line?.id || null
            }
          });
        }

        await logAudit(tx, companyId, actorId, "CREATE_AUTO_INDENT", "Indent", indent.id, null, indent);
      }

      // Save conversion
      await tx.flowConversion.create({
        data: {
          companyId,
          step: "REORDER_TO_INDENT",
          sourceId: indentIds.join(","),
          idempotencyKey
        }
      });

      return { success: true, indentIds };
    }, {
      maxWait: 15000,
      timeout: 45000,
    });

    revalidatePath("/stores/reorders");
    revalidatePath("/stores/indents");
    return { success: true };
  } catch (err: any) {
    console.error("Error approving and converting suggestions:", err);
    return { success: false, error: err.message || "Failed to convert suggestions" };
  }
}

/**
 * Fetches the current reorder policy.
 */
export async function getReorderPolicy() {
  const session = await auth();
  if (!session || !session.user) return null;
  const companyId = (session.user as any).companyId;

  return await db.reorderPolicy.findUnique({
    where: { companyId }
  });
}

/**
 * Updates the reorder policy parameters.
 */
export async function updateReorderPolicy(data: {
  enabled?: boolean;
  scanCron?: string;
  method?: ReorderMethod;
  lotRounding?: number;
  autoApproveBelowValue?: number | null;
  secondApprovalAboveValue?: number | null;
  criticalClasses?: string[];
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await getOrCreatePolicy(db, companyId);

    const updated = await db.reorderPolicy.update({
      where: { companyId },
      data: {
        enabled: data.enabled !== undefined ? data.enabled : original.enabled,
        scanCron: data.scanCron !== undefined ? data.scanCron : original.scanCron,
        method: data.method !== undefined ? data.method : original.method,
        lotRounding: data.lotRounding !== undefined ? data.lotRounding : original.lotRounding,
        autoApproveBelowValue: data.autoApproveBelowValue !== undefined ? data.autoApproveBelowValue : original.autoApproveBelowValue,
        secondApprovalAboveValue: data.secondApprovalAboveValue !== undefined ? data.secondApprovalAboveValue : original.secondApprovalAboveValue,
        criticalClasses: data.criticalClasses !== undefined ? data.criticalClasses : original.criticalClasses,
      }
    });

    await db.$transaction(async (tx) => {
      await logAudit(tx, companyId, actorId, "UPDATE_REORDER_POLICY", "ReorderPolicy", updated.id, original, updated);
    });

    return { success: true, policy: updated };
  } catch (err: any) {
    console.error("Error updating reorder policy:", err);
    return { success: false, error: err.message || "Failed to update reorder policy" };
  }
}
