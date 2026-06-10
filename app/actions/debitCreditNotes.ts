"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getNextSequence } from "@/lib/sequences";
import { NoteType } from "@prisma/client";
import { recalculateInvoiceMatchStatus } from "./invoices";

export async function postDebitCreditNote(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.debitCreditNote.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Debit/Credit Note not found" };
    if (original.posted) return { success: false, error: "Note is already posted" };

    const updated = await db.$transaction(async (tx) => {
      const note = await tx.debitCreditNote.update({
        where: { id },
        data: { posted: true }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "POST_DEBIT_CREDIT_NOTE",
          entity: "DebitCreditNote",
          entityId: id,
          before: original as any,
          after: note as any
        }
      });

      // Recalculate Invoice Match Status if linked to GRN Rejection
      if (note.refType === "GRN_REJECTION" && note.refId) {
        const rejectedMaterial = await tx.rejectedMaterial.findUnique({
          where: { id: note.refId }
        });
        if (rejectedMaterial) {
          const grnLine = await tx.grnLine.findUnique({
            where: { id: rejectedMaterial.grnLineId },
            include: { grn: true }
          });
          if (grnLine?.grn?.poId) {
            await recalculateInvoiceMatchStatus(tx, companyId, grnLine.grn.poId);
          }
        }
      }

      return note;
    });

    revalidatePath("/purchase/debit-notes");
    revalidatePath("/purchase/invoices");
    return { success: true, note: updated };
  } catch (err: any) {
    console.error("Error posting note:", err);
    return { success: false, error: err.message || "Failed to post note" };
  }
}

export async function createDebitNote(data: {
  vendorId: string;
  amount: number;
  refType?: string | null;
  refId?: string | null;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const number = await getNextSequence(companyId, "DN");
    
    const result = await db.$transaction(async (tx) => {
      const note = await tx.debitCreditNote.create({
        data: {
          companyId,
          number,
          type: NoteType.DEBIT,
          vendorId: data.vendorId,
          refType: data.refType || "MANUAL",
          refId: data.refId || null,
          amount: data.amount,
          posted: false
        }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "CREATE_DEBIT_CREDIT_NOTE",
          entity: "DebitCreditNote",
          entityId: note.id,
          before: undefined,
          after: note as any
        }
      });

      return note;
    });

    revalidatePath("/purchase/debit-notes");
    return { success: true, note: result };
  } catch (err: any) {
    console.error("Error creating debit note:", err);
    return { success: false, error: err.message || "Failed to create debit note" };
  }
}

export async function updateDebitNote(id: string, data: {
  vendorId: string;
  amount: number;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.debitCreditNote.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Debit Note not found" };
    if (original.posted) return { success: false, error: "Cannot edit a posted Debit Note" };

    const updated = await db.$transaction(async (tx) => {
      const note = await tx.debitCreditNote.update({
        where: { id },
        data: {
          vendorId: data.vendorId,
          amount: data.amount
        }
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "UPDATE_DEBIT_CREDIT_NOTE",
          entity: "DebitCreditNote",
          entityId: id,
          before: original as any,
          after: note as any
        }
      });

      return note;
    });

    revalidatePath("/purchase/debit-notes");
    return { success: true, note: updated };
  } catch (err: any) {
    console.error("Error updating debit note:", err);
    return { success: false, error: err.message || "Failed to update debit note" };
  }
}

export async function deleteDebitNote(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.debitCreditNote.findFirst({
      where: { id, companyId }
    });

    if (!original) return { success: false, error: "Debit Note not found" };
    if (original.posted) return { success: false, error: "Cannot delete a posted Debit Note" };

    await db.$transaction(async (tx) => {
      await tx.debitCreditNote.delete({
        where: { id }
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "DELETE_DEBIT_CREDIT_NOTE",
          entity: "DebitCreditNote",
          entityId: id,
          before: original as any,
          after: undefined
        }
      });
    });

    revalidatePath("/purchase/debit-notes");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting debit note:", err);
    return { success: false, error: err.message || "Failed to delete debit note" };
  }
}

export async function bulkPostDebitNotes(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const notes = await db.debitCreditNote.findMany({
      where: { id: { in: ids }, companyId }
    });

    if (notes.length !== ids.length) return { success: false, error: "Some notes could not be found" };
    if (notes.some(n => n.posted)) return { success: false, error: "Some selected notes are already posted" };

    await db.$transaction(async (tx) => {
      await tx.debitCreditNote.updateMany({
        where: { id: { in: ids } },
        data: { posted: true }
      });

      for (const note of notes) {
        const afterNote = { ...note, posted: true };
        await tx.auditLog.create({
          data: {
            companyId,
            actorId,
            action: "POST_DEBIT_CREDIT_NOTE",
            entity: "DebitCreditNote",
            entityId: note.id,
            before: note as any,
            after: afterNote as any
          }
        });
      }

      // Recalculate Invoice Match Status for all unique linked POs
      const poIdsToRecalculate = new Set<string>();
      for (const note of notes) {
        if (note.refType === "GRN_REJECTION" && note.refId) {
          const rejectedMaterial = await tx.rejectedMaterial.findUnique({
            where: { id: note.refId }
          });
          if (rejectedMaterial) {
            const grnLine = await tx.grnLine.findUnique({
              where: { id: rejectedMaterial.grnLineId },
              include: { grn: true }
            });
            if (grnLine?.grn?.poId) {
              poIdsToRecalculate.add(grnLine.grn.poId);
            }
          }
        }
      }

      for (const poId of poIdsToRecalculate) {
        await recalculateInvoiceMatchStatus(tx, companyId, poId);
      }
    });

    revalidatePath("/purchase/debit-notes");
    revalidatePath("/purchase/invoices");
    return { success: true };
  } catch (err: any) {
    console.error("Error bulk posting notes:", err);
    return { success: false, error: err.message || "Failed to bulk post notes" };
  }
}

export async function bulkDeleteDebitNotes(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const notes = await db.debitCreditNote.findMany({
      where: { id: { in: ids }, companyId }
    });

    if (notes.length !== ids.length) return { success: false, error: "Some notes could not be found" };
    if (notes.some(n => n.posted)) return { success: false, error: "Cannot delete posted notes" };

    await db.$transaction(async (tx) => {
      await tx.debitCreditNote.deleteMany({
        where: { id: { in: ids } }
      });

      for (const note of notes) {
        await tx.auditLog.create({
          data: {
            companyId,
            actorId,
            action: "DELETE_DEBIT_CREDIT_NOTE",
            entity: "DebitCreditNote",
            entityId: note.id,
            before: note as any,
            after: undefined
          }
        });
      }
    });

    revalidatePath("/purchase/debit-notes");
    return { success: true };
  } catch (err: any) {
    console.error("Error bulk deleting notes:", err);
    return { success: false, error: err.message || "Failed to bulk delete notes" };
  }
}
