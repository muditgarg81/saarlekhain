import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import RequisitionsList from "./RequisitionsList";

export default async function RequisitionsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch PRs, RFQs, Items, Vendors, and Indents concurrently
  const [prs, rfqs, items, vendors, users, shipToLocations, rawPresets, indents] = await Promise.all([
    db.purchaseRequisition.findMany({
      where: { companyId, deletedAt: null },
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
      orderBy: { createdAt: "desc" },
    }),
    db.rfq.findMany({
      where: { companyId },
      include: {
        lines: true,
        quotations: {
          include: {
            lines: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.item.findMany({
      where: { companyId, status: "ACTIVE", deletedAt: null },
      select: { id: true, code: true, name: true, baseUom: true, moq: true },
      orderBy: { code: "asc" },
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true, minOrderValue: true },
      orderBy: { code: "asc" },
    }),
    db.user.findMany({
      where: { companyId },
      select: { id: true, name: true, email: true },
    }),
    db.shipToLocation.findMany({
      where: { companyId },
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
    db.indent.findMany({
      where: { companyId },
      select: { id: true, number: true },
    }),
  ]);

  const indentIdToNumberMap = new Map<string, string>();
  indents.forEach((ind) => {
    indentIdToNumberMap.set(ind.id, ind.number);
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
  const presets = Array.from(presetMap.values()).map(p => ({
    id: p.id,
    name: p.name,
    key: p.key,
    text: p.text,
    isDefault: p.isDefault,
    appliesTo: p.appliesTo
  }));

  // Map PRs to clean UI structures
  const mappedPrs = prs.map((pr) => {
    const approver = users.find((u) => u.id === pr.approvedById);
    
    // Resolve all unique source indent numbers
    const indentNumbersSet = new Set<string>();
    if (pr.indentId) {
      const headerIndentNum = indentIdToNumberMap.get(pr.indentId);
      if (headerIndentNum) {
        indentNumbersSet.add(headerIndentNum);
      }
    }

    pr.lines.forEach((line) => {
      line.indentLines?.forEach((il) => {
        if (il.indent?.number) {
          indentNumbersSet.add(il.indent.number);
        }
      });
    });

    const indentNumbers = Array.from(indentNumbersSet);

    return {
      id: pr.id,
      number: pr.number,
      status: pr.status,
      createdAt: pr.createdAt.toISOString(),
      approvedBy: approver ? (approver.name || approver.email) : null,
      approvedAt: pr.approvedAt ? pr.approvedAt.toISOString() : null,
      remarks: pr.remarks,
      indentNumbers,
      lines: pr.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          requiredBy: line.requiredBy ? line.requiredBy.toISOString() : null,
          orderedQty: line.orderedQty,
          shortClosedQty: line.shortClosedQty,
          status: line.status,
        };
      }),
    };
  });

  // Map RFQs to clean UI structures
  const mappedRfqs = rfqs.map((rfq) => {
    const sourcePr = prs.find((p) => p.id === rfq.prId);
    return {
      id: rfq.id,
      number: rfq.number,
      prId: rfq.prId,
      prNumber: sourcePr?.number || null,
      status: rfq.status,
      createdAt: rfq.createdAt.toISOString(),
      lines: rfq.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          awardedQty: line.awardedQty,
          status: line.status,
        };
      }),
      quotations: rfq.quotations.map((q) => {
        const vendor = vendors.find((v) => v.id === q.vendorId);
        return {
          id: q.id,
          vendorId: q.vendorId,
          vendorName: vendor?.name || "Unknown Vendor",
          leadDays: q.leadDays,
          terms: q.terms,
          paymentTerms: q.paymentTerms,
          freight: q.freight,
          packingCharges: q.packingCharges,
          awarded: q.awarded,
          lines: q.lines.map((l) => ({
            id: l.id,
            itemId: l.itemId,
            rate: l.rate,
            discount: l.discount,
            gstRate: l.gstRate,
            rfqLineId: l.rfqLineId,
            canSupply: l.canSupply,
            quotedQty: l.quotedQty,
            leadDays: l.leadDays,
            landedUnit: l.landedUnit,
            rank: l.rank,
          })),
        };
      }),
    };
  });

  return (
    <RequisitionsList
      prs={mappedPrs}
      rfqs={mappedRfqs}
      items={items}
      vendors={vendors}
      userRole={userRole}
      user={session.user as any}
      shipToLocations={shipToLocations}
      presets={presets}
    />
  );
}
