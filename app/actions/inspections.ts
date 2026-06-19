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
    const result = await db.$transaction(async (tx) => {
      // 1. Fetch inspection & parent GRN details inside transaction
      const inspection = await tx.inspection.findFirst({
        where: { id: inspectionId, companyId },
        include: { grn: { include: { lines: true } } }
      });
      if (!inspection) throw new Error("QC Inspection record not found");

      const grn = inspection.grn;
      if (grn.status === GrnStatus.POSTED) {
        throw new Error("Cannot modify inspection results for a POSTED GRN. Please delete/revert the GRN first.");
      }

      const grnLine = grn.lines.find(l => l.id === inspection.grnLineId);
      if (!grnLine) throw new Error("Linked GRN line not found");

      // 2. Lock the parent GRN row to serialize QC inspection submissions for the same GRN
      await tx.grn.update({
        where: { id: grn.id },
        data: { status: grn.status } // Dummy status update to lock row
      });

      // 3. Validate quantities
      const totalQty = grnLine.receivedQty;
      if (data.acceptedQty + data.rejectedQty !== totalQty) {
        throw new Error(`Sum of Accepted (${data.acceptedQty}) and Rejected (${data.rejectedQty}) quantity must equal Received quantity (${totalQty})`);
      }

      // 4. Update/Create inspection parameter results
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

      // 5. Update Inspection header
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

      // 6. Update GRN Line quantities
      await tx.grnLine.update({
        where: { id: inspection.grnLineId },
        data: {
          acceptedQty: data.acceptedQty,
          rejectedQty: data.rejectedQty
        }
      });

      // 7. Create/Update RejectedMaterial record if rejectedQty > 0, otherwise delete it
      if (data.rejectedQty > 0) {
        let vendorName = "Unknown Vendor";
        if (grn.vendorId) {
          const vendorObj = await tx.vendor.findUnique({
            where: { id: grn.vendorId }
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
            grnNumber: grn.number,
          },
          create: {
            companyId,
            grnLineId: inspection.grnLineId,
            grnNumber: grn.number,
            itemCode: item?.code || "N/A",
            itemName: item?.name || "Unknown Item",
            vendorName,
            rejectedQty: data.rejectedQty,
            status: "PENDING_RETURN",
          }
        });
      } else {
        await tx.rejectedMaterial.deleteMany({
          where: { grnLineId: inspection.grnLineId }
        });
      }

      // 8. Verify if all QC-required lines in the parent GRN are completed
      const grnInspections = await tx.inspection.findMany({
        where: { grnId: grn.id }
      });

      const allQcDone = grnInspections.every(i => i.id === inspectionId ? !!data.disposition : !!i.disposition);

      if (allQcDone) {
        await tx.grn.update({
          where: { id: grn.id },
          data: { status: GrnStatus.QC_DONE }
        });
      }

      // 9. Audit Log
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

export async function resetInspectionResult(inspectionId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const role = (session.user as any).role;

  // QC inspection role gate
  const canInspect = ["ADMIN", "OWNER", "STORE_MANAGER", "QC_INSPECTOR"].includes(role);
  if (!canInspect) return { success: false, error: "Access Denied: You do not have QC inspection rights." };

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Fetch inspection details
      const inspection = await tx.inspection.findFirst({
        where: { id: inspectionId, companyId },
        include: { grn: true }
      });
      if (!inspection) throw new Error("QC Inspection record not found");

      const grn = inspection.grn;
      if (grn.status === GrnStatus.POSTED) {
        throw new Error("Cannot reset inspection for a POSTED GRN. Please delete/revert the GRN first.");
      }

      // 2. Clear inspection results observations
      await tx.inspectionResult.updateMany({
        where: { inspectionId },
        data: {
          observed: null,
          observedText: null,
          pass: null
        }
      });

      // 3. Clear inspection header disposition
      const updatedInspection = await tx.inspection.update({
        where: { id: inspectionId },
        data: {
          disposition: null,
          inspectedById: null,
          inspectedAt: null
        }
      });

      // 4. Reset GRN Line quantities
      await tx.grnLine.update({
        where: { id: inspection.grnLineId },
        data: {
          acceptedQty: 0,
          rejectedQty: 0
        }
      });

      // 5. Delete RejectedMaterial record
      await tx.rejectedMaterial.deleteMany({
        where: { grnLineId: inspection.grnLineId }
      });

      // 6. Reset GRN status back to QC_PENDING
      await tx.grn.update({
        where: { id: grn.id },
        data: { status: GrnStatus.QC_PENDING }
      });

      // 7. Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "QC_RESET",
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
    console.error("Error resetting QC inspection:", err);
    return { success: false, error: err.message || "Failed to reset QC inspection" };
  }
}
