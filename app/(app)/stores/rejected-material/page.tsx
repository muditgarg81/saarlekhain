import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import RejectedMaterialClient from "./RejectedMaterialClient";

export default async function RejectedMaterialPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // Fetch rejected materials list
  const materials = await db.rejectedMaterial.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });

  // Map to plain objects to ensure safe serialization of Date fields
  const plainMaterials = materials.map((m) => ({
    id: m.id,
    companyId: m.companyId,
    grnLineId: m.grnLineId,
    grnNumber: m.grnNumber,
    itemCode: m.itemCode,
    itemName: m.itemName,
    vendorName: m.vendorName,
    rejectedQty: m.rejectedQty,
    status: m.status,
    gatepassRef: m.gatepassRef,
    actionDate: m.actionDate ? m.actionDate.toISOString() : null,
    remarks: m.remarks,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));

  // Fetch items, vendors, and posted GRNs concurrently
  const [items, vendors, grns] = await Promise.all([
    db.item.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, name: true, qcRequired: true }
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true }
    }),
    db.grn.findMany({
      where: { companyId, status: "POSTED" },
      include: { lines: true }
    })
  ]);

  // Filter out GRN lines that already have a RejectedMaterial record (since grnLineId is unique)
  const existingRejectedGrnLineIds = new Set(materials.map((m) => m.grnLineId));

  // Flatten all GRN lines and filter in-memory
  const filteredNonQcLines = grns
    .flatMap(grn => grn.lines.map(line => {
      const item = items.find(i => i.id === line.itemId);
      const vendor = vendors.find(v => v.id === grn.vendorId);
      return {
        ...line,
        grn,
        item,
        vendor
      };
    }))
    .filter(line => 
      line.item && 
      !line.item.qcRequired && 
      line.acceptedQty > 0 && 
      !existingRejectedGrnLineIds.has(line.id)
    );

  const serializedNonQcLines = filteredNonQcLines.map((line) => ({
    id: line.id,
    grnNumber: line.grn.number,
    itemCode: line.item!.code,
    itemName: line.item!.name,
    itemId: line.itemId,
    receivedQty: line.receivedQty,
    acceptedQty: line.acceptedQty,
    rejectedQty: line.rejectedQty,
    vendorName: line.vendor?.name || "Unknown Vendor",
    date: line.grn.createdAt.toISOString(),
  }));

  return (
    <RejectedMaterialClient
      initialMaterials={plainMaterials}
      nonQcLines={serializedNonQcLines}
    />
  );
}
