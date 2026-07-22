export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import PurchaseOrdersList from "./PurchaseOrdersList";
import { getFreshUser } from "@/app/actions/auth";

export default async function PurchaseOrdersPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const companyId = user.companyId;

  // Fetch POs, Items, Vendors, Users, Ship-To Locations, Terms presets/configs concurrently
  const [
    pos, 
    items, 
    vendors, 
    users, 
    shipToLocations, 
    rawPresets, 
    companyProfile, 
    termsConfig
  ] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        lines: true,
        amendments: {
          orderBy: { version: "desc" },
        },
        vendor: true,
      },
      orderBy: { orderDate: "desc" },
    }),
    db.item.findMany({
      where: { companyId, status: "ACTIVE", deletedAt: null },
      select: { id: true, code: true, name: true, baseUom: true, gstRate: true, make: true, specification: true },
      orderBy: { code: "asc" },
    }),
    db.vendor.findMany({
      where: { companyId, status: "APPROVED", deletedAt: null },
      select: { id: true, name: true, code: true, creditDays: true, paymentTerms: true },
      orderBy: { code: "asc" },
    }),
    db.user.findMany({
      where: { companyId },
      select: { id: true, name: true, email: true },
    }),
    db.shipToLocation.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true, address: true, gstin: true },
      orderBy: { code: "asc" },
    }),
    db.poTermsPreset.findMany({
      where: {
        OR: [
          { companyId: null },
          { companyId }
        ],
        status: "ACTIVE"
      },
      orderBy: { createdAt: "asc" }
    }),
    db.company.findUnique({
      where: { id: companyId },
      select: { 
        name: true, 
        address: true, 
        gstin: true, 
        city: true, 
        governingPlace: true,
        legalName: true,
        displayName: true,
        logoUrl: true,
        registeredAddress: true,
        pan: true,
        cin: true,
        contactEmail: true,
        contactPhone: true
      }
    }),
    db.poTermsConfig.findUnique({
      where: { companyId }
    })
  ]);

  // Get all unique rfqLineIds, prLineIds, and direct po.prIds from all POs to map numbers
  const allRfqLineIds = Array.from(
    new Set(pos.flatMap((po) => po.lines.map((l) => l.rfqLineId).filter(Boolean)))
  ) as string[];
  const allPrLineIds = Array.from(
    new Set(pos.flatMap((po) => po.lines.map((l) => l.prLineId).filter(Boolean)))
  ) as string[];
  const allPoPrIds = Array.from(
    new Set(pos.map((po) => po.prId).filter(Boolean))
  ) as string[];

  // 1. Fetch direct links & references
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

  const [rfqs] = await Promise.all([
    db.rfq.findMany({
      where: {
        OR: [
          { id: { in: Array.from(rfqIdsToFetch) } },
          { prId: { in: Array.from(prIdsToFetch) } }
        ]
      }
    })
  ]);

  rfqs.forEach((rfq) => {
    if (rfq.prId) prIdsToFetch.add(rfq.prId);
  });

  // 2. Fetch all unique PRs with their indents
  const prs = await db.purchaseRequisition.findMany({
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
  });

  // Fetch direct Indents associated with the PR headers
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

  // Merge presets (company overrides override system ones)
  const presetMap = new Map();
  for (const p of rawPresets) {
    if (p.companyId === null) {
      if (!presetMap.has(p.key)) presetMap.set(p.key, p);
    } else {
      presetMap.set(p.key, p);
    }
  }
  const presetsList = Array.from(presetMap.values()).map(p => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    appliesTo: p.appliesTo,
    isDefault: p.isDefault,
    bodyMarkdown: p.bodyMarkdown,
    tokenDefaults: p.tokenDefaults,
    version: p.version
  }));

  // Landed Cost Formula: Rate * (1 - Discount%) * (1 + GST%)
  const calculateLandedCost = (qty: number, rate: number, discount: number, gstRate: number) => {
    const basic = qty * rate;
    const discounted = basic * (1 - discount / 100);
    return discounted * (1 + gstRate / 100);
  };

  // Map PO database objects to clean serializable props for the client component
  const mappedPOs = pos.map((po) => {
    const approver = users.find((u) => u.id === po.approvedById);
    
    const rfqNumbersSet = new Set<string>();
    const prNumbersSet = new Set<string>();
    const indentNumbersSet = new Set<string>();

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

    const rfqNumbers = Array.from(rfqNumbersSet);
    const prNumbers = Array.from(prNumbersSet);
    const indentNumbers = Array.from(indentNumbersSet);
    
    const totalTaxable = po.lines.reduce((sum, line) => {
      return sum + line.qty * line.rate * (1 - line.discount / 100);
    }, 0);

    const totalValue = po.lines.reduce((sum, line) => {
      const basic = line.qty * line.rate;
      const taxable = basic * (1 - line.discount / 100);
      const allocatedOtherCharges = totalTaxable > 0 ? po.otherCharges * (taxable / totalTaxable) : 0;
      const landed = (taxable + allocatedOtherCharges) * (1 + line.gstRate / 100);
      return sum + landed;
    }, 0);

    return {
      id: po.id,
      number: po.number,
      vendorId: po.vendorId,
      vendorName: po.vendor.name,
      vendorAddress: po.vendor.address,
      vendorGstin: po.vendor.gstin,
      vendorPan: po.vendor.pan,
      type: po.type,
      status: po.status,
      orderDate: po.orderDate.toISOString(),
      deliveryDate: po.deliveryDate ? po.deliveryDate.toISOString() : null,
      paymentTerms: po.paymentTerms,
      freightTerms: po.freightTerms,
      shipTo: po.shipTo,
      termsConditions: po.termsConditions,
      termsPresetId: po.termsPresetId,
      termsVersion: po.termsVersion,
      resolvedTermsText: po.resolvedTermsText,
      version: po.version,
      otherCharges: po.otherCharges,
      approvedBy: approver ? (approver.name || approver.email) : null,
      approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
      totalValue,
      lines: po.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          rate: line.rate,
          discount: line.discount,
          gstRate: line.gstRate,
          receivedQty: line.receivedQty,
          brand: line.brand,
          specification: line.specification,
        };
      }),
      amendments: po.amendments.map((am) => {
        const creator = users.find((u) => u.id === am.createdById);
        return {
          id: am.id,
          version: am.version,
          reason: am.reason,
          createdAt: am.createdAt.toISOString(),
          createdBy: creator ? (creator.name || creator.email) : "System",
          snapshot: am.snapshot,
        };
      }),
      rfqNumbers,
      prNumbers,
      indentNumbers,
    };
  });

  return (
    <PurchaseOrdersList
      initialPOs={mappedPOs}
      items={items}
      vendors={vendors as any}
      shipToLocations={shipToLocations}
      presets={presetsList}
      companyProfile={companyProfile}
      termsConfig={termsConfig}
      user={user}
    />
  );
}
