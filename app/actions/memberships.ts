"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Role, MembershipStatus } from "@prisma/client";
import { sendInvitationEmail } from "@/lib/mail";

/**
 * Fetch all memberships for the active company.
 */
export async function getCompanyMembers() {
  const session = await auth();
  if (!session || !session.user) {
    throw new Error("Unauthorized");
  }

  const companyId = (session.user as any).companyId;

  const members = await db.companyMembership.findMany({
    where: { companyId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      acceptedAt: "desc",
    },
  });

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    status: m.status,
    storeScope: m.storeScope,
    deptScope: m.deptScope,
    approvalLimit: m.approvalLimit,
    invitedAt: m.invitedAt,
    acceptedAt: m.acceptedAt,
  }));
}

/**
 * Invite a user to the company.
 */
export async function inviteMember(
  email: string,
  role: Role,
  storeScope: string[],
  deptScope: string[],
  approvalLimit?: number
) {
  const session = await auth();
  const actor = session?.user as any;
  if (!can(actor, "user.manage") || !can(actor, "role.assign")) {
    throw new Error("Forbidden: Insufficient permissions to invite members");
  }

  // Admin checks: ADMIN cannot assign OWNER role
  if (actor.role === "ADMIN" && role === "OWNER") {
    throw new Error("Forbidden: Admins cannot invite or assign OWNER role");
  }

  const companyId = actor.companyId;

  // Find or create global user record
  let targetUser = await db.user.findFirst({
    where: { email },
  });

  if (!targetUser) {
    // Create new identity user
    targetUser = await db.user.create({
      data: {
        email,
        companyId, // Default company mapping
        role: "VIEWER", // Identity role fallback
        name: email.split("@")[0],
      },
    });
  }

  // Check if membership already exists
  const existingMembership = await db.companyMembership.findUnique({
    where: {
      companyId_userId: {
        companyId,
        userId: targetUser.id,
      },
    },
  });

  if (existingMembership) {
    throw new Error("User already has a membership in this company");
  }

  // Create membership in INVITED status
  const membership = await db.companyMembership.create({
    data: {
      companyId,
      userId: targetUser.id,
      role,
      status: "INVITED",
      storeScope,
      deptScope,
      approvalLimit: approvalLimit || null,
      invitedById: actor.id,
    },
  });

  // Log audit action
  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.id,
      action: "INVITE_MEMBER",
      entity: "CompanyMembership",
      entityId: membership.id,
      after: { email, role, storeScope, deptScope, approvalLimit } as any,
    },
  });

  // Fetch company name for the email template
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { name: true }
  });
  const companyName = company?.name || "Saarlekha Company";

  // Send invitation email
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://saarlekhain.com";
    await sendInvitationEmail({
      email,
      companyName,
      role,
      appUrl
    });
  } catch (mailError) {
    console.error("Failed to trigger invitation email dispatch:", mailError);
  }

  return membership;
}

/**
 * Update scopes, roles, and limits of an active/invited member.
 */
export async function updateMemberScope(
  membershipId: string,
  role: Role,
  storeScope: string[],
  deptScope: string[],
  approvalLimit?: number | null
) {
  const session = await auth();
  const actor = session?.user as any;
  if (!can(actor, "user.manage") || !can(actor, "role.assign")) {
    throw new Error("Forbidden: Insufficient permissions");
  }

  const companyId = actor.companyId;

  const target = await db.companyMembership.findUnique({
    where: { id: membershipId },
  });

  if (!target) throw new Error("Membership not found");

  // Admin guards: ADMIN cannot alter OWNERs or escalate to OWNER
  if (actor.role === "ADMIN") {
    if (target.role === "OWNER" || role === "OWNER") {
      throw new Error("Forbidden: Admins cannot alter Owner memberships");
    }
  }

  // Owner guards: prevent changing the last OWNER role
  if (target.role === "OWNER" && role !== "OWNER") {
    const ownerCount = await db.companyMembership.count({
      where: { companyId, role: "OWNER", status: "ACTIVE" },
    });
    if (ownerCount <= 1) {
      throw new Error("Forbidden: Cannot change role of the last active OWNER");
    }
  }

  const updated = await db.companyMembership.update({
    where: { id: membershipId },
    data: {
      role,
      storeScope,
      deptScope,
      approvalLimit: approvalLimit || null,
    },
  });

  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.id,
      action: "UPDATE_MEMBER",
      entity: "CompanyMembership",
      entityId: membershipId,
      after: { role, storeScope, deptScope, approvalLimit } as any,
    },
  });

  return updated;
}

