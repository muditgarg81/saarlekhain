"use client";

import { useState } from "react";
import { updateCompanyDetails, uploadCompanyLogo } from "@/app/actions/company";
import { Building2, Upload, AlertCircle, CheckCircle } from "lucide-react";

interface CompanyData {
  id: string;
  name: string;
  legalName?: string | null;
  displayName?: string | null;
  address?: string | null;
  city?: string | null;
  governingPlace?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  baseCurrency: string;
  timezone: string;
  fyStartMonth: number;
  defaultStoreId?: string | null;
  logoUrl?: string | null;
}

interface StoreItem {
  id: string;
  name: string;
}

interface CompanySettingsFormProps {
  initialCompany: CompanyData;
  stores: StoreItem[];
}

export default function CompanySettingsForm({ initialCompany, stores }: CompanySettingsFormProps) {
  const [formData, setFormData] = useState({
    legalName: initialCompany.legalName || "",
    displayName: initialCompany.displayName || "",
    address: initialCompany.address || "",
    city: initialCompany.city || "",
    governingPlace: initialCompany.governingPlace || "",
    gstin: initialCompany.gstin || "",
    pan: initialCompany.pan || "",
    cin: initialCompany.cin || "",
    contactEmail: initialCompany.contactEmail || "",
    contactPhone: initialCompany.contactPhone || "",
    baseCurrency: initialCompany.baseCurrency,
    timezone: initialCompany.timezone,
    fyStartMonth: initialCompany.fyStartMonth,
    defaultStoreId: initialCompany.defaultStoreId || "",
  });

  const [logoUrl, setLogoUrl] = useState<string | null>(initialCompany.logoUrl || null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMsg({ type: "error", text: "Logo image file size must be less than 2MB." });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      try {
        setLogoUploading(true);
        setMsg(null);
        const res = await uploadCompanyLogo(base64String, file.name);
        if (res.success) {
          setLogoUrl(res.logoUrl);
          setMsg({ type: "success", text: "Logo uploaded successfully. Refreshing layout..." });
          // Reload page to update header/sidebar logo
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (err: any) {
        setMsg({ type: "error", text: err.message || "Failed to upload logo." });
      } finally {
        setLogoUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    try {
      await updateCompanyDetails({
        ...formData,
        defaultStoreId: formData.defaultStoreId || null,
      });
      setMsg({ type: "success", text: "Company details updated successfully! Reloading..." });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to update company details." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 font-body text-xs text-onyx">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-onyx">Company Profile</h2>
        <p className="text-xs text-onyx/50 mt-1">
          Manage legal registration identifiers, contact details, currency, default warehouse, and company branding.
        </p>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl border flex items-start space-x-2.5 font-semibold ${msg.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          {msg.type === "success" ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left block: Branding & Logo */}
        <div className="lg:col-span-1 glass-card p-6 rounded-xl border border-onyx/5 bg-white space-y-6 flex flex-col items-center">
          <h3 className="font-bold text-sm tracking-wide self-start border-b border-cream-dark pb-2 w-full">
            Company Logo & Branding
          </h3>
          
          <div className="relative w-40 h-40 bg-cream border border-onyx/10 rounded-xl flex items-center justify-center overflow-hidden shadow-inner group">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo Preview" className="w-full h-full object-contain p-4 bg-white" />
            ) : (
              <div className="flex flex-col items-center justify-center text-onyx/30">
                <Building2 size={48} className="stroke-1" />
                <span className="text-[10px] font-bold mt-2">NO LOGO</span>
              </div>
            )}
            {logoUploading && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center text-white font-bold">
                Uploading...
              </div>
            )}
          </div>

          <div className="w-full text-center">
            <label className="inline-flex items-center space-x-2 px-4 py-2 bg-cream hover:bg-cream-dark border border-onyx/10 rounded-lg text-xs font-bold text-onyx shadow-sm transition-all duration-150 cursor-pointer">
              <Upload size={14} />
              <span>{logoUrl ? "Change Logo" : "Upload Logo"}</span>
              <input
                type="file"
                accept="image/png, image/jpeg, image/svg+xml"
                onChange={handleLogoUpload}
                className="hidden"
                disabled={logoUploading}
              />
            </label>
            <p className="text-[10px] text-onyx/40 mt-2.5 leading-relaxed">
              Supports PNG, JPG, or SVG.<br />Recommended square or landscape layout, max 2MB.
            </p>
          </div>
        </div>

        {/* Right block: Settings Form */}
        <div className="lg:col-span-2 glass-card p-6 rounded-xl border border-onyx/5 bg-white">
          <h3 className="font-bold text-sm tracking-wide border-b border-cream-dark pb-2 mb-6 w-full">
            General Registration Details
          </h3>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Display Name *</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                  placeholder="e.g. Saarlekha Industries Noida"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold text-onyx"
                  required
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Legal Entity Name</label>
                <input
                  type="text"
                  value={formData.legalName}
                  onChange={(e) => setFormData(prev => ({ ...prev, legalName: e.target.value }))}
                  placeholder="e.g. Saarlekha Industries Pvt Ltd"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>
            </div>

            <div>
              <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Registered Address</label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                placeholder="e.g. Plot No. 45, Phase 1, Industrial Area, Noida, UP"
                className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[70px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">City</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  placeholder="e.g. Noida"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Governing Law Place (State/Country) *</label>
                <input
                  type="text"
                  value={formData.governingPlace}
                  onChange={(e) => setFormData(prev => ({ ...prev, governingPlace: e.target.value }))}
                  placeholder="e.g. Delhi, India"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">GSTIN</label>
                <input
                  type="text"
                  value={formData.gstin}
                  onChange={(e) => setFormData(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))}
                  placeholder="e.g. 09AAAAA0000A1Z5"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron uppercase font-mono"
                  maxLength={15}
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">PAN</label>
                <input
                  type="text"
                  value={formData.pan}
                  onChange={(e) => setFormData(prev => ({ ...prev, pan: e.target.value.toUpperCase() }))}
                  placeholder="e.g. ABCDE1234F"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron uppercase font-mono"
                  maxLength={10}
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">CIN (Corporate ID)</label>
                <input
                  type="text"
                  value={formData.cin}
                  onChange={(e) => setFormData(prev => ({ ...prev, cin: e.target.value.toUpperCase() }))}
                  placeholder="e.g. L01234DL2010PTC012345"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron uppercase font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Contact Email</label>
                <input
                  type="email"
                  value={formData.contactEmail}
                  onChange={(e) => setFormData(prev => ({ ...prev, contactEmail: e.target.value }))}
                  placeholder="e.g. support@saarlekha.in"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={formData.contactPhone}
                  onChange={(e) => setFormData(prev => ({ ...prev, contactPhone: e.target.value }))}
                  placeholder="e.g. +91 120 4444555"
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 pt-4 border-t border-onyx/5">
              <div className="col-span-1">
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Base Currency</label>
                <select
                  value={formData.baseCurrency}
                  onChange={(e) => setFormData(prev => ({ ...prev, baseCurrency: e.target.value }))}
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none font-bold font-mono text-onyx cursor-pointer"
                  required
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AED">AED (د.إ)</option>
                  <option value="SGD">SGD (S$)</option>
                  <option value="SAR">SAR (ر.س)</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none font-semibold text-onyx"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">Europe/London</option>
                </select>
              </div>

              <div className="col-span-1">
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">FY Start Month</label>
                <select
                  value={formData.fyStartMonth}
                  onChange={(e) => setFormData(prev => ({ ...prev, fyStartMonth: Number(e.target.value) }))}
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none font-semibold"
                >
                  <option value={1}>January</option>
                  <option value={4}>April</option>
                  <option value={7}>July</option>
                  <option value={10}>October</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Default Warehouse / Store</label>
              <select
                value={formData.defaultStoreId}
                onChange={(e) => setFormData(prev => ({ ...prev, defaultStoreId: e.target.value }))}
                className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none font-semibold"
              >
                <option value="">No Default (Ask user on entry)</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end pt-4 border-t border-onyx/5">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow-md transition-all duration-150 disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Saving changes..." : "Save Company Profile"}
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}
