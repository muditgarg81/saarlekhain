"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, AlertTriangle, CheckCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { resetPasswordDirectly } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const emailParam = params.get("email");
      if (emailParam) {
        setEmail(emailParam);
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await resetPasswordDirectly({ email, newPassword });

      if (res.success) {
        setSuccess(true);
      } else {
        setError(res.error || "Failed to reset password. Check if the email is correct.");
      }
    } catch (err: any) {
      console.error(err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4 relative">
      {/* Decorative Branding Background */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-saffron via-saffron-light to-saffron-dark" />
      
      <div className="max-w-md w-full space-y-8 glass-card p-10 rounded-2xl shadow-xl border border-onyx/5">
        {/* Back Link */}
        <div>
          <Link href="/auth/signin" className="inline-flex items-center space-x-2 text-xs font-bold text-onyx/60 hover:text-onyx transition-colors duration-150">
            <ArrowLeft size={14} />
            <span>Back to Sign In</span>
          </Link>
        </div>

        {/* Title / Branding */}
        <div className="text-center">
          <h2 className="font-heading text-4xl font-extrabold text-onyx tracking-tight">
            Reset Password
          </h2>
          <p className="mt-2 text-xs font-mono font-bold tracking-widest text-onyx/60 uppercase">
            Saarlekha Portal
          </p>
        </div>

        {/* Success State */}
        {success ? (
          <div className="space-y-6 text-center">
            <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex flex-col items-center space-y-2.5">
              <CheckCircle className="text-green-600" size={32} />
              <div>
                <p className="text-xs font-bold text-green-900 uppercase tracking-wider">Password Reset Successful</p>
                <p className="text-[11px] text-green-800 mt-1">
                  Your account password has been updated successfully. You can now use your new password to sign in.
                </p>
              </div>
            </div>

            <Link
              href="/auth/signin"
              className="w-full flex justify-center py-2.5 px-4 text-sm font-semibold rounded-lg text-onyx bg-saffron hover:bg-saffron-dark transition-all duration-200 shadow-md cursor-pointer"
            >
              Sign In to Portal
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {/* Error Alert */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start space-x-3">
                <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
                <p className="text-xs font-semibold text-red-800">{error}</p>
              </div>
            )}

            <div className="rounded-md space-y-4">
              {/* Email Address */}
              <div>
                <label htmlFor="email-address" className="block text-xs font-bold text-onyx/75 uppercase mb-1.5">
                  Your Account Email
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

              {/* New Password */}
              <div>
                <label htmlFor="new-password" className="block text-xs font-bold text-onyx/75 uppercase mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                    <Lock size={16} />
                  </span>
                  <input
                    id="new-password"
                    name="newPassword"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full text-sm pl-10 pr-4 py-2.5 bg-cream-dark/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron focus:ring-1 focus:ring-saffron transition-all duration-200"
                    placeholder="Min 6 characters"
                  />
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label htmlFor="confirm-password" className="block text-xs font-bold text-onyx/75 uppercase mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                    <Lock size={16} />
                  </span>
                  <input
                    id="confirm-password"
                    name="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full text-sm pl-10 pr-4 py-2.5 bg-cream-dark/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron focus:ring-1 focus:ring-saffron transition-all duration-200"
                    placeholder="Re-enter password"
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
                {loading ? "Resetting password..." : "Reset Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