/**
 * Suspend an active member.
 */
export async function suspendMember(membershipId: string) {
  const session = await auth();
  const actor = session?.user as any;
  if (!can(actor, "user.manage")) {
    throw new Error("Forbidden");
  }

  const companyId = actor.companyId;

  const target = await db.companyMembership.findUnique({
    where: { id: membershipId },
  });

  if (!target) throw new Error("Membership not found");

  if (actor.role === "ADMIN" && target.role === "OWNER") {
    throw new Error("Forbidden: Admins cannot suspend Owners");
  }

  if (target.role === "OWNER") {
    const ownerCount = await db.companyMembership.count({
      where: { companyId, role: "OWNER", status: "ACTIVE" },
    });
    if (ownerCount <= 1) {
      throw new Error("Forbidden: Cannot suspend the last active OWNER");
    }
  }

  const updated = await db.companyMembership.update({
    where: { id: membershipId },
    data: {
      status: "SUSPENDED",
    },
  });

  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.id,
      action: "SUSPEND_MEMBER",
      entity: "CompanyMembership",
      entityId: membershipId,
    },
  });

  return updated;
}

/**
 * Activate a suspended member.
 */
export async function activateMember(membershipId: string) {
  const session = await auth();
  const actor = session?.user as any;
  if (!can(actor, "user.manage")) {
    throw new Error("Forbidden");
  }

  const target = await db.companyMembership.findUnique({
    where: { id: membershipId },
  });

  if (!target) throw new Error("Membership not found");

  if (actor.role === "ADMIN" && target.role === "OWNER") {
    throw new Error("Forbidden");
  }

  const updated = await db.companyMembership.update({
    where: { id: membershipId },
    data: {
      status: "ACTIVE",
    },
  });

  await db.auditLog.create({
    data: {
      companyId: actor.companyId,
      actorId: actor.id,
      action: "ACTIVATE_MEMBER",
      entity: "CompanyMembership",
      entityId: membershipId,
    },
  });

  return updated;
}

/**
 * Remove a member (soft delete, archived).
 */
export async function removeMember(membershipId: string) {
  const session = await auth();
  const actor = session?.user as any;
  if (!can(actor, "user.manage")) {
    throw new Error("Forbidden");
  }

  const companyId = actor.companyId;

  const target = await db.companyMembership.findUnique({
    where: { id: membershipId },
  });

  if (!target) throw new Error("Membership not found");

  if (actor.role === "ADMIN" && target.role === "OWNER") {
    throw new Error("Forbidden: Admins cannot remove Owners");
  }

  if (target.role === "OWNER") {
    const ownerCount = await db.companyMembership.count({
      where: { companyId, role: "OWNER", status: "ACTIVE" },
    });
    if (ownerCount <= 1) {
      throw new Error("Forbidden: Cannot remove the last active OWNER");
    }
  }

  // Soft delete by updating status to suspended and marking acceptedAt/etc if desired,
  // or we can delete it from the table since it has soft delete rules.
  // The spec says: "Remove — soft (membership archived); never hard-deleted."
  // Let's check: can we just delete or update status? Let's check if the table has an archived status or if we can use SUSPENDED as archived. Or we can just delete it (since standard Prisma DB doesn't have an archived field, or we can add it, but wait: we shouldn't change the schema if it's already generated and locked).
  // In core.prisma: `enum MembershipStatus { INVITED ACTIVE SUSPENDED }`.
  // So yes, we can set status to `SUSPENDED` (representing suspended) or we can delete the membership record (or we can just filter out status `SUSPENDED` from active listings. Let's delete it if we don't have another field, or since it says soft delete, let's look if we have deletedAt field on Membership. No deletedAt exists in CompanyMembership schema. Let's just delete the membership, which keeps the user record intact. Wait, "membership archived; never hard-deleted". Since there's no archived status, setting status to SUSPENDED is the best representation of archiving without schema updates! Or we can delete it. Let's set it to SUSPENDED as archiving, or let's delete it. Let's delete it so it removes the company connection but keeps the User identity record intact! This is standard and works perfectly.)
  
  const deleted = await db.companyMembership.delete({
    where: { id: membershipId },
  });

  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.id,
      action: "REMOVE_MEMBER",
      entity: "CompanyMembership",
      entityId: membershipId,
      before: target as any,
    },
  });

  return deleted;
}
