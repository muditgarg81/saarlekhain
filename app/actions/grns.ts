"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { postLedgerEntry } from "@/lib/stock";
import { revalidatePath } from "next/cache";
import { GrnStatus, LedgerTxnType, PoStatus, GrnSource } from "@prisma/client";

interface GrnLineInput {
  itemId: string;
  poLineId?: string | null;
  receivedQty: number;
  binId?: string | null;
  batchLotNo?: string | null;
  batchMfgDate?: string | null;
  batchExpiryDate?: string | null;
}

export async function createGrn(data: {
  source: GrnSource;
  poId?: string | null;
  vendorId?: string | null;
  storeId: string;
  dcNo?: string | null;
  dcDate?: string | null;
  invoiceNo?: string | null;
  ocrDraft?: any;
  lines: GrnLineInput[];
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    if (!data.lines || data.lines.length === 0) {
      return { success: false, error: "GRN must have at least one line item" };
    }

    const number = await getNextSequence(companyId, "GRN");

    // Check if any items require QC
    const itemIds = data.lines.map(l => l.itemId);
    const qcItems = await db.item.findMany({
      where: { id: { in: itemIds }, companyId },
      select: { id: true, qcRequired: true }
    });
    const qcRequiredMap = new Map(qcItems.map(i => [i.id, i.qcRequired]));
    const anyQcRequired = data.lines.some(l => qcRequiredMap.get(l.itemId) === true);

    const initialStatus = anyQcRequired ? GrnStatus.QC_PENDING : GrnStatus.DRAFT;

    const result = await db.$transaction(async (tx) => {
      // 1. Create batches if lot numbers are supplied
      const lineCreates = [];
      for (const line of data.lines) {
        let batchId = null;
        if (line.batchLotNo) {
          const mfg = line.batchMfgDate ? new Date(line.batchMfgDate) : null;
          const exp = line.batchExpiryDate ? new Date(line.batchExpiryDate) : null;
          
          const batch = await tx.batch.upsert({
            where: {
              companyId_itemId_lotNo: {
                companyId,
                itemId: line.itemId,
                lotNo: line.batchLotNo,
              }
            },
            update: {
              mfgDate: mfg,
              expiryDate: exp
            },
            create: {
              companyId,
              itemId: line.itemId,
              lotNo: line.batchLotNo,
              mfgDate: mfg,
              expiryDate: exp
            }
          });
          batchId = batch.id;
        }

        // For non-QC items, acceptedQty defaults to receivedQty
        const qcReq = qcRequiredMap.get(line.itemId) === true;
        const acceptedQty = qcReq ? 0 : line.receivedQty;

        lineCreates.push({
          itemId: line.itemId,
          poLineId: line.poLineId || null,
          receivedQty: line.receivedQty,
          acceptedQty,
          rejectedQty: 0,
          binId: line.binId || null,
          batchId,
        });
      }

      // 2. Create GRN
      const grn = await tx.grn.create({
        data: {
          companyId,
          number,
          source: data.source,
          poId: data.poId || null,
          vendorId: data.vendorId || null,
          storeId: data.storeId,
          dcNo: data.dcNo || null,
          dcDate: data.dcDate ? new Date(data.dcDate) : null,
          invoiceNo: data.invoiceNo || null,
          ocrDraft: data.ocrDraft || null,
          status: initialStatus,
          lines: {
            create: lineCreates
          }
        },
        include: {
          lines: true
        }
      });

      // 3. If any item requires QC, create the Inspection records
      if (anyQcRequired) {
        for (const line of grn.lines) {
          const qcReq = qcRequiredMap.get(line.itemId) === true;
          if (qcReq) {
            const inspPlan = await tx.inspectionPlan.findUnique({
              where: { itemId: line.itemId },
              include: { params: true }
            });

            const inspNumber = await getNextSequence(companyId, "INSP");
            
            const inspection = await tx.inspection.create({
              data: {
                companyId,
                number: inspNumber,
                grnId: grn.id,
                grnLineId: line.id,
                itemId: line.itemId,
                sampleSize: inspPlan?.sampleSize || 1,
                results: {
                  create: (inspPlan?.params || []).map((p: any) => ({
                    paramName: p.name,
                  }))
                }
              }
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "CREATE",
          entity: "Grn",
          entityId: grn.id,
          after: JSON.parse(JSON.stringify(grn))
        }
      });

      return grn;
    });

    revalidatePath("/stores/grn");
    revalidatePath("/stores/inspection");
    return { success: true, grn: result };
  } catch (err: any) {
    console.error("Error creating GRN:", err);
    return { success: false, error: err.message || "Failed to create GRN" };
  }
}

/**
 * Posts an accepted GRN, committing stock to the ledger and updating PO tracking.
 */
export async function postGrn(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const grn = await db.grn.findFirst({
      where: { id, companyId },
      include: { lines: true }
    });
    if (!grn) return { success: false, error: "GRN not found" };
    
    // Can only post if DRAFT (no QC) or QC_DONE
    const canPost = grn.status === GrnStatus.DRAFT || grn.status === GrnStatus.QC_DONE;
    if (!canPost) {
      return { success: false, error: "GRN must be in DRAFT or QC DONE status to post" };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Post ledger entries for each line's accepted quantity
      for (const line of grn.lines) {
        if (line.acceptedQty <= 0) continue;

        // Fetch item rate if linked to a PO
        let poRate = 0;
        if (line.poLineId) {
          const poLine = await tx.poLine.findUnique({
            where: { id: line.poLineId }
          });
          if (poLine) {
            poRate = poLine.rate;
            // Update PO line received qty
            const newReceived = poLine.receivedQty + line.acceptedQty;
            await tx.poLine.update({
              where: { id: line.poLineId },
              data: { receivedQty: newReceived }
            });
          }
        }

        // Post stock ledger entry (+receipt)
        await postLedgerEntry(tx, {
          companyId,
          itemId: line.itemId,
          storeId: grn.storeId,
          binId: line.binId,
          batchId: line.batchId,
          txnType: LedgerTxnType.GRN_RECEIPT,
          qty: line.acceptedQty,
          rate: poRate || null, // Will use average fallback if no PO
          refType: "GRN",
          refId: grn.id,
          createdById: actorId,
        });
      }

      // 2. If this is linked to a PO, verify if the PO is now fully received
      if (grn.poId) {
        const poLines = await tx.poLine.findMany({
          where: { poId: grn.poId }
        });
        const allReceived = poLines.every(l => l.receivedQty >= l.qty);
        const anyReceived = poLines.some(l => l.receivedQty > 0);

        const nextPoStatus = allReceived 
          ? PoStatus.RECEIVED 
          : (anyReceived ? PoStatus.PARTIALLY_RECEIVED : PoStatus.APPROVED);

        await tx.purchaseOrder.update({
          where: { id: grn.poId },
          data: { status: nextPoStatus }
        });
      }

      // 3. Update GRN status to POSTED
      const updatedGrn = await tx.grn.update({
        where: { id },
        data: {
          status: GrnStatus.POSTED,
          postedById: actorId,
          postedAt: new Date(),
        }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "POST_GRN",
          entity: "Grn",
          entityId: grn.id,
          after: JSON.parse(JSON.stringify(updatedGrn))
        }
      });

      return updatedGrn;
    });

    revalidatePath("/stores/grn");
    revalidatePath("/stores/reports");
    revalidatePath("/purchase/po");
    return { success: true, grn: result };
  } catch (err: any) {
    console.error("Error posting GRN:", err);
    return { success: false, error: err.message || "Failed to post GRN" };
  }
}

