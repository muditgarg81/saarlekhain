"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VendorStatus } from "@prisma/client";

const vendorSchema = z.object({
  name: z.string().min(2, "Vendor name must be at least 2 characters"),
  code: z.string().optional(),
  address: z.string().optional().nullable().or(z.literal("")),
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
          address: validated.address || null,
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
          address: validated.address || null,
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

const bankDetailsSchema = z.object({
  bankName: z.string().optional().nullable(),
  accountNo: z.string().optional().nullable(),
  ifsc: z.string().optional().nullable(),
  branch: z.string().optional().nullable(),
}).optional().nullable();

const vendorImportSchema = z.object({
  name: z.string().min(2, "Vendor name must be at least 2 characters"),
  code: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  pan: z.string().optional().nullable(),
  udyamNo: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  creditDays: z.number().int().nonnegative().default(0),
  tdsApplicable: z.boolean().default(false),
  bankDetails: bankDetailsSchema,
});

export async function bulkCreateVendors(vendorsList: Array<z.infer<typeof vendorImportSchema>>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const result = await db.$transaction(async (tx) => {
      // Fetch all existing vendors for uniqueness and soft-delete mapping
      const existingVendors = await tx.vendor.findMany({
        where: { companyId },
        select: { id: true, code: true, deletedAt: true }
      });
      // Map uppercase code -> existing vendor record
      const existingVendorsMap = new Map<string, { id: string; code: string; deletedAt: Date | null }>(
        existingVendors.map(v => [v.code.toUpperCase(), v])
      );

      const createdVendors = [];
      const validationErrors: string[] = [];

      for (let idx = 0; idx < vendorsList.length; idx++) {
        const vendorData = vendorsList[idx];

        // Resolve vendor code
        let code = vendorData.code?.trim();
        if (!code) {
          const count = await tx.vendor.count({ where: { companyId } });
          code = `VND-${String(count + createdVendors.length + 1).padStart(5, "0")}`;
        }

        // Check for uniqueness
        const existingVendor = existingVendorsMap.get(code.toUpperCase());
        if (existingVendor) {
          if (existingVendor.deletedAt === null) {
            validationErrors.push(`Row ${idx + 2}: Vendor code '${code}' already exists`);
            continue;
          }
          
          // Restore and update soft-deleted vendor
          let restoredVendor: any;
          restoredVendor = await tx.vendor.update({
            where: { id: existingVendor.id },
            data: {
              deletedAt: null,
              status: VendorStatus.PENDING_APPROVAL,
              name: vendorData.name,
              address: vendorData.address || null,
              gstin: vendorData.gstin || null,
              pan: vendorData.pan || null,
              udyamNo: vendorData.udyamNo || null,
              category: vendorData.category || null,
              paymentTerms: vendorData.paymentTerms || null,
              creditDays: vendorData.creditDays ?? 0,
              tdsApplicable: vendorData.tdsApplicable ?? false,
              bankDetails: (vendorData.bankDetails || null) as any,
            }
          });

          await logAudit(
            tx,
            companyId,
            actorId,
            "RESTORE",
            "Vendor",
            restoredVendor.id,
            existingVendor,
            restoredVendor
          );

          // Update cache map to mark it active
          existingVendorsMap.set(code.toUpperCase(), { id: restoredVendor.id, code, deletedAt: null });
          createdVendors.push(restoredVendor);
          continue;
        }

        let newVendor: any;
        newVendor = await tx.vendor.create({
          data: {
            companyId,
            code,
            name: vendorData.name,
            address: vendorData.address || null,
            gstin: vendorData.gstin || null,
            pan: vendorData.pan || null,
            udyamNo: vendorData.udyamNo || null,
            category: vendorData.category || null,
            paymentTerms: vendorData.paymentTerms || null,
            creditDays: vendorData.creditDays ?? 0,
            tdsApplicable: vendorData.tdsApplicable ?? false,
            bankDetails: (vendorData.bankDetails || null) as any,
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

        // Add to cache map
        existingVendorsMap.set(code.toUpperCase(), { id: newVendor.id, code, deletedAt: null });
        createdVendors.push(newVendor);
      }

      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join("\n"));
      }

      return createdVendors;
    }, {
      maxWait: 15000,
      timeout: 60000
    });

    revalidatePath("/purchase/vendors");
    return { success: true, count: result.length, vendors: result };
  } catch (err: any) {
    console.error("Error bulk creating vendors:", err);
    return { success: false, error: err.message || "Failed to bulk create vendors" };
  }
}

