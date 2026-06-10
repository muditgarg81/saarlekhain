"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { createNewCompany } from "@/app/actions/auth";
import { Building2, Plus, ArrowRight, LogOut, CheckCircle, AlertCircle } from "lucide-react";
import { signOut } from "next-auth/react";

interface MembershipItem {
  id: string;
  role: string;
  company: {
    id: string;
    name: string;
    displayName: string | null;
    logoUrl: string | null;
  };
}

interface SelectCompanyClientProps {
  memberships: MembershipItem[];
  session: any;
}

function SelectCompanyContent({ memberships }: { memberships: MembershipItem[] }) {
  const router = useRouter();
  const { update } = useSession();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSelect = async (companyId: string) => {
    setLoadingId(companyId);
    setError(null);
    try {
      // Trigger NextAuth token updates with selected companyId context
      await update({ companyId });
      
      // Wait briefly for JWT callback propagation, then redirect
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 500);
    } catch (err: any) {
      console.error(err);
      setError("Failed to select company workspace context.");
      setLoadingId(null);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await createNewCompany(newCompanyName);
      if (res.success) {
        setSuccess(`Company "${newCompanyName}" created and provisioned successfully!`);
        setNewCompanyName("");
        // Select it immediately
        await handleSelect(res.companyId);
      }
    } catch (err: any) {
      setError(err.message || "Failed to create company.");
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8 relative font-body text-xs text-onyx">
      {/* Decorative branding top bar */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-saffron via-saffron-light to-saffron-dark" />

      {/* Header */}
      <div className="max-w-4xl mx-auto w-full flex justify-between items-center">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold tracking-tight text-onyx">Saarlekha</h1>
          <p className="text-[10px] font-mono tracking-widest text-onyx/50 uppercase mt-0.5">Enterprise Portal</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="flex items-center space-x-1.5 px-3 py-1.5 border border-onyx/10 hover:border-onyx/20 rounded-lg font-bold bg-white text-onyx/70 hover:text-onyx transition-all duration-150 cursor-pointer shadow-sm"
        >
          <LogOut size={13} />
          <span>Sign Out</span>
        </button>
      </div>

      {/* Main Grid */}
      <div className="max-w-4xl mx-auto w-full my-auto py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left/Middle Column: Workspace Selector */}
        <div className="md:col-span-2 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-onyx">Select a Company Workspace</h2>
            <p className="text-xs text-onyx/50 mt-1">Choose which company ecosystem you want to access today.</p>
          </div>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start space-x-3 text-red-800">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p className="font-semibold">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-xl flex items-start space-x-3 text-emerald-800">
              <CheckCircle size={16} className="shrink-0 mt-0.5" />
              <p className="font-semibold">{success}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {memberships.map((m) => {
              const isLoading = loadingId === m.company.id;
              return (
                <button
                  key={m.id}
                  onClick={() => handleSelect(m.company.id)}
                  disabled={!!loadingId || creating}
                  className={`glass-card p-5 rounded-xl border border-onyx/5 bg-white text-left shadow-sm hover:shadow-md transition-all duration-200 group flex flex-col justify-between h-36 ${
                    loadingId ? "opacity-60 cursor-not-allowed" : "hover:border-saffron cursor-pointer"
                  }`}
                >
                  <div className="flex items-start justify-between w-full">
                    <div className="w-10 h-10 bg-cream border border-onyx/5 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                      {m.company.logoUrl ? (
                        <img src={m.company.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                      ) : (
                        <Building2 size={18} className="text-onyx/40 stroke-1" />
                      )}
                    </div>
                    <span className="px-1.5 py-0.5 bg-onyx/5 text-onyx border border-onyx/10 rounded font-mono text-[8px] uppercase tracking-wider font-semibold">
                      {m.role}
                    </span>
                  </div>

                  <div className="w-full pt-4 flex items-end justify-between">
                    <div>
                      <p className="font-bold text-onyx text-xs group-hover:text-saffron-dark transition-colors duration-150">
                        {m.company.displayName || m.company.name}
                      </p>
                      <p className="text-[10px] text-onyx/40 font-mono mt-0.5">ID: {m.company.id.substring(0, 8)}...</p>
                    </div>
                    <div className="p-1 rounded-full bg-cream hover:bg-saffron group-hover:bg-saffron text-onyx/60 group-hover:text-onyx transition-all duration-150">
                      {isLoading ? (
                        <span className="h-4 w-4 block border-2 border-onyx border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <ArrowRight size={14} className="transform group-hover:translate-x-0.5 transition-transform" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {memberships.length === 0 && (
            <div className="text-center py-12 bg-white border border-onyx/5 rounded-xl text-onyx/40 font-semibold shadow-sm">
              <Building2 size={36} className="mx-auto stroke-1 mb-2 opacity-50" />
              <span>You do not have any active company memberships. Create one below to begin.</span>
            </div>
          )}
        </div>

        {/* Right Column: Create Company Card */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 bg-white shadow-sm flex flex-col justify-between h-[300px]">
          <div>
            <h3 className="font-bold text-sm tracking-wide border-b border-cream-dark pb-2 mb-4 flex items-center space-x-1.5">
              <Plus size={16} />
              <span>Create New Company</span>
            </h3>
            <p className="text-[11px] text-onyx/50 leading-relaxed">
              Create an additional, completely isolated company workspace. You will automatically be configured as the <strong>OWNER</strong>.
            </p>
          </div>

          <form onSubmit={handleCreateCompany} className="space-y-4">
            <div>
              <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Company Name</label>
              <input
                type="text"
                required
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="e.g. Crox Oil and Gas"
                className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                disabled={creating || !!loadingId}
              />
            </div>

            <button
              type="submit"
              disabled={creating || !!loadingId || !newCompanyName.trim()}
              className="w-full flex justify-center py-2 px-4 border border-transparent text-xs font-bold rounded-lg text-onyx bg-saffron hover:bg-saffron-dark transition-all duration-150 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {creating ? "Provisioning..." : "Create & Provision"}
            </button>
          </form>
        </div>

      </div>

      {/* Footer */}
      <div className="max-w-4xl mx-auto w-full text-center text-[10px] text-onyx/30 font-medium">
        <span>Saarlekha stores & purchase system is isolated dynamically per company tenant database identifier.</span>
      </div>
    </div>
  );
}

export default function SelectCompanyClient({ memberships, session }: SelectCompanyClientProps) {
  return (
    <SessionProvider session={session}>
      <SelectCompanyContent memberships={memberships} />
    </SessionProvider>
  );
}
