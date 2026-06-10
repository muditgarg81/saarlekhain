import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import GrnList from "./GrnList";

export default async function GrnPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // Fetch GRNs, POs, Items, Stores, and Vendors concurrently
  const [grns, purchaseOrders, items, stores, vendors] = await Promise.all([
    db.grn.findMany({
      where: { companyId, deletedAt: null },
      include: { lines: true },
      orderBy: { createdAt: "desc" }
    }),
    db.purchaseOrder.findMany({
      where: { 
        companyId, 
        status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } 
      },
      include: { 
        lines: true,
        vendor: true
      },
      orderBy: { number: "asc" }
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" }
    }),
    db.store.findMany({
      where: { companyId, status: "ACTIVE" },
      include: { bins: true },
      orderBy: { code: "asc" }
    }),
    db.vendor.findMany({
      where: { companyId, status: "APPROVED", deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" }
    })
  ]);

  // Map user names for requester lookup
  const userList = await db.user.findMany({
    where: { companyId },
    select: { id: true, name: true, email: true }
  });

  const userMap = new Map(userList.map(u => [u.id, u.name || u.email]));

  // Fetch all batches to retrieve lot numbers and expiry dates for editing
  const batches = await db.batch.findMany({
    where: { companyId }
  });

  // Map database instances to clean serializable props for the client
  const mappedGrns = grns.map(g => {
    const po = purchaseOrders.find(p => p.id === g.poId);
    const vendor = vendors.find(v => v.id === g.vendorId) || po?.vendor;
    const store = stores.find(s => s.id === g.storeId);
    
    return {
      id: g.id,
      number: g.number,
      source: g.source,
      vendorId: g.vendorId,
      poId: g.poId,
      storeId: g.storeId,
      vendorName: vendor?.name || "Free/Trial Sample",
      poNumber: po?.number || null,
      storeName: store?.name || "Unknown Store",
      dcNo: g.dcNo,
      dcDate: g.dcDate ? g.dcDate.toISOString().split("T")[0] : null,
      invoiceNo: g.invoiceNo,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      lines: g.lines.map(line => {
        const item = items.find(i => i.id === line.itemId);
        const bin = store?.bins.find(b => b.id === line.binId);
        const batch = batches.find(b => b.id === line.batchId);
        
        return {
          id: line.id,
          itemId: line.itemId,
          itemCode: item?.code || "N/A",
          itemName: item?.name || "Unknown",
          receivedQty: line.receivedQty,
          acceptedQty: line.acceptedQty,
          rejectedQty: line.rejectedQty,
          binCode: bin?.code || null,
          binId: line.binId,
          poLineId: line.poLineId,
          batchId: line.batchId,
          lotNo: batch?.lotNo || null,
          batchMfgDate: batch?.mfgDate ? batch.mfgDate.toISOString().split("T")[0] : null,
          batchExpiryDate: batch?.expiryDate ? batch.expiryDate.toISOString().split("T")[0] : null,
        };
      })
    };
  });

  const mappedPos = purchaseOrders.map(po => ({
    id: po.id,
    poNumber: po.number,
    vendorId: po.vendorId,
    vendorName: po.vendor.name,
    lines: po.lines.map(l => {
      const item = items.find(i => i.id === l.itemId);
      return {
        id: l.id,
        itemId: l.itemId,
        itemCode: item?.code || "N/A",
        itemName: item?.name || "Unknown Item",
        qty: l.qty,
        receivedQty: l.receivedQty,
        rate: l.rate
      };
    })
  }));

  const cleanStores = stores.map(s => ({
    id: s.id,
    name: s.name,
    code: s.code,
    bins: s.bins.map(b => ({ id: b.id, code: b.code }))
  }));

  return (
    <GrnList
      initialGrns={mappedGrns}
      purchaseOrders={mappedPos}
      items={items}
      stores={cleanStores}
      vendors={vendors}
    />
  );
}
