"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { RejectedMaterialStatus, GatePassType, GatePassStatus, NoteType } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";

export async function updateRejectedMaterialStatus(
  id: string,
  data: {
    status: RejectedMaterialStatus;
    gatepassRef?: string | null;
    actionDate?: string | null;
    remarks?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.rejectedMaterial.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Rejected material record not found" };

    const updated = await db.$transaction(async (tx) => {
      let finalGatepassRef = data.gatepassRef || null;

      const grnLine = await tx.grnLine.findUnique({
        where: { id: original.grnLineId },
        include: { grn: true }
      });

      // If status changes from PENDING_RETURN to RETURNED_TO_VENDOR, automatically generate an Outward Gatepass
      if (data.status === "RETURNED_TO_VENDOR" && original.status === "PENDING_RETURN") {
        if (grnLine) {
          const gpNumber = await getNextSequence(companyId, "GP");
          
          await tx.gatePass.create({
            data: {
              companyId,
              number: gpNumber,
              type: GatePassType.NON_RETURNABLE,
              vendorId: grnLine.grn.vendorId,
              purpose: `Return of rejected items from GRN ${original.grnNumber}`,
              status: GatePassStatus.OPEN,
              createdById: actorId,
              lines: {
                create: [
                  {
                    itemId: grnLine.itemId,
                    qty: original.rejectedQty,
                    returnedQty: 0
                  }
                ]
              }
            }
          });

          // Use the generated Gatepass number as the reference if not manually provided
          finalGatepassRef = finalGatepassRef || gpNumber;
        }
      }

      // If status changes from PENDING_RETURN to a finalized state (RETURNED_TO_VENDOR or DISPOSED), generate a Debit Note
      if ((data.status === "RETURNED_TO_VENDOR" || data.status === "DISPOSED") && original.status === "PENDING_RETURN") {
        if (grnLine && grnLine.grn.vendorId) {
          // Fetch PoLine to get exact rate, discount, and gstRate
          let rate = 0;
          let discount = 0;
          let gstRate = 0;
          if (grnLine.poLineId) {
            const poLine = await tx.poLine.findUnique({
              where: { id: grnLine.poLineId }
            });
            if (poLine) {
              rate = poLine.rate;
              discount = poLine.discount;
              gstRate = poLine.gstRate;
            }
          }

          // Calculate Debit Note value
          const baseValue = original.rejectedQty * rate * (1 - discount / 100);
          const gstValue = baseValue * (gstRate / 100);
          const totalDebitAmount = Math.round((baseValue + gstValue) * 100) / 100;

          // Generate Debit Note in draft (unposted) status
          const dnNumber = await getNextSequence(companyId, "DN");
          await tx.debitCreditNote.create({
            data: {
              companyId,
              number: dnNumber,
              type: NoteType.DEBIT,
              vendorId: grnLine.grn.vendorId,
              refType: "GRN_REJECTION",
              refId: original.id,
              amount: totalDebitAmount,
              posted: false
            }
          });
        }
      }

      const rm = await tx.rejectedMaterial.update({
        where: { id },
        data: {
          status: data.status,
          gatepassRef: finalGatepassRef,
          actionDate: data.actionDate ? new Date(data.actionDate) : null,
          remarks: data.remarks || null
        }
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "REJECTED_MATERIAL_UPDATE",
          entity: "RejectedMaterial",
          entityId: id,
          before: original,
          after: rm
        }
      });

      return rm;
    });

    revalidatePath("/stores/rejected-material");
    revalidatePath("/stores/outwards"); // revalidate gatepasses list too
    return { success: true, rejectedMaterial: updated };
  } catch (err: any) {
    console.error("Error updating rejected material:", err);
    return { success: false, error: err.message || "Failed to update status" };
  }
}
