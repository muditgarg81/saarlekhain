"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Fetch all custom role permissions for the active company.
 */
export async function getCompanyRolePermissions() {
  const session = await auth();
  if (!session || !session.user) {
    throw new Error("Unauthorized");
  }

  const companyId = (session.user as any).companyId;

  const overrides = await db.rolePermission.findMany({
    where: { companyId },
  });

  return overrides;
}

/**
 * Create or update a custom role permission configuration.
 * Owner role capability adjustments are blocked in UI / backend to avoid lockout.
 */
export async function updateRolePermissions(role: Role, permissions: string[], approvalLimit?: number | null) {
  const session = await auth();
  const actor = session?.user as any;
  if (!actor || !actor.role) {
    throw new Error("Unauthorized");
  }

  // Only OWNER or ADMIN can modify role capability mapping
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
    throw new Error("Forbidden: Insufficient permissions to modify role capabilities");
  }

  // Strictly block modifications to OWNER capabilities to prevent lockout
  if (role === "OWNER") {
    throw new Error("Forbidden: OWNER role permissions are immutable");
  }

  const companyId = actor.companyId;

  const updated = await db.rolePermission.upsert({
    where: {
      companyId_role: {
        companyId,
        role,
      },
    },
    update: {
      permissions,
      approvalLimit: approvalLimit !== undefined ? approvalLimit : undefined,
    },
    create: {
      companyId,
      role,
      permissions,
      approvalLimit: approvalLimit || null,
    },
  });

  // Log in AuditLog
  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.id,
      action: "UPDATE_ROLE_PERMISSIONS",
      entity: "RolePermission",
      entityId: updated.id,
      after: { role, permissions, approvalLimit } as any,
    },
  });

  revalidatePath("/settings/members");
  return updated;
}

/**
 * Reset all custom role permission configs for the company, falling back to system defaults.
 */
export async function resetRolePermissions() {
  const session = await auth();
  const actor = session?.user as any;
  if (!actor || !actor.role) {
    throw new Error("Unauthorized");
  }

  if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
    throw new Error("Forbidden: Insufficient permissions to reset role capabilities");
  }

  const companyId = actor.companyId;

  await db.rolePermission.deleteMany({
    where: { companyId },
  });

  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.id,
      action: "RESET_ROLE_PERMISSIONS",
      entity: "RolePermission",
      entityId: companyId,
    },
  });

  revalidatePath("/settings/members");
  return { success: true };
}