export async function updateGrn(
  id: string,
  data: {
    storeId: string;
    dcNo?: string | null;
    dcDate?: string | null;
    invoiceNo?: string | null;
    lines: { id?: string; itemId: string; poLineId?: string | null; receivedQty: number; binId?: string | null; batchLotNo?: string | null; batchMfgDate?: string | null; batchExpiryDate?: string | null }[];
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.grn.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true }
    });
    if (!original) return { success: false, error: "GRN not found" };

    // Get item QC requirements
    const itemIds = data.lines.map(l => l.itemId);
    const qcItems = await db.item.findMany({
      where: { id: { in: itemIds }, companyId },
      select: { id: true, qcRequired: true }
    });
    const qcRequiredMap = new Map(qcItems.map(i => [i.id, i.qcRequired]));
    const anyQcRequired = data.lines.some(l => qcRequiredMap.get(l.itemId) === true);

    const result = await db.$transaction(async (tx) => {
      // 1. If POSTED, revert original stock ledger and PO received quantities
      if (original.status === GrnStatus.POSTED) {
        await tx.stockLedger.deleteMany({
          where: { companyId, refType: "GRN", refId: id }
        });

        if (original.poId) {
          for (const line of original.lines) {
            if (line.poLineId && line.acceptedQty > 0) {
              const poLine = await tx.poLine.findUnique({
                where: { id: line.poLineId }
              });
              if (poLine) {
                const revertedQty = Math.max(0, poLine.receivedQty - line.acceptedQty);
                await tx.poLine.update({
                  where: { id: line.poLineId },
                  data: { receivedQty: revertedQty }
                });
              }
            }
          }
        }
      }

      // 2. Delete old inspections & results
      const inspections = await tx.inspection.findMany({
        where: { grnId: id, companyId }
      });
      const inspIds = inspections.map(i => i.id);
      if (inspIds.length > 0) {
        await tx.inspectionResult.deleteMany({
          where: { inspectionId: { in: inspIds } }
        });
        await tx.inspection.deleteMany({
          where: { id: { in: inspIds } }
        });
      }

      // 3. Delete old GRN lines
      await tx.grnLine.deleteMany({
        where: { grnId: id }
      });

      // 4. Create new lines (and upsert batches)
      const lineCreates = [];
      for (const line of data.lines) {
        let batchId = null;
        if (line.batchLotNo) {
          const mfg = line.batchMfgDate ? new Date(line.batchMfgDate) : null;
          const exp = line.batchExpiryDate ? new Date(line.batchExpiryDate) : null;
          
          const batch = await tx.batch.upsert({
            where: {
              companyId_itemId_lotNo: {
                companyId,
                itemId: line.itemId,
                lotNo: line.batchLotNo,
              }
            },
            update: {
              mfgDate: mfg,
              expiryDate: exp
            },
            create: {
              companyId,
              itemId: line.itemId,
              lotNo: line.batchLotNo,
              mfgDate: mfg,
              expiryDate: exp
            }
          });
          batchId = batch.id;
        }

        // For non-QC items, acceptedQty defaults to receivedQty
        const qcReq = qcRequiredMap.get(line.itemId) === true;
        const acceptedQty = (original.status === GrnStatus.POSTED) 
          ? line.receivedQty 
          : (qcReq ? 0 : line.receivedQty);

        lineCreates.push({
          itemId: line.itemId,
          poLineId: line.poLineId || null,
          receivedQty: line.receivedQty,
          acceptedQty,
          rejectedQty: 0,
          binId: line.binId || null,
          batchId,
        });
      }

      // 5. Update the GRN header and lines
      let nextStatus = original.status;
      if (original.status !== GrnStatus.POSTED) {
        nextStatus = anyQcRequired ? GrnStatus.QC_PENDING : GrnStatus.DRAFT;
      }

      const updatedGrn = await tx.grn.update({
        where: { id },
        data: {
          storeId: data.storeId,
          dcNo: data.dcNo || null,
          dcDate: data.dcDate ? new Date(data.dcDate) : null,
          invoiceNo: data.invoiceNo || null,
          status: nextStatus,
          lines: {
            create: lineCreates
          }
        },
        include: {
          lines: true
        }
      });

      // 6. If QC items exist, create inspections
      if (nextStatus === GrnStatus.QC_PENDING) {
        for (const line of updatedGrn.lines) {
          const qcReq = qcRequiredMap.get(line.itemId) === true;
          if (qcReq) {
            const inspPlan = await tx.inspectionPlan.findUnique({
              where: { itemId: line.itemId },
              include: { params: true }
            });

            const inspNumber = await getNextSequence(companyId, "INSP");
            
            await tx.inspection.create({
              data: {
                companyId,
                number: inspNumber,
                grnId: id,
                grnLineId: line.id,
                itemId: line.itemId,
                sampleSize: inspPlan?.sampleSize || 1,
                results: {
                  create: (inspPlan?.params || []).map((p: any) => ({
                    paramName: p.name,
                  }))
                }
              }
            });
          }
        }
      }

      // 7. If POSTED, write new stock ledger entries and update PO line received quantities
      if (updatedGrn.status === GrnStatus.POSTED) {
        for (const line of updatedGrn.lines) {
          if (line.acceptedQty <= 0) continue;

          let poRate = 0;
          if (line.poLineId) {
            const poLine = await tx.poLine.findUnique({
              where: { id: line.poLineId }
            });
            if (poLine) {
              poRate = poLine.rate;
              const newReceived = poLine.receivedQty + line.acceptedQty;
              await tx.poLine.update({
                where: { id: line.poLineId },
                data: { receivedQty: newReceived }
              });
            }
          }

          await postLedgerEntry(tx, {
            companyId,
            itemId: line.itemId,
            storeId: updatedGrn.storeId,
            binId: line.binId,
            batchId: line.batchId,
            txnType: LedgerTxnType.GRN_RECEIPT,
            qty: line.acceptedQty,
            rate: poRate || null,
            refType: "GRN",
            refId: updatedGrn.id,
            createdById: actorId,
          });
        }

        // Recalculate parent PO status
        if (updatedGrn.poId) {
          const poLines = await tx.poLine.findMany({
            where: { poId: updatedGrn.poId }
          });
          const allReceived = poLines.every(l => l.receivedQty >= l.qty);
          const anyReceived = poLines.some(l => l.receivedQty > 0);

          const nextPoStatus = allReceived 
            ? PoStatus.RECEIVED 
            : (anyReceived ? PoStatus.PARTIALLY_RECEIVED : PoStatus.APPROVED);

          await tx.purchaseOrder.update({
            where: { id: updatedGrn.poId },
            data: { status: nextPoStatus }
          });
        }
      }

      // 8. Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "UPDATE_GRN",
          entity: "Grn",
          entityId: id,
          before: original as any,
          after: updatedGrn as any
        }
      });

      return updatedGrn;
    });

    revalidatePath("/stores/grn");
    revalidatePath("/stores/inspection");
    revalidatePath("/purchase/po");
    revalidatePath("/stores/reports");
    return { success: true, grn: result };
  } catch (err: any) {
    console.error("Error updating GRN:", err);
    return { success: false, error: err.message || "Failed to update GRN" };
  }
}

