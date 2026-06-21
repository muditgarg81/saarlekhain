"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { generateNextItemCode } from "@/lib/items";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ItemType, ValuationMethod, MasterStatus } from "@prisma/client";

const itemSchema = z.object({
  name: z.string().min(2, "Item name must be at least 2 characters"),
  description: z.string().optional(),
  categoryId: z.string().nullable(),
  departmentId: z.string().optional().nullable(),
  type: z.nativeEnum(ItemType),
  baseUom: z.string().min(1, "Base UOM is required"),
  altUom: z.string().optional().nullable(),
  altUomFactor: z.number().optional().nullable(),
  make: z.string().optional().nullable(),
  specification: z.string().optional().nullable(),
  hsnCode: z.string().optional().nullable(),
  gstRate: z.number().nonnegative().default(0),
  reorderLevel: z.number().nonnegative().default(0),
  minStock: z.number().nonnegative().default(0),
  maxStock: z.number().nonnegative().default(0),
  leadTimeDays: z.number().int().nonnegative().default(0),
  shelfLifeDays: z.number().int().nonnegative().nullable().optional(),
  qcRequired: z.boolean().default(false),
  valuation: z.nativeEnum(ValuationMethod).default(ValuationMethod.WEIGHTED_AVG),
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

export async function getNextCode(categoryCode: string) {
  const session = await auth();
  if (!session || !session.user) throw new Error("Unauthorized");
  
  const companyId = (session.user as any).companyId;
  return await generateNextItemCode(companyId, categoryCode);
}

export async function createItem(data: z.infer<typeof itemSchema> & { code?: string }) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = itemSchema.parse(data);
    
    // Resolve item code
    let code = data.code?.trim();
    if (!code && validated.categoryId) {
      const category = await db.itemCategory.findUnique({
        where: { id: validated.categoryId },
        select: { code: true }
      });
      if (category) {
        code = await generateNextItemCode(companyId, category.code);
      }
    }
    
    if (!code) {
      code = await generateNextItemCode(companyId, "ITEM");
    }

    // Check for uniqueness
    const exists = await db.item.findFirst({
      where: { companyId, code }
    });
    if (exists) {
      if (exists.deletedAt === null) {
        return { success: false, error: `Item code '${code}' already exists for this company` };
      }

      // If the item exists but was soft-deleted, restore it with the new details
      const result = await db.$transaction(async (tx) => {
        const restored = await tx.item.update({
          where: { id: exists.id },
          data: {
            ...validated,
            deletedAt: null,
            status: MasterStatus.ACTIVE,
          }
        });

        await logAudit(
          tx,
          companyId,
          actorId,
          "RESTORE",
          "Item",
          restored.id,
          exists,
          restored
        );

        return restored;
      });

      revalidatePath("/stores/items");
      return { success: true, item: result };
    }

    const result = await db.$transaction(async (tx) => {
      const newItem = await tx.item.create({
        data: {
          ...validated,
          companyId,
          code,
          status: MasterStatus.ACTIVE,
        }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "CREATE",
        "Item",
        newItem.id,
        null,
        newItem
      );

      return newItem;
    });

    revalidatePath("/stores/items");
    return { success: true, item: result };
  } catch (err: any) {
    console.error("Error creating item:", err);
    return { success: false, error: err.message || "Failed to create item" };
  }
}

export async function updateItem(
  id: string,
  data: z.infer<typeof itemSchema> & { code: string }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = itemSchema.parse(data);

    // Verify item exists and belongs to company
    const original = await db.item.findFirst({
      where: { id, companyId }
    });
    if (!original) return { success: false, error: "Item not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: {
          ...validated,
          code: data.code.trim(), // Enforce code remains correct
        }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "UPDATE",
        "Item",
        id,
        original,
        updated
      );

      return updated;
    });

    revalidatePath("/stores/items");
    return { success: true, item: result };
  } catch (err: any) {
    console.error("Error updating item:", err);
    return { success: false, error: err.message || "Failed to update item" };
  }
}

