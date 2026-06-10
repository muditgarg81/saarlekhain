"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Lock, Mail, AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    signIn("google", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4">
      {/* Decorative Branding Background */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-saffron via-saffron-light to-saffron-dark" />
      
      <div className="max-w-md w-full space-y-8 glass-card p-10 rounded-2xl shadow-xl border border-onyx/5">
        {/* Title / Branding */}
        <div className="text-center">
          <h2 className="font-heading text-4xl font-extrabold text-onyx tracking-tight">
            Saarlekha
          </h2>
          <p className="mt-2 text-xs font-mono font-bold tracking-widest text-onyx/60 uppercase">
            STORES & PURCHASE
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start space-x-3">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <p className="text-xs font-semibold text-red-800">{error}</p>
          </div>
        )}

        {/* Sign In Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md space-y-4">
            {/* Email Field */}
            <div>
              <label htmlFor="email-address" className="block text-xs font-bold text-onyx/75 uppercase mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                  <Mail size={16} />
                </span>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm pl-10 pr-4 py-2.5 bg-cream-dark/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron focus:ring-1 focus:ring-saffron transition-all duration-200"
                  placeholder="name@company.com"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="password" className="block text-xs font-bold text-onyx/75 uppercase">
                  Password
                </label>
                <Link href="/auth/forgot-password" className="text-[11px] font-bold text-saffron hover:underline">
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                  <Lock size={16} />
                </span>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-sm pl-10 pr-4 py-2.5 bg-cream-dark/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron focus:ring-1 focus:ring-saffron transition-all duration-200"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-semibold rounded-lg text-onyx bg-saffron hover:bg-saffron-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-saffron transition-all duration-200 shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Sign in to Portal"}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-onyx/60 font-semibold mt-4">
          Want to register a new company?{" "}
          <Link href="/auth/signup" className="text-saffron hover:underline font-bold">
            Sign Up
          </Link>
        </p>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-onyx/10" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-cream px-3 text-onyx/40 font-semibold">Or continue with</span>
          </div>
        </div>

        {/* Google OAuth Login */}
        <button
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center space-x-3 py-2.5 px-4 bg-white hover:bg-cream-dark/30 border border-onyx/10 hover:border-onyx/20 rounded-lg text-sm font-semibold text-onyx shadow-sm transition-all duration-200 cursor-pointer"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Google Workspace</span>
        </button>

        {/* Small Notice */}
        <p className="text-center text-[10px] text-onyx/40 leading-relaxed font-medium mt-6">
          Authorized factory personnel only. All access attempts are logged under company audit policies.
        </p>
      </div>
    </div>
  );
}
