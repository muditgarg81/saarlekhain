import type { NextAuthConfig } from "next-auth";
import { db } from "./lib/db";

export const authConfig = {
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard") ||
                            nextUrl.pathname.startsWith("/stores") ||
                            nextUrl.pathname.startsWith("/purchase") ||
                            nextUrl.pathname.startsWith("/erp") ||
                            nextUrl.pathname.startsWith("/settings") || // Protect settings pages
                            nextUrl.pathname.startsWith("/select-company") || // Protect company selection page
                            nextUrl.pathname === "/";
      
      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect to signin
      } else if (isLoggedIn && nextUrl.pathname.startsWith("/auth")) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
      }

      // Allow client to trigger update of active companyId or storeId
      if (trigger === "update" && session) {
        if (session.companyId) {
          token.companyId = session.companyId;
          token.storeId = undefined; // reset store context on company switch
          token.role = undefined;
          token.storeScope = undefined;
          token.deptScope = undefined;
          token.approvalLimit = undefined;
        }
        if (session.storeId !== undefined) {
          token.storeId = session.storeId;
        }
      }

      // If no companyId is set on token, try to resolve one
      if (!token.companyId) {
        const primaryMembership = await db.companyMembership.findFirst({
          where: { userId: token.id as string, status: "ACTIVE" },
          orderBy: { isPrimary: "desc" },
        });

        if (primaryMembership) {
          token.companyId = primaryMembership.companyId;
        } else {
          // Fallback to database user's default company
          const dbUser = await db.user.findUnique({
            where: { id: token.id as string },
            select: { companyId: true }
          });
          token.companyId = dbUser?.companyId || "demo-company-id";
        }
      }

      // Load scopes and roles dynamically from active CompanyMembership
      if (token.companyId) {
        const membership = await db.companyMembership.findUnique({
          where: {
            companyId_userId: {
              companyId: token.companyId as string,
              userId: token.id as string,
            }
          }
        });

        if (membership && membership.status === "ACTIVE") {
          token.role = membership.role;
          token.storeScope = membership.storeScope;
          token.deptScope = membership.deptScope;
          token.approvalLimit = membership.approvalLimit;
        } else {
          // Fallback if no membership is active/found
          const dbUser = await db.user.findUnique({
            where: { id: token.id as string },
            select: { role: true }
          });
          token.role = dbUser?.role || "VIEWER";
          token.storeScope = [];
          token.deptScope = [];
          token.approvalLimit = null;
        }
      }

      // Fetch dynamic role permissions and custom approval limits if they exist
      if (token.companyId && token.role) {
        const customRolePerm = await db.rolePermission.findUnique({
          where: {
            companyId_role: {
              companyId: token.companyId as string,
              role: token.role as any,
            },
          },
        });

        if (customRolePerm) {
          token.permissions = customRolePerm.permissions;
          // Pre-fill / default the approval limit from the role config if the user doesn't have an override
          if (token.approvalLimit === null || token.approvalLimit === undefined) {
            token.approvalLimit = customRolePerm.approvalLimit;
          }
        } else {
          token.permissions = null;
        }
      } else {
        token.permissions = null;
      }

      // If storeId is not set, resolve default store ID
      if (!token.storeId && token.companyId) {
        const company = await db.company.findUnique({
          where: { id: token.companyId as string },
          select: { defaultStoreId: true }
        });
        if (company?.defaultStoreId) {
          token.storeId = company.defaultStoreId;
        } else if (token.storeScope && (token.storeScope as string[]).length > 0) {
          token.storeId = (token.storeScope as string[])[0];
        } else {
          token.storeId = null;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).role = token.role;
        (session.user as any).companyId = token.companyId as string;
        (session.user as any).storeScope = token.storeScope || [];
        (session.user as any).deptScope = token.deptScope || [];
        (session.user as any).approvalLimit = token.approvalLimit;
        (session.user as any).storeId = token.storeId as string | null;
        (session.user as any).permissions = token.permissions;
      }
      return session;
    },
  },
  providers: [], // Filled in auth.ts
} satisfies NextAuthConfig;