export async function toggleItemStatus(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const item = await db.item.findFirst({
      where: { id, companyId }
    });
    if (!item) return { success: false, error: "Item not found" };

    const newStatus = item.status === MasterStatus.ACTIVE ? MasterStatus.INACTIVE : MasterStatus.ACTIVE;

    await db.$transaction(async (tx) => {
      await tx.item.update({
        where: { id },
        data: { status: newStatus }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        newStatus === MasterStatus.ACTIVE ? "ACTIVATE" : "DEACTIVATE",
        "Item",
        id,
        { status: item.status },
        { status: newStatus }
      );
    });

    revalidatePath("/stores/items");
    return { success: true, status: newStatus };
  } catch (err: any) {
    console.error("Error toggling item status:", err);
    return { success: false, error: err.message || "Failed to change item status" };
  }
}

export async function bulkCreateItems(itemsList: Array<{
  name: string;
  code?: string | null;
  description?: string | null;
  categoryCode?: string | null;
  departmentCode?: string | null;
  type: ItemType;
  baseUom: string;
  altUom?: string | null;
  altUomFactor?: number | null;
  make?: string | null;
  specification?: string | null;
  hsnCode?: string | null;
  gstRate?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  leadTimeDays?: number;
  shelfLifeDays?: number | null;
  qcRequired?: boolean;
  valuation?: ValuationMethod;
}>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const result = await db.$transaction(async (tx) => {
      // Fetch categories for mapping
      const categories = await tx.itemCategory.findMany({
        where: { companyId }
      });
      const categoryMap = new Map(categories.map(c => [c.code.toUpperCase(), c.id]));
      const categoryCodeMap = new Map(categories.map(c => [c.id, c.code]));

      // Fetch departments for mapping
      const departments = await tx.department.findMany({
        where: { companyId }
      });
      const departmentMap = new Map(departments.map(d => [d.code.toUpperCase(), d.id]));

      // Fetch all existing items for uniqueness and soft-delete mapping
      const existingItems = await tx.item.findMany({
        where: { companyId },
        select: { id: true, code: true, deletedAt: true }
      });
      // Map uppercase code -> existing item record
      const existingItemsMap = new Map<string, { id: string; code: string; deletedAt: Date | null }>(
        existingItems.map(i => [i.code.toUpperCase(), i])
      );

      // Fetch code scheme
      const scheme = await tx.itemCodeScheme.findUnique({
        where: { companyId },
      });
      const separator = scheme?.separator || "-";
      let width = 4;
      if (scheme && Array.isArray(scheme.segments)) {
        const serialSeg = (scheme.segments as any[]).find(
          (s) => s.type === "SERIAL" || s.seg === "SERIAL"
        );
        if (serialSeg && typeof serialSeg.width === "number") {
          width = serialSeg.width;
        }
      }

      const serialMap = new Map<string, number>();
      const createdItems = [];
      const validationErrors: string[] = [];

      for (let idx = 0; idx < itemsList.length; idx++) {
        const itemData = itemsList[idx];

        // Resolve Category ID from Category Code
        let categoryId: string | null = null;
        let catCode = "ITEM";
        if (itemData.categoryCode) {
          const upperCatCode = itemData.categoryCode.trim().toUpperCase();
          let mappedId = categoryMap.get(upperCatCode);
          if (!mappedId) {
            // Auto-create category in DB
            const newCat = await tx.itemCategory.create({
              data: {
                companyId,
                code: upperCatCode,
                name: upperCatCode.charAt(0) + upperCatCode.slice(1).toLowerCase() + "s",
              }
            });
            mappedId = newCat.id;
            categoryMap.set(upperCatCode, mappedId);
          }
          categoryId = mappedId;
          catCode = upperCatCode;
        }

        // Resolve Department ID from Department Code
        let departmentId: string | null = null;
        if (itemData.departmentCode) {
          const upperDeptCode = itemData.departmentCode.trim().toUpperCase();
          const mappedDeptId = departmentMap.get(upperDeptCode);
          if (!mappedDeptId) {
            validationErrors.push(`Row ${idx + 2}: Department Code '${itemData.departmentCode}' not found`);
            continue;
          }
          departmentId = mappedDeptId;
        }

        // Resolve item code
        let code = itemData.code?.trim();
        if (!code) {
          const prefix = catCode.toUpperCase();
          let nextSerial = serialMap.get(prefix);

          if (nextSerial === undefined) {
            // Find last item in DB inside this transaction
            const lastItem = await tx.item.findFirst({
              where: {
                companyId,
                code: {
                  startsWith: `${prefix}${separator}`,
                },
              },
              orderBy: {
                code: "desc",
              },
            });

            nextSerial = 1;
            if (lastItem) {
              const parts = lastItem.code.split(separator);
              const lastSerialPart = parts[parts.length - 1];
              const parsed = parseInt(lastSerialPart, 10);
              if (!isNaN(parsed)) {
                nextSerial = parsed + 1;
              }
            }
          }

          const paddedSerial = String(nextSerial).padStart(width, "0");
          code = `${prefix}${separator}${paddedSerial}`;
          serialMap.set(prefix, nextSerial + 1);
        }

        // Check for uniqueness in-memory
        const existingItem = existingItemsMap.get(code.toUpperCase());
        if (existingItem) {
          if (existingItem.deletedAt === null) {
            validationErrors.push(`Row ${idx + 2}: Item code '${code}' already exists`);
            continue;
          }
          
          // Restore and update soft-deleted item
          const restoredItem = await tx.item.update({
            where: { id: existingItem.id },
            data: {
              deletedAt: null,
              status: MasterStatus.ACTIVE,
              name: itemData.name,
              description: itemData.description || null,
              categoryId,
              departmentId,
              type: itemData.type,
              baseUom: itemData.baseUom,
              altUom: itemData.altUom || null,
              altUomFactor: itemData.altUomFactor || null,
              make: itemData.make || null,
              specification: itemData.specification || null,
              hsnCode: itemData.hsnCode || null,
              gstRate: itemData.gstRate ?? 0,
              reorderLevel: itemData.reorderLevel ?? 0,
              minStock: itemData.minStock ?? 0,
              maxStock: itemData.maxStock ?? 0,
              leadTimeDays: itemData.leadTimeDays ?? 0,
              shelfLifeDays: itemData.shelfLifeDays || null,
              qcRequired: itemData.qcRequired ?? false,
              valuation: itemData.valuation ?? ValuationMethod.WEIGHTED_AVG,
            }
          });

          await logAudit(
            tx,
            companyId,
            actorId,
            "RESTORE",
            "Item",
            restoredItem.id,
            existingItem,
            restoredItem
          );

          // Update cache map to mark it active
          existingItemsMap.set(code.toUpperCase(), { id: restoredItem.id, code, deletedAt: null });
          createdItems.push(restoredItem);
          continue;
        }

        const newItem = await tx.item.create({
          data: {
            companyId,
            code,
            name: itemData.name,
            description: itemData.description || null,
            categoryId,
            departmentId,
            type: itemData.type,
            baseUom: itemData.baseUom,
            altUom: itemData.altUom || null,
            altUomFactor: itemData.altUomFactor || null,
            make: itemData.make || null,
            specification: itemData.specification || null,
            hsnCode: itemData.hsnCode || null,
            gstRate: itemData.gstRate ?? 0,
            reorderLevel: itemData.reorderLevel ?? 0,
            minStock: itemData.minStock ?? 0,
            maxStock: itemData.maxStock ?? 0,
            leadTimeDays: itemData.leadTimeDays ?? 0,
            shelfLifeDays: itemData.shelfLifeDays || null,
            qcRequired: itemData.qcRequired ?? false,
            valuation: itemData.valuation ?? ValuationMethod.WEIGHTED_AVG,
            status: MasterStatus.ACTIVE,
          }
        });

        await logAudit(
          tx,
          companyId,
          actorId,
          "CREATE",
          "Item",
          newItem.id,
          null,
          newItem
        );

        // Add to cache map to prevent internal import duplicates
        existingItemsMap.set(code.toUpperCase(), { id: newItem.id, code, deletedAt: null });
        createdItems.push(newItem);
      }

      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join("\n"));
      }

      return createdItems;
    }, {
      maxWait: 15000,
      timeout: 60000
    });

    revalidatePath("/stores/items");
    return { success: true, count: result.length, items: result };
  } catch (err: any) {
    console.error("Error bulk creating items:", err);
    return { success: false, error: err.message || "Failed to bulk create items" };
  }
}

