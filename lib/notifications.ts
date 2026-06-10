import { db } from "./db";
import { NotifCategory, NotifSeverity, Role } from "@prisma/client";

interface NotifyParams {
  companyId: string;
  audience: {
    permission?: string;
    role?: Role;
    userId?: string;
    scope?: {
      storeId?: string | null;
      deptId?: string | null;
    };
    minApprovalLimit?: number;
  };
  category: NotifCategory;
  severity: NotifSeverity;
  title: string;
  body?: string | null;
  deepLink?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
}

/**
 * Distributes a notification event to matching company members based on role/permissions,
 * scope, and preferences.
 */
export async function notify(params: NotifyParams) {
  const {
    companyId,
    audience,
    category,
    severity,
    title,
    body,
    deepLink,
    entityType,
    entityId,
    dedupeKey
  } = params;

  let recipients: string[] = [];

  if (audience.userId) {
    recipients = [audience.userId];
  } else {
    // Retrieve all active members for this company
    const memberships = await db.companyMembership.findMany({
      where: {
        companyId,
        status: "ACTIVE",
      },
      select: {
        userId: true,
        role: true,
        storeScope: true,
        deptScope: true,
        approvalLimit: true,
      },
    });

    // Filter memberships based on criteria
    const filtered = memberships.filter((m) => {
      // 1. Match role if specified
      if (audience.role && m.role !== audience.role) {
        return false;
      }

      // 2. Check permissions mapping if specified
      if (audience.permission) {
        const { ROLE_PERMISSIONS } = require("./rbac");
        const permissions = ROLE_PERMISSIONS[m.role] || [];
        if (!permissions.includes(audience.permission)) {
          return false;
        }
      }

      // 3. Check store scope if specified
      if (audience.scope?.storeId && m.storeScope && m.storeScope.length > 0) {
        if (!m.storeScope.includes(audience.scope.storeId)) {
          return false;
        }
      }

      // 4. Check department scope if specified
      if (audience.scope?.deptId && m.deptScope && m.deptScope.length > 0) {
        if (!m.deptScope.includes(audience.scope.deptId)) {
          return false;
        }
      }

      // 5. Check approval limit for value-gated alerts
      if (audience.minApprovalLimit !== undefined && m.role !== "OWNER") {
        if (m.approvalLimit !== null && m.approvalLimit !== undefined) {
          if (m.approvalLimit < audience.minApprovalLimit) {
            return false;
          }
        }
      }

      return true;
    });

    recipients = filtered.map((m) => m.userId);
  }

  // Write notifications
  for (const userId of recipients) {
    try {
      // Fetch user preferences
      const pref = await db.notificationPref.findUnique({
        where: {
          companyId_userId: {
            companyId,
            userId,
          },
        },
      });

      // Skip if category is muted
      if (pref?.mutedCategories.includes(category)) {
        continue;
      }

      if (dedupeKey) {
        await db.notification.upsert({
          where: {
            companyId_userId_dedupeKey: {
              companyId,
              userId,
              dedupeKey,
            },
          },
          update: {
            title,
            body,
            deepLink,
            severity,
            readAt: null, // Reset to unread if re-triggered
            createdAt: new Date(),
          },
          create: {
            companyId,
            userId,
            category,
            severity,
            title,
            body,
            deepLink,
            entityType,
            entityId,
            dedupeKey,
          },
        });
      } else {
        await db.notification.create({
          data: {
            companyId,
            userId,
            category,
            severity,
            title,
            body,
            deepLink,
            entityType,
            entityId,
          },
        });
      }

      // Log/trigger mock email send
      if (pref?.email && pref.emailDigest === "INSTANT") {
        console.log(`[EMAIL DISPATCH] Instant notification sent to User ${userId}: ${title}`);
      }
    } catch (err) {
      console.error(`Failed to write notification for user ${userId}:`, err);
    }
  }
}
