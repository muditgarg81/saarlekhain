import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import InspectionList from "./InspectionList";

export default async function InspectionPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch inspections with grn, item, and results
  const inspections = await db.inspection.findMany({
    where: { companyId },
    include: {
      grn: {
        select: { number: true, lines: true }
      },
      results: true
    },
    orderBy: { number: "desc" }
  });

  // Fetch items to map names
  const items = await db.item.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, code: true, name: true, inspectionPlan: { include: { params: true } } }
  });

  const itemsMap = new Map(items.map(i => [i.id, i]));

  // Map database instances to clean serializable props for the client
  const mappedInspections = inspections.map(i => {
    const item = itemsMap.get(i.itemId);
    const grnLine = i.grn.lines.find(l => l.id === i.grnLineId);
    
    // Compile results with spec limits from item's inspection plan
    const resultsWithSpecs = i.results.map(res => {
      const specParam = item?.inspectionPlan?.params.find(p => p.name === res.paramName);
      return {
        id: res.id,
        paramName: res.paramName,
        observed: res.observed,
        observedText: res.observedText,
        pass: res.pass,
        specMin: specParam?.specMin || null,
        specMax: specParam?.specMax || null,
        specTarget: specParam?.specTarget || null
      };
    });

    return {
      id: i.id,
      number: i.number,
      grnNumber: i.grn.number,
      grnLineId: i.grnLineId,
      itemName: item?.name || "Unknown Item",
      itemCode: item?.code || "N/A",
      receivedQty: grnLine?.receivedQty || 0,
      sampleSize: i.sampleSize,
      disposition: i.disposition,
      mtcRef: i.mtcRef,
      inspectedBy: i.inspectedById, // simplified for client mapping
      inspectedAt: i.inspectedAt ? i.inspectedAt.toISOString() : null,
      results: resultsWithSpecs
    };
  });

  return (
    <InspectionList
      initialInspections={mappedInspections}
      userRole={userRole}
    />
  );
}
