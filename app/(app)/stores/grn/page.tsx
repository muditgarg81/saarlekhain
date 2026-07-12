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
  const grns = await db.grn.findMany({
    where: { companyId, deletedAt: null },
    include: { lines: true },
    orderBy: { createdAt: "desc" }
  });

  const poIdsFromGrns = grns.map(g => g.poId).filter(Boolean) as string[];

  // Fetch POs, Items, Stores, and Vendors concurrently
  const [purchaseOrders, items, stores, vendors] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { 
        companyId, 
        OR: [
          { status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] } },
          { id: { in: poIdsFromGrns } }
        ]
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

  // Document tracing queries to resolve audit trail of indent, pr, rfq numbers from POs
  const allRfqLineIds = Array.from(
    new Set(purchaseOrders.flatMap((po) => po.lines.map((l) => l.rfqLineId).filter(Boolean)))
  ) as string[];
  const allPrLineIds = Array.from(
    new Set(purchaseOrders.flatMap((po) => po.lines.map((l) => l.prLineId).filter(Boolean)))
  ) as string[];
  const allPoPrIds = Array.from(
    new Set(purchaseOrders.map((po) => po.prId).filter(Boolean))
  ) as string[];

  const [rfqLines, prLines] = await Promise.all([
    db.rfqLine.findMany({
      where: { id: { in: allRfqLineIds } },
      include: { rfq: true },
    }),
    db.prLine.findMany({
      where: { id: { in: allPrLineIds } },
      include: {
        pr: true,
        indentLines: {
          include: {
            indent: true,
          },
        },
      },
    }),
  ]);

  const rfqIdsToFetch = new Set<string>();
  allPoPrIds.forEach((id) => rfqIdsToFetch.add(id));
  rfqLines.forEach((rl) => {
    if (rl.rfqId) rfqIdsToFetch.add(rl.rfqId);
  });

  const prIdsToFetch = new Set<string>();
  allPoPrIds.forEach((id) => prIdsToFetch.add(id));
  rfqLines.forEach((rl) => {
    if (rl.rfq?.prId) prIdsToFetch.add(rl.rfq.prId);
  });
  prLines.forEach((pl) => {
    if (pl.prId) prIdsToFetch.add(pl.prId);
  });

  const [rfqs, prs] = await Promise.all([
    db.rfq.findMany({
      where: {
        OR: [
          { id: { in: Array.from(rfqIdsToFetch) } },
          { prId: { in: Array.from(prIdsToFetch) } }
        ]
      }
    }),
    db.purchaseRequisition.findMany({
      where: { id: { in: Array.from(prIdsToFetch) } },
      include: {
        lines: {
          include: {
            indentLines: {
              include: {
                indent: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const directIndentIdsSet = new Set<string>();
  prs.forEach((pr) => {
    if (pr.indentId) directIndentIdsSet.add(pr.indentId);
  });
  prLines.forEach((pl) => {
    if (pl.pr?.indentId) directIndentIdsSet.add(pl.pr.indentId);
  });

  const directIndents = await db.indent.findMany({
    where: { id: { in: Array.from(directIndentIdsSet) } },
    select: { id: true, number: true }
  });

  const rfqLineIdToNumberMap = new Map<string, string>();
  rfqLines.forEach((rl) => {
    if (rl.rfq) rfqLineIdToNumberMap.set(rl.id, rl.rfq.number);
  });

  const prLineIdToNumberMap = new Map<string, string>();
  const prLineIdToIndentNumbersMap = new Map<string, string[]>();
  prLines.forEach((pl) => {
    if (pl.pr) prLineIdToNumberMap.set(pl.id, pl.pr.number);
    const indentNums = pl.indentLines.map((il) => il.indent?.number).filter(Boolean) as string[];
    if (pl.pr?.indentId) {
      const directInd = directIndents.find((ind) => ind.id === pl.pr.indentId);
      if (directInd) {
        indentNums.push(directInd.number);
      }
    }
    if (indentNums.length > 0) {
      prLineIdToIndentNumbersMap.set(pl.id, Array.from(new Set(indentNums)));
    }
  });

  const prIdToPrNumberMap = new Map<string, string>();
  const prIdToIndentNumbersMap = new Map<string, string[]>();
  prs.forEach((pr) => {
    prIdToPrNumberMap.set(pr.id, pr.number);
    const indentNums = pr.lines.flatMap((l) => l.indentLines.map((il) => il.indent?.number)).filter(Boolean) as string[];
    if (pr.indentId) {
      const directInd = directIndents.find((ind) => ind.id === pr.indentId);
      if (directInd) {
        indentNums.push(directInd.number);
      }
    }
    if (indentNums.length > 0) {
      prIdToIndentNumbersMap.set(pr.id, Array.from(new Set(indentNums)));
    }
  });

  const rfqIdToRfqNumberMap = new Map<string, string>();
  rfqs.forEach((rfq) => {
    rfqIdToRfqNumberMap.set(rfq.id, rfq.number);
  });

  // Fetch all batches to retrieve lot numbers and expiry dates for editing
  const batches = await db.batch.findMany({
    where: { companyId }
  });

  // Map database instances to clean serializable props for the client
  const mappedGrns = grns.map(g => {
    const po = purchaseOrders.find(p => p.id === g.poId);
    const vendor = vendors.find(v => v.id === g.vendorId) || po?.vendor;
    const store = stores.find(s => s.id === g.storeId);
    
    const rfqNumbersSet = new Set<string>();
    const prNumbersSet = new Set<string>();
    const indentNumbersSet = new Set<string>();

    if (po) {
      po.lines.forEach((line) => {
        // Trace RFQ line
        if (line.rfqLineId) {
          const rfqNum = rfqLineIdToNumberMap.get(line.rfqLineId);
          if (rfqNum) rfqNumbersSet.add(rfqNum);

          const rfqLine = rfqLines.find((rl) => rl.id === line.rfqLineId);
          if (rfqLine?.rfq?.prId) {
            const prNum = prIdToPrNumberMap.get(rfqLine.rfq.prId);
            if (prNum) prNumbersSet.add(prNum);

            const indNums = prIdToIndentNumbersMap.get(rfqLine.rfq.prId);
            if (indNums) {
              indNums.forEach((num) => indentNumbersSet.add(num));
            }
          }
        }

        // Trace PR line
        if (line.prLineId) {
          const prNum = prLineIdToNumberMap.get(line.prLineId);
          if (prNum) prNumbersSet.add(prNum);

          const indNums = prLineIdToIndentNumbersMap.get(line.prLineId);
          if (indNums) {
            indNums.forEach((num) => indentNumbersSet.add(num));
          }
        }
      });

      // Trace PO Header level prId references
      if (po.prId) {
        // Is it a PR?
        const prNum = prIdToPrNumberMap.get(po.prId);
        if (prNum) {
          prNumbersSet.add(prNum);
          const indNums = prIdToIndentNumbersMap.get(po.prId);
          if (indNums) {
            indNums.forEach((num) => indentNumbersSet.add(num));
          }

          // Trace any RFQs linked to this PR
          const linkedRfqs = rfqs.filter((r) => r.prId === po.prId);
          linkedRfqs.forEach((rfq) => {
            rfqNumbersSet.add(rfq.number);
          });
        }

        // Is it an RFQ?
        const rfqNum = rfqIdToRfqNumberMap.get(po.prId);
        if (rfqNum) {
          rfqNumbersSet.add(rfqNum);

          const rfq = rfqs.find((r) => r.id === po.prId);
          if (rfq?.prId) {
            const rPrNum = prIdToPrNumberMap.get(rfq.prId);
            if (rPrNum) prNumbersSet.add(rPrNum);

            const rIndNums = prIdToIndentNumbersMap.get(rfq.prId);
            if (rIndNums) {
              rIndNums.forEach((num) => indentNumbersSet.add(num));
            }
          }
        }
      }
    }

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
      rfqNumbers: Array.from(rfqNumbersSet),
      prNumbers: Array.from(prNumbersSet),
      indentNumbers: Array.from(indentNumbersSet),
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
    status: po.status,
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
