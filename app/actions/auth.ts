"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { ROLE_PERMISSIONS } from "@/lib/rbac";

/**
 * Register a new user and create their initial company ecosystem.
 */
export async function registerOwner(data: {
  name: string;
  email: string;
  password: string;
  companyName: string;
}) {
  try {
    const { name, email, password, companyName } = data;

    if (!email || !password || !companyName || !name) {
      return { success: false, error: "Missing required registration fields" };
    }

    // Check if user already exists
    const existingUser = await db.user.findFirst({
      where: { email },
    });

    if (existingUser && existingUser.passwordHash) {
      return { success: false, error: "A user with this email address already exists." };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.$transaction(async (tx) => {
      // 1. Create the Company record
      const company = await tx.company.create({
        data: {
          name: companyName,
          displayName: companyName,
          legalName: companyName,
        },
      });

      // 2. Create or update the User record
      let user;
      if (existingUser) {
        user = await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name,
            passwordHash: hashedPassword,
            companyId: company.id,
            role: Role.OWNER,
          },
        });
      } else {
        user = await tx.user.create({
          data: {
            email,
            name,
            passwordHash: hashedPassword,
            companyId: company.id,
            role: Role.OWNER,
          },
        });
      }

      // 3. Link user to company via CompanyMembership as OWNER
      await tx.companyMembership.create({
        data: {
          companyId: company.id,
          userId: user.id,
          role: Role.OWNER,
          status: "ACTIVE",
          isPrimary: true,
        },
      });

      // Mark other memberships as non-primary
      await tx.companyMembership.updateMany({
        where: {
          userId: user.id,
          companyId: { not: company.id },
        },
        data: {
          isPrimary: false,
        },
      });

      // 4. Seed dynamic default Store (MAIN)
      const store = await tx.store.create({
        data: {
          companyId: company.id,
          code: "MAIN",
          name: "Main Inventory Warehouse",
          status: "ACTIVE",
        },
      });

      // 5. Seed default Department (STORES)
      await tx.department.create({
        data: {
          companyId: company.id,
          code: "STORES",
          name: "Stores & Purchase",
        },
      });

      // Seed default Categories (RM, CONS)
      await tx.itemCategory.create({
        data: { companyId: company.id, code: "RM", name: "Raw Materials" },
      });
      await tx.itemCategory.create({
        data: { companyId: company.id, code: "CONS", name: "Consumables" },
      });

      // Set the defaultStoreId on the new company
      await tx.company.update({
        where: { id: company.id },
        data: {
          defaultStoreId: store.id,
        },
      });

      // 6. Seed Numbering Schemes for all document types
      const docTypes = ["PO", "GRN", "PR", "RFQ", "IND", "ISS", "GP", "INSP", "DN", "CN", "PAY"];
      for (const docType of docTypes) {
        await tx.numberingScheme.create({
          data: {
            companyId: company.id,
            docType,
            prefix: docType,
            padding: 5,
            resetOnFY: true,
          },
        });
      }

      return { user, company };
    });

    return { success: true, companyId: result.company.id };
  } catch (error: any) {
    console.error("Failed to register owner:", error);
    return { success: false, error: error.message || "An unexpected error occurred." };
  }
}

/**
 * Allows a logged-in user to create an additional company.
 */
