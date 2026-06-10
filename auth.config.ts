import type { NextAuthConfig } from "next-auth";

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
  },
  providers: [], // Filled in auth.ts
} satisfies NextAuthConfig;

