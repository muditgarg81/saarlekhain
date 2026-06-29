"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CustomerStatus, CustomerType } from "@prisma/client";

// Customer master — the debtor-side mirror of the Vendor master.
const customerSchema = z.object({
  name: z.string().min(2, "Customer name must be at least 2 characters"),
  code: z.string().optional(),
  type: z.nativeEnum(CustomerType).default(CustomerType.B2B),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN format")
    .optional()
    .nullable()
    .or(z.literal("")),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format")
    .optional()
    .nullable()
    .or(z.literal("")),
  stateCode: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable().or(z.literal("")),
  shippingAddress: z.string().optional().nullable().or(z.literal("")),
  contactPerson: z.string().optional().nullable(),
  contactEmail: z.string().email("Invalid email").optional().nullable().or(z.literal("")),
  contactPhone: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  creditDays: z.number().int().nonnegative().default(0),
  creditLimit: z.number().nonnegative().default(0),
  tcsApplicable: z.boolean().default(false),
  bankDetails: z
    .object({
      bankName: z.string().optional(),
      accountNo: z.string().optional(),
      ifsc: z.string().optional(),
      branch: z.string().optional(),
    })
    .optional()
    .nullable(),
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

// Derive the GST state code from the leading 2 digits of a GSTIN.
function stateFromGstin(gstin?: string | null): string | null {
  if (gstin && gstin.length >= 2) return gstin.slice(0, 2);
  return null;
}

export async function createCustomer(data: z.infer<typeof customerSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = customerSchema.parse(data);

    let code = validated.code?.trim();
    if (!code) {
      const count = await db.customer.count({ where: { companyId } });
      code = `CUST-${String(count + 1).padStart(5, "0")}`;
    }

    const exists = await db.customer.findFirst({ where: { companyId, code } });
    if (exists) {
      return { success: false, error: `Customer code '${code}' already exists` };
    }

    const result = await db.$transaction(async (tx) => {
      const newCustomer = await tx.customer.create({
        data: {
          companyId,
          code,
          name: validated.name,
          type: validated.type,
          gstin: validated.gstin || null,
          pan: validated.pan || null,
          stateCode: validated.stateCode || stateFromGstin(validated.gstin),
          billingAddress: validated.billingAddress || null,
          shippingAddress: validated.shippingAddress || null,
          contactPerson: validated.contactPerson || null,
          contactEmail: validated.contactEmail || null,
          contactPhone: validated.contactPhone || null,
          paymentTerms: validated.paymentTerms || null,
          creditDays: validated.creditDays,
          creditLimit: validated.creditLimit,
          tcsApplicable: validated.tcsApplicable,
          bankDetails: (validated.bankDetails || null) as any,
          status: CustomerStatus.PENDING_APPROVAL,
        },
      });

      await logAudit(tx, companyId, actorId, "CREATE", "Customer", newCustomer.id, null, newCustomer);
      return newCustomer;
    });

    revalidatePath("/sales/customers");
    return { success: true, customer: result };
  } catch (err: any) {
    console.error("Error creating customer:", err);
    return { success: false, error: err.message || "Failed to create customer" };
  }
}

export async function updateCustomer(
  id: string,
  data: z.infer<typeof customerSchema> & { code: string }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = customerSchema.parse(data);

    const original = await db.customer.findFirst({ where: { id, companyId } });
    if (!original) return { success: false, error: "Customer not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: {
          name: validated.name,
          code: data.code.trim(),
          type: validated.type,
          gstin: validated.gstin || null,
          pan: validated.pan || null,
          stateCode: validated.stateCode || stateFromGstin(validated.gstin),
          billingAddress: validated.billingAddress || null,
          shippingAddress: validated.shippingAddress || null,
          contactPerson: validated.contactPerson || null,
          contactEmail: validated.contactEmail || null,
          contactPhone: validated.contactPhone || null,
          paymentTerms: validated.paymentTerms || null,
          creditDays: validated.creditDays,
          creditLimit: validated.creditLimit,
          tcsApplicable: validated.tcsApplicable,
          bankDetails: (validated.bankDetails || null) as any,
        },
      });

      await logAudit(tx, companyId, actorId, "UPDATE", "Customer", id, original, updated);
      return updated;
    });

    revalidatePath("/sales/customers");
    return { success: true, customer: result };
  } catch (err: any) {
    console.error("Error updating customer:", err);
    return { success: false, error: err.message || "Failed to update customer" };
  }
}

export async function updateCustomerStatus(id: string, status: CustomerStatus) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const customer = await db.customer.findFirst({ where: { id, companyId } });
    if (!customer) return { success: false, error: "Customer not found" };

    await db.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { status } });
      await logAudit(
        tx,
        companyId,
        actorId,
        "STATUS_CHANGE",
        "Customer",
        id,
        { status: customer.status },
        { status }
      );
    });

    revalidatePath("/sales/customers");
    return { success: true, status };
  } catch (err: any) {
    console.error("Error updating customer status:", err);
    return { success: false, error: err.message || "Failed to update status" };
  }
}

