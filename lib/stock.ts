import { db } from "./db";
import { LedgerTxnType } from "@prisma/client";

export interface StockInfo {
  itemId: string;
  qty: number;
  valuationRate: number;
  totalValue: number;
}

/**
 * Calculates current stock quantity for an item (optionally scoped to a specific store).
 */
export async function getItemStock(
  companyId: string,
  itemId: string,
  storeId?: string
): Promise<number> {
  const where: any = { companyId, itemId };
  if (storeId) {
    where.storeId = storeId;
  }

  const result = await db.stockLedger.aggregate({
    where,
    _sum: {
      qty: true,
    },
  });

  return result._sum.qty || 0;
}

/**
 * Computes the running weighted-average unit cost and final stock valuation for an item.
 * Evaluates entries chronologically to ensure accurate valuation after issues and receipts.
 */
export async function getItemValuation(
  companyId: string,
  itemId: string
): Promise<StockInfo> {
  const ledger = await db.stockLedger.findMany({
    where: { companyId, itemId },
    orderBy: { createdAt: "asc" },
  });

  let balanceQty = 0;
  let balanceValue = 0;
  let currentAvgRate = 0;

  for (const entry of ledger) {
    const qty = entry.qty; // Signed
    const entryRate = entry.rate || currentAvgRate;

    if (qty > 0) {
      // Stock receipt / addition: update balance and recalculate weighted average rate
      const addedValue = qty * entryRate;
      balanceQty += qty;
      balanceValue += addedValue;
      if (balanceQty > 0) {
        currentAvgRate = balanceValue / balanceQty;
      }
    } else if (qty < 0) {
      // Stock issue / reduction: consumes stock at the current average rate
      balanceQty += qty; // qty is negative
      if (balanceQty < 0) {
        // Handle negative stock scenario gracefully
        balanceQty = 0;
        balanceValue = 0;
      } else {
        balanceValue = balanceQty * currentAvgRate;
      }
    }
  }

  return {
    itemId,
    qty: balanceQty,
    valuationRate: currentAvgRate,
    totalValue: balanceValue,
  };
}

/**
 * Logs an inventory movement to the append-only stock ledger.
 * Must be executed within a Prisma transaction context to ensure integrity.
 */
export async function postLedgerEntry(
  tx: any, // Prisma transaction delegate
  data: {
    companyId: string;
    itemId: string;
    storeId: string;
    binId?: string | null;
    batchId?: string | null;
    txnType: LedgerTxnType;
    qty: number; // Signed (positive for receipt, negative for issue)
    rate?: number | null; // Rate is required for receipts/additions for valuation
    refType: string;
    refId: string;
    createdById: string;
  }
) {
  // If rate is not specified for a stock addition, fetch current average rate
  let finalRate = data.rate;
  if (!finalRate && data.qty > 0) {
    const valuation = await getItemValuation(data.companyId, data.itemId);
    finalRate = valuation.valuationRate;
  } else if (!finalRate && data.qty < 0) {
    // For stock issue, rate is always the current average valuation rate
    const valuation = await getItemValuation(data.companyId, data.itemId);
    finalRate = valuation.valuationRate;
  }

  return await tx.stockLedger.create({
    data: {
      companyId: data.companyId,
      itemId: data.itemId,
      storeId: data.storeId,
      binId: data.binId || null,
      batchId: data.batchId || null,
      txnType: data.txnType,
      qty: data.qty,
      rate: finalRate || 0,
      refType: data.refType,
      refId: data.refId,
      createdById: data.createdById,
    },
  });
}
