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
      select: { id: true, code: true, name: true, baseUom: true },
      orderBy: { code: "asc" },
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
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
    const totalValue = po.lines.reduce((sum, line) => {
      return sum + calculateLandedCost(line.qty, line.rate, line.discount, line.gstRate);
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