export async function createNewCompany(companyName: string) {
  const session = await auth();
  if (!session || !session.user) {
    throw new Error("Unauthorized");
  }

  const userId = (session.user as any).id;

  if (!companyName) {
    throw new Error("Company name is required");
  }

  const result = await db.$transaction(async (tx) => {
    // 1. Create the new Company record
    const company = await tx.company.create({
      data: {
        name: companyName,
        displayName: companyName,
        legalName: companyName,
      },
    });

    // 2. Link user as OWNER of this company
    await tx.companyMembership.create({
      data: {
        companyId: company.id,
        userId,
        role: Role.OWNER,
        status: "ACTIVE",
        isPrimary: false, // keep current primary intact
      },
    });

    // 3. Seed default Store
    const store = await tx.store.create({
      data: {
        companyId: company.id,
        code: "MAIN",
        name: "Main Inventory Warehouse",
        status: "ACTIVE",
      },
    });

    // 4. Seed default Department
    await tx.department.create({
      data: {
        companyId: company.id,
        code: "STORES",
        name: "Stores & Purchase",
      },
    });

    // Seed default Categories (RM, CONS)
    await tx.itemCategory.create({
      data: { companyId: company.id, code: "RM", name: "Raw Materials" },
    });
    await tx.itemCategory.create({
      data: { companyId: company.id, code: "CONS", name: "Consumables" },
    });

    // Link default store
    await tx.company.update({
      where: { id: company.id },
      data: {
        defaultStoreId: store.id,
      },
    });

    // 5. Seed Numbering Schemes
    const docTypes = ["PO", "GRN", "PR", "RFQ", "IND", "ISS", "GP", "INSP", "DN", "CN", "PAY"];
    for (const docType of docTypes) {
      await tx.numberingScheme.create({
        data: {
          companyId: company.id,
          docType,
          prefix: docType,
          padding: 5,
          resetOnFY: true,
        },
      });
    }

    return company;
  });

  revalidatePath("/select-company");
  return { success: true, companyId: result.id };
}

/**
 * Direct password reset action for the forgot password flow.
 */
export async function resetPasswordDirectly(data: { email: string; newPassword: string }) {
  const { email, newPassword } = data;
  if (!email || !newPassword) {
    return { success: false, error: "Email and password are required" };
  }

  if (newPassword.length < 6) {
    return { success: false, error: "Password must be at least 6 characters long" };
  }

  try {
    const user = await db.user.findFirst({
      where: { email },
    });

    if (!user) {
      return { success: false, error: "A user with this email address does not exist." };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.$transaction(async (tx) => {
      // 1. Update user password
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword },
      });

      // 2. Check if user already has an active primary membership
      const hasPrimary = await tx.companyMembership.findFirst({
        where: {
          userId: user.id,
          status: "ACTIVE",
          isPrimary: true,
        },
      });

      // 3. Find all INVITED memberships
      const invited = await tx.companyMembership.findMany({
        where: {
          userId: user.id,
          status: "INVITED",
        },
      });

      // 4. Update status of invited memberships to ACTIVE and set isPrimary
      if (invited.length > 0) {
        for (let i = 0; i < invited.length; i++) {
          const makePrimary = i === 0 && !hasPrimary;
          await tx.companyMembership.update({
            where: { id: invited[i].id },
            data: {
              status: "ACTIVE",
              acceptedAt: new Date(),
              ...(makePrimary ? { isPrimary: true } : {}),
            },
          });
        }
      }
    });

    return { success: true };
  } catch (error: any) {
    console.error("Failed to reset password:", error);
    return { success: false, error: error.message || "An unexpected error occurred." };
  }
}

/**
 * Fetch the fresh user session, role, scopes, and dynamic role permissions directly from the database.
 * Bypasses the NextAuth client-side cached JWT token.
 */
export async function getFreshUser() {
  const session = await auth();
  if (!session || !session.user) return null;

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userId = (session.user as any).id;

  const membership = await db.companyMembership.findUnique({
    where: {
      companyId_userId: {
        companyId,
        userId,
      },
    },
  });

  const activeRole = membership?.role || (session.user as any).role || "VIEWER";

  const customRolePerm = await db.rolePermission.findUnique({
    where: {
      companyId_role: {
        companyId,
        role: activeRole as any,
      },
    },
  });

  const permissions = customRolePerm 
    ? customRolePerm.permissions 
    : (ROLE_PERMISSIONS[activeRole as Role] || []);

  return {
    id: userId,
    name: session.user.name,
    email: session.user.email,
    role: activeRole,
    companyId,
    storeId: (session.user as any).storeId,
    storeScope: membership?.storeScope || [],
    deptScope: membership?.deptScope || [],
    approvalLimit: membership?.approvalLimit,
    permissions,
    status: membership?.status || "ACTIVE",
  };
}