/**
 * Bulk soft deletes multiple items.
 */
export async function bulkDeleteItems(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    if (!ids || ids.length === 0) {
      return { success: false, error: "No items selected" };
    }

    const result = await db.$transaction(async (tx) => {
      const deletedItems = [];
      for (const id of ids) {
        // Verify item exists and belongs to company
        const original = await tx.item.findFirst({
          where: { id, companyId, deletedAt: null }
        });
        if (!original) continue;

        const updated = await tx.item.update({
          where: { id },
          data: { deletedAt: new Date() }
        });

        await logAudit(
          tx,
          companyId,
          actorId,
          "DELETE",
          "Item",
          id,
          original,
          updated
        );
        deletedItems.push(updated);
      }
      return deletedItems;
    }, {
      maxWait: 15000,
      timeout: 60000
    });

    revalidatePath("/stores/items");
    return { success: true, count: result.length };
  } catch (err: any) {
    console.error("Error bulk deleting items:", err);
    return { success: false, error: err.message || "Failed to bulk delete items" };
  }
}

/**
 * Creates a new department or subdepartment.
 */
export async function createDepartment(data: { code: string; name: string; parentId?: string | null }) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    const parentId = data.parentId || null;

    if (!code || !name) {
      return { success: false, error: "Department code and name are required" };
    }

    // Check for unique department code in the company
    const exists = await db.department.findFirst({
      where: { companyId, code }
    });
    if (exists) {
      return { success: false, error: `Department code '${code}' already exists` };
    }

    const result = await db.$transaction(async (tx) => {
      const dept = await tx.department.create({
        data: {
          companyId,
          code,
          name,
          parentId,
        }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "CREATE",
        "Department",
        dept.id,
        null,
        dept
      );

      return dept;
    });

    revalidatePath("/stores/items");
    return { success: true, department: result };
  } catch (err: any) {
    console.error("Error creating department:", err);
    return { success: false, error: err.message || "Failed to create department" };
  }
}

