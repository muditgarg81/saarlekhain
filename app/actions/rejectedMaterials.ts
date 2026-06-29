"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { RejectedMaterialStatus, GatePassType, GatePassStatus, NoteType, LedgerTxnType, GrnStatus } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { postLedgerEntry } from "@/lib/stock";

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

      // If status changes from PENDING_RETURN to a finalized state (RETURNED_TO_VENDOR, DISPOSED, or SHORT_SUPPLY), generate a Debit Note
      if ((data.status === "RETURNED_TO_VENDOR" || data.status === "DISPOSED" || data.status === "SHORT_SUPPLY") && original.status === "PENDING_RETURN") {
        // Resolve vendorId robustly
        let vendorId = grnLine?.grn?.vendorId;
        if (!vendorId) {
          const vendorObj = await tx.vendor.findFirst({
            where: { name: original.vendorName, companyId }
          });
          vendorId = vendorObj?.id;
        }
        if (!vendorId && original.grnNumber) {
          const grnObj = await tx.grn.findFirst({
            where: { number: original.grnNumber, companyId }
          });
          vendorId = grnObj?.vendorId;
        }

        if (vendorId) {
          // Check if a debit note already exists for this rejection to prevent duplicates
          const existingNote = await tx.debitCreditNote.findFirst({
            where: { refType: "GRN_REJECTION", refId: original.id, companyId }
          });

          if (!existingNote) {
            // Fetch rate, discount, and gstRate
            let rate = 0;
            let discount = 0;
            let gstRate = 0;

            if (grnLine?.poLineId) {
              const poLine = await tx.poLine.findUnique({
                where: { id: grnLine.poLineId }
              });
              if (poLine) {
                rate = poLine.rate;
                discount = poLine.discount;
                gstRate = poLine.gstRate;
              }
            } else {
              // Fallback 1: Try to look up SupplierInvoice matching invoiceNo
              let finalInvoiceNo = grnLine?.grn?.invoiceNo;
              if (!finalInvoiceNo) {
                const grnObj = await tx.grn.findFirst({
                  where: { number: original.grnNumber, companyId }
                });
                finalInvoiceNo = grnObj?.invoiceNo || null;
              }

              if (finalInvoiceNo) {
                const invoice = await tx.supplierInvoice.findFirst({
                  where: {
                    companyId,
                    vendorId,
                    invoiceNo: finalInvoiceNo,
                    deletedAt: null
                  },
                  include: {
                    lines: true
                  }
                });
                if (invoice) {
                  const item = await tx.item.findFirst({
                    where: { code: original.itemCode, companyId }
                  });
                  if (item) {
                    const invLine = invoice.lines.find((il: any) => il.itemId === item.id);
                    if (invLine) {
                      rate = invLine.rate;
                    }
                  }
                }
              }

              // Fallback 2: Search for the latest PO line of this item across company
              if (rate === 0) {
                const item = await tx.item.findFirst({
                  where: { code: original.itemCode, companyId }
                });
                if (item) {
                  const latestPoLine = await tx.poLine.findFirst({
                    where: { itemId: item.id, po: { companyId } },
                    orderBy: { id: "desc" }
                  });
                  if (latestPoLine) {
                    rate = latestPoLine.rate;
                    discount = latestPoLine.discount;
                    gstRate = latestPoLine.gstRate;
                  }
                }
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
                vendorId,
                refType: "GRN_REJECTION",
                refId: original.id,
                amount: totalDebitAmount,
                posted: false
              }
            });
          }
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

export async function rejectMaterialDirectly(data: {
  grnLineId: string;
  rejectedQty: number;
  remarks?: string | null;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Fetch GRN Line and ensure it exists and belongs to company
      const grnLine = await tx.grnLine.findFirst({
        where: { id: data.grnLineId, grn: { companyId } },
        include: { grn: true }
      });

      if (!grnLine) throw new Error("GRN line not found");
      if (grnLine.grn.status !== GrnStatus.POSTED) throw new Error("GRN must be POSTED to perform rejection");

      // Resolve item in transaction
      const item = await tx.item.findFirst({
        where: { id: grnLine.itemId, companyId }
      });
      if (!item) throw new Error("Item not found");
      if (item.qcRequired) throw new Error("This item requires regular QC inspection; use the QC Inspection module instead");

      // Resolve vendor
      let vendorName = "Unknown Vendor";
      if (grnLine.grn.vendorId) {
        const vendor = await tx.vendor.findFirst({
          where: { id: grnLine.grn.vendorId, companyId }
        });
        if (vendor) {
          vendorName = vendor.name;
        }
      }

      if (data.rejectedQty <= 0) throw new Error("Rejection quantity must be greater than zero");
      if (data.rejectedQty > grnLine.acceptedQty) {
        throw new Error(`Rejection quantity cannot exceed current accepted quantity (${grnLine.acceptedQty})`);
      }

      // 2. Decrease acceptedQty, increase rejectedQty of GrnLine
      await tx.grnLine.update({
        where: { id: data.grnLineId },
        data: {
          acceptedQty: grnLine.acceptedQty - data.rejectedQty,
          rejectedQty: grnLine.rejectedQty + data.rejectedQty
        }
      });

      // 3. Decrease poLine.receivedQty if linked
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
          await tx.poLine.update({
            where: { id: grnLine.poLineId },
            data: {
              receivedQty: Math.max(0, poLine.receivedQty - data.rejectedQty)
            }
          });
        }
      } else {
        // Fallback for rate, discount, gstRate
        const latestPoLine = await tx.poLine.findFirst({
          where: { itemId: grnLine.itemId, po: { companyId } },
          orderBy: { id: "desc" }
        });
        if (latestPoLine) {
          rate = latestPoLine.rate;
          discount = latestPoLine.discount;
          gstRate = latestPoLine.gstRate;
        }
      }

      // 4. Create RejectedMaterial record
      const rejectedMaterial = await tx.rejectedMaterial.create({
        data: {
          companyId,
          grnLineId: grnLine.id,
          grnNumber: grnLine.grn.number,
          itemCode: item.code,
          itemName: item.name,
          vendorName: vendorName,
          rejectedQty: data.rejectedQty,
          status: "RETURNED_TO_VENDOR",
          actionDate: new Date(),
          remarks: data.remarks || "Direct Rejection (No QC)",
        }
      });

      // 5. Post stock ledger entry for return to vendor
      await postLedgerEntry(tx, {
        companyId,
        itemId: grnLine.itemId,
        storeId: grnLine.grn.storeId,
        binId: grnLine.binId,
        batchId: grnLine.batchId,
        txnType: LedgerTxnType.RETURN_TO_VENDOR,
        qty: -data.rejectedQty, // negative qty
        rate: rate || null,
        refType: "REJECTION",
        refId: rejectedMaterial.id,
        createdById: actorId
      });

      // 6. Generate Debit Note
      let vendorId = grnLine.grn.vendorId;

      if (vendorId) {
        // Calculate Debit Note value
        const baseValue = data.rejectedQty * rate * (1 - discount / 100);
        const gstValue = baseValue * (gstRate / 100);
        const totalDebitAmount = Math.round((baseValue + gstValue) * 100) / 100;

        const dnNumber = await getNextSequence(companyId, "DN");
        await tx.debitCreditNote.create({
          data: {
            companyId,
            number: dnNumber,
            type: NoteType.DEBIT,
            vendorId,
            refType: "GRN_REJECTION",
            refId: rejectedMaterial.id,
            amount: totalDebitAmount,
            posted: false
          }
        });
      }

      return rejectedMaterial;
    });

    revalidatePath("/stores/rejected-material");
    return { success: true, rejectedMaterial: result };
  } catch (err: any) {
    console.error("Error in direct material rejection:", err);
    return { success: false, error: err.message || "Failed to reject material" };
  }
}