export async function deleteCustomer(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const customer = await db.customer.findFirst({ where: { id, companyId } });
    if (!customer) return { success: false, error: "Customer not found" };

    await db.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await logAudit(tx, companyId, actorId, "DELETE", "Customer", id, customer, updated);
    });

    revalidatePath("/sales/customers");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting customer:", err);
    return { success: false, error: err.message || "Failed to delete customer" };
  }
}

const customerImportSchema = z.object({
  name: z.string().min(2, "Customer name must be at least 2 characters"),
  code: z.string().optional().nullable(),
  type: z.nativeEnum(CustomerType).optional(),
  gstin: z.string().optional().nullable(),
  pan: z.string().optional().nullable(),
  stateCode: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  shippingAddress: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  creditDays: z.number().int().nonnegative().default(0),
  creditLimit: z.number().nonnegative().default(0),
  tcsApplicable: z.boolean().default(false),
});

export async function bulkCreateCustomers(
  customersList: Array<z.infer<typeof customerImportSchema>>
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const result = await db.$transaction(
      async (tx) => {
        const existing = await tx.customer.findMany({
          where: { companyId },
          select: { id: true, code: true, deletedAt: true },
        });
        const existingMap = new Map<string, { id: string; code: string; deletedAt: Date | null }>(
          existing.map((c) => [c.code.toUpperCase(), c])
        );

        const created: any[] = [];
        const validationErrors: string[] = [];

        for (let idx = 0; idx < customersList.length; idx++) {
          const row = customersList[idx];

          let code = row.code?.trim();
          if (!code) {
            const count = await tx.customer.count({ where: { companyId } });
            code = `CUST-${String(count + created.length + 1).padStart(5, "0")}`;
          }

          const dup = existingMap.get(code.toUpperCase());
          if (dup) {
            if (dup.deletedAt === null) {
              validationErrors.push(`Row ${idx + 2}: Customer code '${code}' already exists`);
              continue;
            }
            const restored = await tx.customer.update({
              where: { id: dup.id },
              data: {
                deletedAt: null,
                status: CustomerStatus.PENDING_APPROVAL,
                name: row.name,
                type: row.type ?? CustomerType.B2B,
                gstin: row.gstin || null,
                pan: row.pan || null,
                stateCode: row.stateCode || stateFromGstin(row.gstin),
                billingAddress: row.billingAddress || null,
                shippingAddress: row.shippingAddress || null,
                contactPerson: row.contactPerson || null,
                contactEmail: row.contactEmail || null,
                contactPhone: row.contactPhone || null,
                paymentTerms: row.paymentTerms || null,
                creditDays: row.creditDays ?? 0,
                creditLimit: row.creditLimit ?? 0,
                tcsApplicable: row.tcsApplicable ?? false,
              },
            });
            await logAudit(tx, companyId, actorId, "RESTORE", "Customer", restored.id, dup, restored);
            existingMap.set(code.toUpperCase(), { id: restored.id, code, deletedAt: null });
            created.push(restored);
            continue;
          }

          const newCustomer = await tx.customer.create({
            data: {
              companyId,
              code,
              name: row.name,
              type: row.type ?? CustomerType.B2B,
              gstin: row.gstin || null,
              pan: row.pan || null,
              stateCode: row.stateCode || stateFromGstin(row.gstin),
              billingAddress: row.billingAddress || null,
              shippingAddress: row.shippingAddress || null,
              contactPerson: row.contactPerson || null,
              contactEmail: row.contactEmail || null,
              contactPhone: row.contactPhone || null,
              paymentTerms: row.paymentTerms || null,
              creditDays: row.creditDays ?? 0,
              creditLimit: row.creditLimit ?? 0,
              tcsApplicable: row.tcsApplicable ?? false,
              status: CustomerStatus.PENDING_APPROVAL,
            },
          });
          await logAudit(tx, companyId, actorId, "CREATE", "Customer", newCustomer.id, null, newCustomer);
          existingMap.set(code.toUpperCase(), { id: newCustomer.id, code, deletedAt: null });
          created.push(newCustomer);
        }

        if (validationErrors.length > 0) {
          throw new Error(validationErrors.join("\n"));
        }
        return created;
      },
      { maxWait: 15000, timeout: 60000 }
    );

    revalidatePath("/sales/customers");
    return { success: true, count: result.length, customers: result };
  } catch (err: any) {
    console.error("Error bulk creating customers:", err);
    return { success: false, error: err.message || "Failed to bulk create customers" };
  }
}
