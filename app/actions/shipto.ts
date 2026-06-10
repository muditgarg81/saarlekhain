"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const locationSchema = z.object({
  code: z.string().min(1, "Location Code is required").max(10, "Code is too long"),
  name: z.string().min(1, "Location Name is required"),
  address: z.string().min(1, "Address details are required"),
  gstin: z.string().optional().nullable(),
});

async function logAudit(
  tx: any,
  companyId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any
) {
  await tx.auditLog.create({
    data: {
      companyId,
      actorId,
      action,
      entity,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    },
  });
}

export async function createShipToLocation(data: z.infer<typeof locationSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = locationSchema.parse(data);

    // Check code uniqueness within the company
    const existing = await db.shipToLocation.findFirst({
      where: { companyId, code: validated.code.toUpperCase() }
    });
    if (existing) {
      return { success: false, error: "Location Code already exists in this company." };
    }

    const result = await db.$transaction(async (tx) => {
      const loc = await tx.shipToLocation.create({
        data: {
          companyId,
          code: validated.code.toUpperCase(),
          name: validated.name,
          address: validated.address,
          gstin: validated.gstin || null,
        }
      });

      await logAudit(tx, companyId, actorId, "CREATE", "ShipToLocation", loc.id, null, loc);
      return loc;
    });

    revalidatePath("/purchase/shipto");
    return { success: true, location: result };
  } catch (err: any) {
    console.error("Error creating location:", err);
    return { success: false, error: err.message || "Failed to create location" };
  }
}

export async function deleteShipToLocation(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.shipToLocation.findFirst({
      where: { id, companyId }
    });
    if (!original) return { success: false, error: "Location not found" };

    await db.$transaction(async (tx) => {
      await tx.shipToLocation.delete({
        where: { id }
      });
      await logAudit(tx, companyId, actorId, "DELETE", "ShipToLocation", id, original, null);
    });

    revalidatePath("/purchase/shipto");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting location:", err);
    return { success: false, error: err.message || "Failed to delete location" };
  }
}
