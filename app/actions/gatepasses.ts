"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { revalidatePath } from "next/cache";
import { GatePassType, GatePassStatus } from "@prisma/client";

interface GatePassLineInput {
  itemId: string;
  qty: number;
}

export async function createGatePass(data: {
  type: GatePassType;
  vendorId?: string | null;
  purpose?: string | null;
  dueBack?: string | null;
  lines: GatePassLineInput[];
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    if (!data.lines || data.lines.length === 0) {
      return { success: false, error: "Gate pass must contain at least one line item" };
    }

    const number = await getNextSequence(companyId, "GP");

    const result = await db.$transaction(async (tx) => {
      const gp = await tx.gatePass.create({
        data: {
          companyId,
          number,
          type: data.type,
          vendorId: data.vendorId || null,
          purpose: data.purpose || null,
          dueBack: data.dueBack ? new Date(data.dueBack) : null,
          status: GatePassStatus.OPEN,
          createdById: actorId,
          lines: {
            create: data.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              returnedQty: 0,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "CREATE",
          entity: "GatePass",
          entityId: gp.id,
          after: JSON.parse(JSON.stringify(gp)),
        },
      });

      return gp;
    });

    revalidatePath("/stores/outwards");
    return { success: true, gatePass: result };
  } catch (err: any) {
    console.error("Error creating gate pass:", err);
    return { success: false, error: err.message || "Failed to create gate pass" };
  }
}

export async function returnGatePassMaterial(
  gatePassId: string,
  returns: { lineId: string; qtyReturned: number }[]
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const gp = await db.gatePass.findFirst({
      where: { id: gatePassId, companyId },
      include: { lines: true }
    });
    if (!gp) return { success: false, error: "Gate pass not found" };
    if (gp.type !== GatePassType.RETURNABLE) {
      return { success: false, error: "Only returnable gate passes support returns" };
    }

    const result = await db.$transaction(async (tx) => {
      let allLinesReturned = true;

      for (const ret of returns) {
        if (ret.qtyReturned <= 0) continue;

        const line = gp.lines.find(l => l.id === ret.lineId);
        if (!line) throw new Error("Gate pass line not found");

        const newReturnedQty = line.returnedQty + ret.qtyReturned;
        if (newReturnedQty > line.qty) {
          throw new Error("Cannot return more than the issued quantity");
        }

        // Update returned qty
        await tx.gatePassLine.update({
          where: { id: ret.lineId },
          data: { returnedQty: newReturnedQty }
        });

        if (newReturnedQty < line.qty) {
          allLinesReturned = false;
        }
      }

      // Check remaining lines
      for (const line of gp.lines) {
        const isCurrentlyReturning = returns.find(r => r.lineId === line.id);
        const currentTotal = line.returnedQty + (isCurrentlyReturning?.qtyReturned || 0);
        if (currentTotal < line.qty) {
          allLinesReturned = false;
        }
      }

      // Update parent status
      const nextStatus = allLinesReturned ? GatePassStatus.RETURNED : GatePassStatus.PARTIALLY_RETURNED;
      const updatedGp = await tx.gatePass.update({
        where: { id: gatePassId },
        data: { status: nextStatus }
      });

      // Log audit
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "RETURN_GATEPASS",
          entity: "GatePass",
          entityId: gatePassId,
          after: JSON.parse(JSON.stringify(updatedGp))
        }
      });

      return updatedGp;
    });

    revalidatePath("/stores/outwards");
    return { success: true, gatePass: result };
  } catch (err: any) {
    console.error("Error logging gate pass return:", err);
    return { success: false, error: err.message || "Failed to log return" };
  }
}

export async function updateGatePass(
  id: string,
  data: {
    type: GatePassType;
    vendorId?: string | null;
    purpose?: string | null;
    dueBack?: string | null;
    lines: GatePassLineInput[];
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.gatePass.findFirst({
      where: { id, companyId },
      include: { lines: true }
    });

    if (!original) return { success: false, error: "Gate pass not found" };
    if (original.status !== GatePassStatus.OPEN) {
      return { success: false, error: "Only open gate passes can be modified" };
    }

    if (!data.lines || data.lines.length === 0) {
      return { success: false, error: "Gate pass must contain at least one line item" };
    }

    const result = await db.$transaction(async (tx) => {
      // Delete existing lines
      await tx.gatePassLine.deleteMany({
        where: { gatePassId: id }
      });

      // Update gate pass
      const gp = await tx.gatePass.update({
        where: { id },
        data: {
          type: data.type,
          vendorId: data.vendorId || null,
          purpose: data.purpose || null,
          dueBack: data.dueBack ? new Date(data.dueBack) : null,
          lines: {
            create: data.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              returnedQty: 0,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      // Log Audit
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "UPDATE",
          entity: "GatePass",
          entityId: gp.id,
          before: JSON.parse(JSON.stringify(original)),
          after: JSON.parse(JSON.stringify(gp)),
        },
      });

      return gp;
    });

    revalidatePath("/stores/outwards");
    return { success: true, gatePass: result };
  } catch (err: any) {
    console.error("Error updating gate pass:", err);
    return { success: false, error: err.message || "Failed to update gate pass" };
  }
}

export async function deleteGatePass(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.gatePass.findFirst({
      where: { id, companyId },
      include: { lines: true }
    });

    if (!original) return { success: false, error: "Gate pass not found" };
    if (original.status !== GatePassStatus.OPEN) {
      return { success: false, error: "Only open gate passes can be deleted" };
    }

    await db.$transaction(async (tx) => {
      // Delete lines
      await tx.gatePassLine.deleteMany({
        where: { gatePassId: id }
      });

      // Delete parent
      await tx.gatePass.delete({
        where: { id }
      });

      // Log Audit
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "DELETE",
          entity: "GatePass",
          entityId: id,
          before: JSON.parse(JSON.stringify(original)),
        },
      });
    });

    revalidatePath("/stores/outwards");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting gate pass:", err);
    return { success: false, error: err.message || "Failed to delete gate pass" };
  }
}

export async function bulkDeleteGatePasses(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const gatePasses = await db.gatePass.findMany({
      where: { id: { in: ids }, companyId },
      include: { lines: true }
    });

    if (gatePasses.length !== ids.length) {
      return { success: false, error: "Some gate passes could not be found" };
    }

    if (gatePasses.some(gp => gp.status !== GatePassStatus.OPEN)) {
      return { success: false, error: "Only open gate passes can be deleted" };
    }

    await db.$transaction(async (tx) => {
      // Delete lines in bulk
      await tx.gatePassLine.deleteMany({
        where: { gatePassId: { in: ids } }
      });

      // Delete parents in bulk
      await tx.gatePass.deleteMany({
        where: { id: { in: ids } }
      });

      // Log Audit for each
      for (const gp of gatePasses) {
        await tx.auditLog.create({
          data: {
            companyId,
            actorId,
            action: "DELETE",
            entity: "GatePass",
            entityId: gp.id,
            before: JSON.parse(JSON.stringify(gp)),
          },
        });
      }
    });

    revalidatePath("/stores/outwards");
    return { success: true };
  } catch (err: any) {
    console.error("Error bulk deleting gate passes:", err);
    return { success: false, error: err.message || "Failed to bulk delete gate passes" };
  }
}
