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

  return (
    <RejectedMaterialClient
      initialMaterials={plainMaterials}
    />
  );
}