/**
 * Updates an existing department or subdepartment.
 */
export async function updateDepartment(
  id: string,
  data: { code: string; name: string; parentId?: string | null }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    const parentId = data.parentId || null;

    if (!code || !name) {
      return { success: false, error: "Department code and name are required" };
    }

    // Check if ID is same as parentId (to prevent cycles)
    if (parentId === id) {
      return { success: false, error: "A department cannot be its own subdepartment" };
    }

    // Check for duplicate code
    const exists = await db.department.findFirst({
      where: { 
        companyId, 
        code,
        id: { not: id }
      }
    });
    if (exists) {
      return { success: false, error: `Department code '${code}' already exists` };
    }

    // Check parentId exists and is valid
    if (parentId) {
      const parent = await db.department.findUnique({
        where: { id: parentId }
      });
      if (!parent) {
        return { success: false, error: "Parent department not found" };
      }
    }

    const original = await db.department.findUnique({
      where: { id }
    });
    if (!original) return { success: false, error: "Department not found" };

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.department.update({
        where: { id },
        data: {
          code,
          name,
          parentId,
        }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "UPDATE",
        "Department",
        id,
        original,
        updated
      );

      return updated;
    });

    revalidatePath("/stores/items");
    return { success: true, department: result };
  } catch (err: any) {
    console.error("Error updating department:", err);
    return { success: false, error: err.message || "Failed to update department" };
  }
}

/**
 * Deletes a department or subdepartment.
 */
export async function deleteDepartment(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    // Check if any items are assigned to this department
    const itemsCount = await db.item.count({
      where: { companyId, departmentId: id, deletedAt: null }
    });
    if (itemsCount > 0) {
      return { 
        success: false, 
        error: `Cannot delete department because it is assigned to ${itemsCount} active items` 
      };
    }

    // Check if it has subdepartments
    const childrenCount = await db.department.count({
      where: { companyId, parentId: id }
    });
    if (childrenCount > 0) {
      return { 
        success: false, 
        error: `Cannot delete department because it has ${childrenCount} subdepartments` 
      };
    }

    const original = await db.department.findUnique({
      where: { id }
    });
    if (!original) return { success: false, error: "Department not found" };

    await db.$transaction(async (tx) => {
      await tx.department.delete({
        where: { id }
      });

      await logAudit(
        tx,
        companyId,
        actorId,
        "DELETE",
        "Department",
        id,
        original,
        null
      );
    });

    revalidatePath("/stores/items");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting department:", err);
    return { success: false, error: err.message || "Failed to delete department" };
  }
}

