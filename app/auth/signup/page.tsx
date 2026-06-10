"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerOwner } from "@/app/actions/auth";
import { Lock, Mail, AlertTriangle, CheckCircle, User, Building2 } from "lucide-react";
import Link from "next/link";

export default function SignUpPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    companyName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await registerOwner(formData);
      if (res.success) {
        setSuccess("Registration successful! Provisioning your company ecosystem...");
        setTimeout(() => {
          router.push("/auth/signin");
        }, 2000);
      } else {
        setError(res.error || "An unexpected error occurred during signup.");
        setLoading(false);
      }
    } catch (err: any) {
      console.error(err);
      setError("An unexpected error occurred during signup.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4 relative">
      {/* Decorative Branding Background */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-saffron via-saffron-light to-saffron-dark" />
      
      <div className="max-w-md w-full space-y-8 glass-card p-10 rounded-2xl shadow-xl border border-onyx/5 bg-white">
        {/* Title / Branding */}
        <div className="text-center">
          <h2 className="font-heading text-4xl font-extrabold text-onyx tracking-tight">
            Saarlekha
          </h2>
          <p className="mt-2 text-xs font-mono font-bold tracking-widest text-onyx/60 uppercase">
            Create Owner Account
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start space-x-3 animate-in fade-in">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <p className="text-xs font-semibold text-red-800">{error}</p>
          </div>
        )}

        {/* Success Alert */}
        {success && (
          <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-md flex items-start space-x-3 animate-in fade-in">
            <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={18} />
            <p className="text-xs font-semibold text-emerald-800">{success}</p>
          </div>
        )}

        {/* Sign Up Form */}
        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div className="rounded-md space-y-3.5">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-bold text-onyx/75 uppercase mb-1">
                Your Full Name
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                  <User size={16} />
                </span>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full text-sm pl-10 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  placeholder="e.g. Harish Sharma"
                />
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label className="block text-xs font-bold text-onyx/75 uppercase mb-1">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                  <Mail size={16} />
                </span>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full text-sm pl-10 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  placeholder="name@company.com"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-xs font-bold text-onyx/75 uppercase mb-1">
                Account Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                  <Lock size={16} />
                </span>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full text-sm pl-10 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  placeholder="At least 6 characters"
                  minLength={6}
                />
              </div>
            </div>

            {/* Company Name */}
            <div>
              <label className="block text-xs font-bold text-onyx/75 uppercase mb-1">
                Initial Company Name
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                  <Building2 size={16} />
                </span>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
                  className="w-full text-sm pl-10 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  placeholder="e.g. Crox Oil and Gas"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-semibold rounded-lg text-onyx bg-saffron hover:bg-saffron-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-saffron transition-all duration-200 shadow-md cursor-pointer disabled:opacity-50"
          >
            {loading ? "Registering & Seeding..." : "Create Account & Company"}
          </button>

          <p className="text-center text-xs text-onyx/60 font-semibold mt-4">
            Already have an owner or staff account?{" "}
            <Link href="/auth/signin" className="text-saffron hover:underline font-bold">
              Sign In
            </Link>
          </p>
        </form>

        {/* Small Notice */}
        <p className="text-center text-[10px] text-onyx/40 leading-relaxed font-medium mt-6">
          Setting up an account provisions a secure isolated workspace database under enterprise tenant policies.
        </p>
      </div>
    </div>
  );
}
