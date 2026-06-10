import { auth } from "@/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import ReorderBasketList from "./ReorderBasketList";
import { SuggestionStatus, ReorderMethod } from "@prisma/client";

export default async function ReorderPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId;

  // 1. Fetch policy (or create default)
  let policy = await db.reorderPolicy.findUnique({
    where: { companyId }
  });
  if (!policy) {
    policy = await db.reorderPolicy.create({
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

  // 2. Fetch active suggestions
  const rawSuggestions = await db.reorderSuggestion.findMany({
    where: {
      companyId,
      status: {
        in: [SuggestionStatus.PENDING, SuggestionStatus.REVIEWED, SuggestionStatus.APPROVED]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  // 3. Fetch items, stores, and vendors for mapping/review
  const items = await db.item.findMany({
    where: { companyId, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, code: true, abcClass: true }
  });

  const stores = await db.store.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true, name: true }
  });

  const vendors = await db.vendor.findMany({
    where: { companyId, status: "APPROVED", deletedAt: null },
    select: { id: true, name: true }
  });

  // 4. Map suggestion details in memory
  const mappedSuggestions = rawSuggestions.map(s => {
    const item = items.find(i => i.id === s.itemId);
    const store = stores.find(st => st.id === s.storeId);
    const vendor = vendors.find(v => v.id === s.preferredVendorId);

    return {
      id: s.id,
      itemId: s.itemId,
      storeId: s.storeId,
      itemName: item ? item.name : "Unknown Item",
      itemCode: item ? item.code : "N/A",
      storeName: store ? store.name : "Unknown Store",
      onHand: s.onHand,
      onOrder: s.onOrder,
      inPipeline: s.inPipeline,
      netAvailable: s.netAvailable,
      reorderLevel: s.reorderLevel,
      minStock: s.minStock,
      maxStock: s.maxStock,
      suggestedQty: s.suggestedQty,
      approvedQty: s.approvedQty,
      reason: s.reason,
      priority: s.priority,
      preferredVendorId: s.preferredVendorId,
      preferredVendorName: vendor ? vendor.name : null,
      lastPurchasePrice: s.lastPurchasePrice,
      leadTimeDays: s.leadTimeDays,
      estValue: s.estValue,
      status: s.status,
      abcClass: item ? item.abcClass : "NONE"
    };
  });

  const serializablePolicy = {
    id: policy.id,
    enabled: policy.enabled,
    scanCron: policy.scanCron,
    method: policy.method,
    lotRounding: policy.lotRounding,
    autoApproveBelowValue: policy.autoApproveBelowValue,
    secondApprovalAboveValue: policy.secondApprovalAboveValue,
    criticalClasses: policy.criticalClasses
  };

  return (
    <ReorderBasketList
      suggestions={mappedSuggestions}
      policy={serializablePolicy}
      vendors={vendors}
      stores={stores}
    />
  );
}
