import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

// Named export 'proxy' or default export is required in Next.js 16
export const proxy = auth;

export const config = {
  // Protect all paths except API routes, static assets, and auth pages
  matcher: ["/((?!api|_next/static|_next/image|auth/signin|auth/register|favicon.ico|.*\\.png$).*)"],
};
