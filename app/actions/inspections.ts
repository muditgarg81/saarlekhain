"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { InspectionDisposition, GrnStatus } from "@prisma/client";

interface ParamResultInput {
  id: string; // InspectionResult.id
  paramName?: string | null;
  observed?: number | null;
  observedText?: string | null;
  pass: boolean;
}

export async function submitInspectionResult(
  inspectionId: string,
  data: {
    disposition: InspectionDisposition;
    mtcRef?: string | null;
    ocrDraft?: any;
    acceptedQty: number;
    rejectedQty: number;
    results: ParamResultInput[];
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const role = (session.user as any).role;

  // QC inspection role gate
  const canInspect = ["ADMIN", "OWNER", "STORE_MANAGER", "QC_INSPECTOR"].includes(role);
  if (!canInspect) return { success: false, error: "Access Denied: You do not have QC inspection rights." };

  try {
    const inspection = await db.inspection.findFirst({
      where: { id: inspectionId, companyId },
      include: { grn: { include: { lines: true } } }
    });
    if (!inspection) return { success: false, error: "QC Inspection record not found" };

    const grn = inspection.grn;
    const grnLine = grn.lines.find(l => l.id === inspection.grnLineId);
    if (!grnLine) return { success: false, error: "Linked GRN line not found" };

    // Validate quantities
    const totalQty = grnLine.receivedQty;
    if (data.acceptedQty + data.rejectedQty !== totalQty) {
      return { 
        success: false, 
        error: `Sum of Accepted (${data.acceptedQty}) and Rejected (${data.rejectedQty}) quantity must equal Received quantity (${totalQty})` 
      };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Update/Create inspection parameter results
      for (const res of data.results) {
        if (res.id.startsWith("new_")) {
          await tx.inspectionResult.create({
            data: {
              inspectionId,
              paramName: res.paramName || "Ad-hoc Parameter",
              observed: res.observed || null,
              observedText: res.observedText || null,
              pass: res.pass
            }
          });
        } else {
          await tx.inspectionResult.update({
            where: { id: res.id },
            data: {
              observed: res.observed || null,
              observedText: res.observedText || null,
              pass: res.pass
            }
          });
        }
      }

      // 2. Update Inspection header
      const updatedInspection = await tx.inspection.update({
        where: { id: inspectionId },
        data: {
          disposition: data.disposition,
          mtcRef: data.mtcRef || null,
          ocrDraft: data.ocrDraft || null,
          inspectedById: actorId,
          inspectedAt: new Date()
        },
        include: { results: true }
      });

      // 3. Update GRN Line quantities
      await tx.grnLine.update({
        where: { id: inspection.grnLineId },
        data: {
          acceptedQty: data.acceptedQty,
          rejectedQty: data.rejectedQty
        }
      });

      // 3.5 Create/Update RejectedMaterial record if rejectedQty > 0
      if (data.rejectedQty > 0) {
        const dbGrn = await tx.grn.findUnique({
          where: { id: inspection.grnId }
        });

        let vendorName = "Unknown Vendor";
        if (dbGrn?.vendorId) {
          const vendorObj = await tx.vendor.findUnique({
            where: { id: dbGrn.vendorId }
          });
          if (vendorObj) vendorName = vendorObj.name;
        }

        const item = await tx.item.findUnique({
          where: { id: inspection.itemId }
        });

        await tx.rejectedMaterial.upsert({
          where: { grnLineId: inspection.grnLineId },
          update: {
            rejectedQty: data.rejectedQty,
            vendorName,
            itemCode: item?.code || "N/A",
            itemName: item?.name || "Unknown Item",
            grnNumber: dbGrn?.number || "N/A",
          },
          create: {
            companyId,
            grnLineId: inspection.grnLineId,
            grnNumber: dbGrn?.number || "N/A",
            itemCode: item?.code || "N/A",
            itemName: item?.name || "Unknown Item",
            vendorName,
            rejectedQty: data.rejectedQty,
            status: "PENDING_RETURN",
          }
        });
      }

      // 4. Verify if all QC-required lines in the parent GRN are completed
      // Fetch all inspections associated with this GRN
      const grnInspections = await tx.inspection.findMany({
        where: { grnId: grn.id }
      });

      // If all inspections have a disposition set, then QC is fully completed
      const allQcDone = grnInspections.every(i => i.id === inspectionId ? !!data.disposition : !!i.disposition);

      if (allQcDone) {
        await tx.grn.update({
          where: { id: grn.id },
          data: { status: GrnStatus.QC_DONE }
        });
      }

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "QC_SUBMIT",
          entity: "Inspection",
          entityId: inspectionId,
          after: JSON.parse(JSON.stringify(updatedInspection))
        }
      });

      return updatedInspection;
    });

    revalidatePath("/stores/grn");
    revalidatePath("/stores/inspection");
    return { success: true, inspection: result };
  } catch (err: any) {
    console.error("Error submitting QC inspection:", err);
    return { success: false, error: err.message || "Failed to submit QC inspection" };
  }
}