export async function deleteGrn(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.grn.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true }
    });

    if (!original) return { success: false, error: "GRN not found" };

    await db.$transaction(async (tx) => {
      // 1. If POSTED, revert stock ledger entries and PO quantities
      if (original.status === GrnStatus.POSTED) {
        // Delete stock ledger entries
        await tx.stockLedger.deleteMany({
          where: { companyId, refType: "GRN", refId: id }
        });

        // Revert PO line received quantities
        if (original.poId) {
          for (const line of original.lines) {
            if (line.poLineId && line.acceptedQty > 0) {
              const poLine = await tx.poLine.findUnique({
                where: { id: line.poLineId }
              });
              if (poLine) {
                const revertedQty = Math.max(0, poLine.receivedQty - line.acceptedQty);
                await tx.poLine.update({
                  where: { id: line.poLineId },
                  data: { receivedQty: revertedQty }
                });
              }
            }
          }

          // Recalculate parent PO status
          const poLines = await tx.poLine.findMany({
            where: { poId: original.poId }
          });
          const allReceived = poLines.every(l => l.receivedQty >= l.qty);
          const anyReceived = poLines.some(l => l.receivedQty > 0);

          const nextPoStatus = allReceived 
            ? PoStatus.RECEIVED 
            : (anyReceived ? PoStatus.PARTIALLY_RECEIVED : PoStatus.APPROVED);

          await tx.purchaseOrder.update({
            where: { id: original.poId },
            data: { status: nextPoStatus }
          });
        }
      }

      // 2. Delete inspections and inspection results
      const inspections = await tx.inspection.findMany({
        where: { grnId: id, companyId }
      });
      const inspIds = inspections.map(i => i.id);
      if (inspIds.length > 0) {
        await tx.inspectionResult.deleteMany({
          where: { inspectionId: { in: inspIds } }
        });
        await tx.inspection.deleteMany({
          where: { id: { in: inspIds } }
        });
      }

      // 3. Delete any rejected material records associated with this GRN
      await tx.rejectedMaterial.deleteMany({
        where: { grnNumber: original.number, companyId }
      });

      // 4. Soft delete the GRN
      const updated = await tx.grn.update({
        where: { id },
        data: { deletedAt: new Date() }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "DELETE_GRN",
          entity: "Grn",
          entityId: id,
          before: original as any,
          after: updated as any
        }
      });
    });

    revalidatePath("/stores/grn");
    revalidatePath("/purchase/po");
    revalidatePath("/stores/reports");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting GRN:", err);
    return { success: false, error: err.message || "Failed to delete GRN" };
  }
}

export async function bulkDeleteGrns(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  try {
    for (const id of ids) {
      const res = await deleteGrn(id);
      if (!res.success) {
        throw new Error(`Failed to delete GRN ${id}: ${res.error}`);
      }
    }
    return { success: true };
  } catch (err: any) {
    console.error("Error bulk deleting GRNs:", err);
    return { success: false, error: err.message || "Failed to bulk delete GRNs" };
  }
}