export async function updateReorderLevels(updates: Array<{ id: string; reorderLevel: number }>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    if (!updates || updates.length === 0) {
      return { success: false, error: "No updates provided" };
    }

    for (const update of updates) {
      if (typeof update.reorderLevel !== "number" || update.reorderLevel < 0 || isNaN(update.reorderLevel)) {
        return { success: false, error: "Reorder level must be a non-negative number" };
      }
    }

    const result = await db.$transaction(async (tx) => {
      const updatedItems = [];
      for (const update of updates) {
        const original = await tx.item.findFirst({
          where: { id: update.id, companyId, deletedAt: null }
        });
        if (!original) continue;

        if (original.reorderLevel === update.reorderLevel) continue;

        const updated = await tx.item.update({
          where: { id: update.id },
          data: { reorderLevel: update.reorderLevel }
        });

        await logAudit(
          tx,
          companyId,
          actorId,
          "UPDATE",
          "Item",
          update.id,
          { reorderLevel: original.reorderLevel },
          { reorderLevel: update.reorderLevel }
        );
        updatedItems.push(updated);
      }
      return updatedItems;
    }, {
      maxWait: 15000,
      timeout: 60000
    });

    revalidatePath("/stores/items");
    return { success: true, count: result.length };
  } catch (err: any) {
    console.error("Error bulk updating reorder levels:", err);
    return { success: false, error: err.message || "Failed to update reorder levels" };
  }
}

export async function getItemStockLogs(
  itemId: string,
  startDateStr?: string,
  endDateStr?: string
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    const whereClause: any = {
      companyId,
      itemId,
    };

    if (startDateStr || endDateStr) {
      whereClause.createdAt = {};
      if (startDateStr) {
        whereClause.createdAt.gte = new Date(`${startDateStr}T00:00:00.000Z`);
      }
      if (endDateStr) {
        whereClause.createdAt.lte = new Date(`${endDateStr}T23:59:59.999Z`);
      }
    }

    const logs = await db.stockLedger.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
    });

    if (logs.length === 0) {
      return { success: true, logs: [] };
    }

    // Resolve store names
    const storeIds = Array.from(new Set(logs.map((l) => l.storeId)));
    const stores = await db.store.findMany({
      where: { id: { in: storeIds }, companyId },
      select: { id: true, name: true },
    });

    // Resolve reference numbers (GRN / Issue / Rejection)
    const grnIds = Array.from(new Set(logs.filter((l) => l.refType === "GRN" && l.refId).map((l) => l.refId as string)));
    const grns = grnIds.length > 0 ? await db.grn.findMany({
      where: { id: { in: grnIds }, companyId },
      select: { id: true, number: true },
    }) : [];

    const issueIds = Array.from(new Set(logs.filter((l) => l.refType === "ISSUE" && l.refId).map((l) => l.refId as string)));
    const issues = issueIds.length > 0 ? await db.issue.findMany({
      where: { id: { in: issueIds }, companyId },
      select: { id: true, number: true },
    }) : [];

    const rejectionIds = Array.from(new Set(logs.filter((l) => l.refType === "GRN_REJECTION" && l.refId).map((l) => l.refId as string)));
    const rejections = rejectionIds.length > 0 ? await db.rejectedMaterial.findMany({
      where: { id: { in: rejectionIds }, companyId },
      select: { id: true, grnNumber: true },
    }) : [];

    const formattedLogs = logs.map((l) => {
      const store = stores.find((s) => s.id === l.storeId);
      
      let refNo = l.refId || "N/A";
      if (l.refType === "GRN") {
        const grn = grns.find((g) => g.id === l.refId);
        if (grn) refNo = grn.number;
      } else if (l.refType === "ISSUE") {
        const issue = issues.find((i) => i.id === l.refId);
        if (issue) refNo = issue.number;
      } else if (l.refType === "GRN_REJECTION") {
        const rejection = rejections.find((r) => r.id === l.refId);
        if (rejection) refNo = `QC REJ (GRN: ${rejection.grnNumber})`;
      }

      return {
        id: l.id,
        txnType: l.txnType,
        qty: l.qty,
        rate: l.rate,
        refType: l.refType,
        refNo,
        storeName: store?.name || "Unknown Store",
        createdAt: l.createdAt.toISOString(),
      };
    });

    return { success: true, logs: formattedLogs };
  } catch (err: any) {
    console.error("Error fetching item stock logs:", err);
    return { success: false, error: err.message || "Failed to fetch logs" };
  }
}

