"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VendorStatus } from "@prisma/client";

const vendorSchema = z.object({
  name: z.string().min(2, "Vendor name must be at least 2 characters"),
  code: z.string().optional(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN format").optional().nullable().or(z.literal("")),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format").optional().nullable().or(z.literal("")),
  udyamNo: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  creditDays: z.number().int().nonnegative().default(0),
  tdsApplicable: z.boolean().default(false),
  bankDetails: z.object({
    bankName: z.string().optional(),
    accountNo: z.string().optional(),
    ifsc: z.string().optional(),
    branch: z.string().optional(),
  }).optional().nullable(),
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

export async function createVendor(data: z.infer<typeof vendorSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = vendorSchema.parse(data);

    let code = validated.code?.trim();
    if (!code) {
      // Auto-generate code like VND-00001
      const count = await db.vendor.count({ where: { companyId } });
      code = `VND-${String(count + 1).padStart(5, "0")}`;
    }

    // Check for uniqueness
    const exists = await db.vendor.findFirst({
      where: { companyId, code }
    });
    if (exists) {
      return { success: false, error: `Vendor code '${code}' already exists` };
    }

    const result = await db.$transaction(async (tx) => {
      const newVendor = await tx.vendor.create({
        data: {
          companyId,
          code,
          name: validated.name,
          gstin: validated.gstin || null,
          pan: validated.pan || null,
          udyamNo: validated.udyamNo || null,
          category: validated.category || null,
          paymentTerms: validated.paymentTerms || null,
          creditDays: validated.creditDays,
          tdsApplicable: validated.tdsApplicable,
          bankDetails: (validated.bankDetails || null) as any,
          status: VendorStatus.PENDING_APPROVAL,
        }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "CREATE",
        "Vendor",
        newVendor.id,
        null,
        newVendor
      );

      return newVendor;
    });

    revalidatePath("/purchase/vendors");
    return { success: true, vendor: result };
  } catch (err: any) {
    console.error("Error creating vendor:", err);
    return { success: false, error: err.message || "Failed to create vendor" };
  }
}

export async function updateVendor(
  id: string,
  data: z.infer<typeof vendorSchema> & { code: string }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = vendorSchema.parse(data);

    const original = await db.vendor.findFirst({
      where: { id, companyId }
    });
    if (!original) return { success: false, error: "Vendor not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.vendor.update({
        where: { id },
        data: {
          name: validated.name,
          code: data.code.trim(),
          gstin: validated.gstin || null,
          pan: validated.pan || null,
          udyamNo: validated.udyamNo || null,
          category: validated.category || null,
          paymentTerms: validated.paymentTerms || null,
          creditDays: validated.creditDays,
          tdsApplicable: validated.tdsApplicable,
          bankDetails: (validated.bankDetails || null) as any,
        }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "UPDATE",
        "Vendor",
        id,
        original,
        updated
      );

      return updated;
    });

    revalidatePath("/purchase/vendors");
    return { success: true, vendor: result };
  } catch (err: any) {
    console.error("Error updating vendor:", err);
    return { success: false, error: err.message || "Failed to update vendor" };
  }
}

export async function updateVendorStatus(id: string, status: VendorStatus) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const vendor = await db.vendor.findFirst({
      where: { id, companyId }
    });
    if (!vendor) return { success: false, error: "Vendor not found" };

    await db.$transaction(async (tx) => {
      await tx.vendor.update({
        where: { id },
        data: { status }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "STATUS_CHANGE",
        "Vendor",
        id,
        { status: vendor.status },
        { status }
      );
    });

    revalidatePath("/purchase/vendors");
    return { success: true, status };
  } catch (err: any) {
    console.error("Error updating vendor status:", err);
    return { success: false, error: err.message || "Failed to update status" };
  }
}

export async function deleteVendor(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const vendor = await db.vendor.findFirst({
      where: { id, companyId }
    });
    if (!vendor) return { success: false, error: "Vendor not found" };

    await db.$transaction(async (tx) => {
      const updated = await tx.vendor.update({
        where: { id },
        data: { deletedAt: new Date() }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "DELETE",
        "Vendor",
        id,
        vendor,
        updated
      );
    });

    revalidatePath("/purchase/vendors");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting vendor:", err);
    return { success: false, error: err.message || "Failed to delete vendor" };
  }
}
