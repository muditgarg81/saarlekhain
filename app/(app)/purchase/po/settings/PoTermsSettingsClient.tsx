"use client";

import { useState } from "react";
import { 
  updateTermsConfig, 
  updateCompanyIdentity, 
  clonePreset, 
  updatePreset 
} from "@/app/actions/termsPresets";
import { PoType } from "@prisma/client";
import { 
  Building2, 
  Settings, 
  FileText, 
  ArrowLeft, 
  Check, 
  RefreshCw, 
  AlertCircle, 
  Edit3, 
  Eye, 
  HelpCircle,
  Sparkles
} from "lucide-react";
import Link from "next/link";

interface Preset {
  id: string;
  companyId: string | null;
  key: string;
  name: string;
  description: string | null;
  appliesTo: PoType[];
  isDefault: boolean;
  bodyMarkdown: string;
  tokenDefaults: any;
  version: number;
  status: string;
}

interface TermsConfig {
  id: string;
  companyId: string;
  inspectionDays: number;
  replacementDays: number;
  returnCollectionDays: number;
  qtyTolerancePct: number;
  warrantyMonths: number;
  sparesYears: number;
  ldPctPerDay: number;
  ldCapPct: number;
  creditDays: number;
  latentDefectDays: number;
  fmTerminationDays: number;
  cureDays: number;
  arbitrationForum: string;
  jurisdictionCity: string | null;
}

interface CompanyProfile {
  name: string;
  address: string | null;
  gstin: string | null;
  city: string | null;
  governingPlace: string | null;
}

interface PoTermsSettingsClientProps {
  initialPresets: Preset[];
  initialConfig: TermsConfig | null;
  initialProfile: CompanyProfile | null;
}

export default function PoTermsSettingsClient({
  initialPresets,
  initialConfig,
  initialProfile
}: PoTermsSettingsClientProps) {
  const [presets, setPresets] = useState<Preset[]>(initialPresets);
  const [config, setConfig] = useState<TermsConfig | null>(initialConfig);
  const [profile, setProfile] = useState<CompanyProfile | null>(initialProfile);

  const [activeTab, setActiveTab] = useState<"presets" | "defaults" | "identity">("presets");
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(
    initialPresets.length > 0 ? initialPresets[0].key : ""
  );

  // Editing state for presets
  const [isEditingPreset, setIsEditingPreset] = useState(false);
  const [editPresetForm, setEditPresetForm] = useState<{
    name: string;
    description: string;
    bodyMarkdown: string;
    appliesTo: PoType[];
    isDefault: boolean;
    tokenDefaultsString: string;
  }>({
    name: "",
    description: "",
    bodyMarkdown: "",
    appliesTo: [],
    isDefault: false,
    tokenDefaultsString: "",
  });

  // Saving states
  const [savingLoading, setSavingLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedPreset = presets.find(p => p.key === selectedPresetKey) || presets[0];

  // Handler for saving config
  const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!config) return;
    setSavingLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const res = await updateTermsConfig(config);
    setSavingLoading(false);
    if (res.success) {
      setSuccessMsg("Commercial default configuration updated successfully!");
      if (res.config) setConfig(res.config as any);
    } else {
      setErrorMsg(res.error || "Failed to update configuration");
    }
  };

  // Handler for saving identity profile
  const handleSaveIdentity = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profile) return;
    setSavingLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const res = await updateCompanyIdentity(profile);
    setSavingLoading(false);
    if (res.success) {
      setSuccessMsg("Company identity profile updated successfully!");
    } else {
      setErrorMsg(res.error || "Failed to update profile");
    }
  };

  // Handler for cloning preset
  const handleClonePreset = async (key: string) => {
    setSavingLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const res = await clonePreset(key);
    setSavingLoading(false);
    if (res.success && res.preset) {
      // Refresh presets list
      const updatedPresets = presets.map(p => p.key === key ? (res.preset as any) : p);
      setPresets(updatedPresets);
      startEditPreset(res.preset as any);
      setSuccessMsg(`Preset successfully cloned for customization!`);
    } else {
      setErrorMsg(res.error || "Failed to clone preset");
    }
  };

  const startEditPreset = (p: Preset) => {
    setEditPresetForm({
      name: p.name,
      description: p.description || "",
      bodyMarkdown: p.bodyMarkdown,
      appliesTo: p.appliesTo,
      isDefault: p.isDefault,
      tokenDefaultsString: JSON.stringify(p.tokenDefaults || {}, null, 2),
    });
    setIsEditingPreset(true);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let parsedDefaults = {};
      try {
        parsedDefaults = JSON.parse(editPresetForm.tokenDefaultsString || "{}");
      } catch (err) {
        throw new Error("Invalid JSON in token defaults field");
      }

      const res = await updatePreset(selectedPreset.key, {
        name: editPresetForm.name,
        description: editPresetForm.description,
        bodyMarkdown: editPresetForm.bodyMarkdown,
        appliesTo: editPresetForm.appliesTo,
        isDefault: editPresetForm.isDefault,
        tokenDefaults: parsedDefaults,
      });

      setSavingLoading(false);
      if (res.success && res.preset) {
        // Refresh presets list
        const updatedPresets = presets.map(p => p.key === selectedPreset.key ? (res.preset as any) : p);
        setPresets(updatedPresets);
        setIsEditingPreset(false);
        setSuccessMsg(`Preset "${editPresetForm.name}" updated successfully!`);
      } else {
        setErrorMsg(res.error || "Failed to save preset");
      }
    } catch (err: any) {
      setSavingLoading(false);
      setErrorMsg(err.message || "An error occurred");
    }
  };

  // Client-side Token Resolution Engine for live preview
  const resolvePreviewText = (markdown: string, tokenDefaultsOverride?: any) => {
    let text = markdown || "";
    if (!text) return "";

    let tokenDefaults = {};
    try {
      tokenDefaults = tokenDefaultsOverride 
        ? tokenDefaultsOverride 
        : JSON.parse(editPresetForm.tokenDefaultsString || "{}");
    } catch (e) {}

    const defaults = {
      inspectionDays: config?.inspectionDays ?? 7,
      replacementDays: config?.replacementDays ?? 15,
      returnCollectionDays: config?.returnCollectionDays ?? 30,
      qtyTolerancePct: config?.qtyTolerancePct ?? 0,
      warrantyMonths: config?.warrantyMonths ?? 24,
      sparesYears: config?.sparesYears ?? 10,
      ldPctPerDay: config?.ldPctPerDay ?? 0.5,
      ldCapPct: config?.ldCapPct ?? 10,
      creditDays: config?.creditDays ?? 45,
      latentDefectDays: config?.latentDefectDays ?? 90,
      fmTerminationDays: config?.fmTerminationDays ?? 45,
      cureDays: config?.cureDays ?? 30,
      arbitrationForum: config?.arbitrationForum ?? "Arbitration and Conciliation Act, 1996",
      jurisdictionCity: config?.jurisdictionCity ?? profile?.city ?? "New Delhi",
    };

    const previewPo = {
      number: "PO-2026-00042",
      orderDate: new Date(),
      freightTerms: "FOB Destination",
      shipTo: "Plot No. 45, Industrial Area, Phase 1, New Delhi",
      paymentTerms: "Net 45 Days",
    };

    const resolverMap: Record<string, any> = {
      COMPANY_NAME: profile?.name || "SAARLEKHA INDUSTRIES PVT LTD",
      COMPANY_ADDRESS: profile?.address || "[Missing Company Address]",
      COMPANY_GSTIN: profile?.gstin || "[Missing Company GSTIN]",
      COMPANY_CITY: profile?.city || "[Missing Company City]",
      GOVERNING_PLACE: profile?.governingPlace || "[Missing Governing Place]",

      PO_NUMBER: previewPo.number,
      PO_DATE: previewPo.orderDate.toLocaleDateString("en-IN"),
      DELIVERY_TERMS: previewPo.freightTerms,
      DELIVERY_LOCATION: previewPo.shipTo,
      PAYMENT_MODE: previewPo.paymentTerms,

      CREDIT_DAYS: (tokenDefaults as any).creditDays ?? defaults.creditDays,
      INSPECTION_DAYS: (tokenDefaults as any).inspectionDays ?? defaults.inspectionDays,
      REPLACEMENT_DAYS: (tokenDefaults as any).replacementDays ?? defaults.replacementDays,
      RETURN_COLLECTION_DAYS: (tokenDefaults as any).returnCollectionDays ?? defaults.returnCollectionDays,
      QTY_TOLERANCE_PCT: (tokenDefaults as any).qtyTolerancePct ?? defaults.qtyTolerancePct,
      WARRANTY_MONTHS: (tokenDefaults as any).warrantyMonths ?? defaults.warrantyMonths,
      LATENT_DEFECT_DAYS: (tokenDefaults as any).latentDefectDays ?? defaults.latentDefectDays,
      SPARES_YEARS: (tokenDefaults as any).sparesYears ?? defaults.sparesYears,
      LD_PCT_PER_DAY: (tokenDefaults as any).ldPctPerDay ?? defaults.ldPctPerDay,
      LD_CAP_PCT: (tokenDefaults as any).ldCapPct ?? defaults.ldCapPct,
      FM_TERMINATION_DAYS: (tokenDefaults as any).fmTerminationDays ?? defaults.fmTerminationDays,
      CURE_DAYS: (tokenDefaults as any).cureDays ?? defaults.cureDays,
      ARBITRATION_FORUM: (tokenDefaults as any).arbitrationForum ?? defaults.arbitrationForum,
      JURISDICTION_CITY: (tokenDefaults as any).jurisdictionCity ?? defaults.jurisdictionCity,
    };

    // Replace all placeholders
    Object.entries(resolverMap).forEach(([token, val]) => {
      text = text.replaceAll(`{{${token}}}`, String(val));
    });

    return text;
  };

  // Markdown renderer
  const renderMarkdownToHtml = (md: string) => {
    if (!md) return "";
    let html = md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.*?)_/g, "<em>$1</em>");

    // Monospace code
    html = html.replace(/`(.*?)`/g, "<code class='px-1.5 py-0.5 bg-onyx/5 font-mono text-xs rounded text-saffron-dark font-bold'>$1</code>");

    // Bullet points
    html = html.split("\n").map(line => {
      if (line.trim().startsWith("- ")) {
        return `<li class="ml-4 list-disc text-xs text-onyx/75 mb-1">${line.trim().substring(2)}</li>`;
      }
      return line;
    }).join("\n");

    // Newlines to br or paragraphs
    html = html.split("\n\n").map(para => {
      if (para.trim().startsWith("<li")) {
        return `<ul class="my-2">${para}</ul>`;
      }
      return `<p class="text-xs text-onyx/80 leading-relaxed mb-3">${para.replace(/\n/g, "<br/>")}</p>`;
    }).join("");

    return html;
  };

  const previewBody = isEditingPreset 
    ? resolvePreviewText(editPresetForm.bodyMarkdown) 
    : resolvePreviewText(selectedPreset.bodyMarkdown, selectedPreset.tokenDefaults);

  const previewHtml = renderMarkdownToHtml(previewBody);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-semibold text-onyx/40 mb-1 hover:text-onyx transition-colors">
            <ArrowLeft size={12} />
            <Link href="/purchase/po">Back to Purchase Orders Register</Link>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">PO Terms & Conditions Settings</h2>
          <p className="text-xs text-onyx/50 mt-1">Configure company profiles, commercial default parameters, and manage PO terms preset templates.</p>
        </div>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-red-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
          <span className="whitespace-pre-line">{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-green-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <Check className="text-green-500 shrink-0 mt-0.5" size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-onyx/10 space-x-6">
        <button
          onClick={() => { setActiveTab("presets"); setIsEditingPreset(false); setErrorMsg(null); setSuccessMsg(null); }}
          className={`pb-2.5 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer transition-all duration-200 border-b-2 ${
            activeTab === "presets" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          <FileText size={14} />
          <span>T&C Presets Catalog</span>
        </button>
        <button
          onClick={() => { setActiveTab("defaults"); setIsEditingPreset(false); setErrorMsg(null); setSuccessMsg(null); }}
          className={`pb-2.5 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer transition-all duration-200 border-b-2 ${
            activeTab === "defaults" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          <Settings size={14} />
          <span>Commercial Defaults</span>
        </button>
        <button
          onClick={() => { setActiveTab("identity"); setIsEditingPreset(false); setErrorMsg(null); setSuccessMsg(null); }}
          className={`pb-2.5 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer transition-all duration-200 border-b-2 ${
            activeTab === "identity" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          <Building2 size={14} />
          <span>Company Identity Profile</span>
        </button>
      </div>

      {/* TAB CONTENT: PRESETS */}
      {activeTab === "presets" && !isEditingPreset && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Presets List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-onyx/65 uppercase tracking-wider">Available Templates</h3>
            <div className="space-y-2.5">
              {presets.map(p => {
                const isSystem = p.companyId === null;
                return (
                  <button
                    key={p.key}
                    onClick={() => { setSelectedPresetKey(p.key); setErrorMsg(null); setSuccessMsg(null); }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all duration-150 flex flex-col items-start cursor-pointer shadow-xs ${
                      selectedPresetKey === p.key
                        ? "bg-cream-dark border-saffron shadow-sm"
                        : "bg-cream/40 border-onyx/5 hover:border-onyx/10 hover:bg-cream-dark/20"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-bold text-xs text-onyx">{p.name}</span>
                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        isSystem 
                          ? "bg-blue-50 text-blue-600 border border-blue-100" 
                          : "bg-saffron/20 text-saffron-dark border border-saffron/30"
                      }`}>
                        {isSystem ? "System Preset" : "Company Customized"}
                      </span>
                    </div>
                    <p className="text-[10px] text-onyx/55 mt-1.5 leading-relaxed truncate w-full">{p.description}</p>
                    <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[8px] text-onyx/40 font-bold uppercase tracking-wider">Applies to:</span>
                      {p.appliesTo.map(t => (
                        <span key={t} className="text-[8px] bg-onyx/5 text-onyx/75 font-mono font-bold px-1 py-0.2 rounded border border-onyx/5">{t}</span>
                      ))}
                      {p.isDefault && (
                        <span className="text-[8px] bg-green-50 text-green-600 font-bold px-1.5 py-0.2 rounded border border-green-200">DEFAULT</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preset Detail & Live Preview */}
          <div className="md:col-span-2 glass-card rounded-xl border border-onyx/5 p-6 flex flex-col space-y-6 shadow-sm">
            <div className="flex items-start justify-between border-b border-onyx/5 pb-4">
              <div>
                <h3 className="text-sm font-bold text-onyx">{selectedPreset.name}</h3>
                <p className="text-xs text-onyx/55 mt-1">{selectedPreset.description}</p>
                <div className="mt-2 text-[10px] text-onyx/40 font-semibold flex items-center space-x-3">
                  <span>Version: v{selectedPreset.version}</span>
                  <span>•</span>
                  <span>Applies to PO Types: {selectedPreset.appliesTo.join(", ")}</span>
                  <span>•</span>
                  <span>Is Default: {selectedPreset.isDefault ? "Yes" : "No"}</span>
                </div>
              </div>
              <div className="shrink-0 flex items-center space-x-2">
                {selectedPreset.companyId === null ? (
                  <button
                    onClick={() => handleClonePreset(selectedPreset.key)}
                    disabled={savingLoading}
                    className="flex items-center space-x-1 px-3 py-2 bg-saffron hover:bg-saffron-dark text-xs font-bold text-onyx rounded-lg shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Edit3 size={13} />
                    <span>Customize (Clone)</span>
                  </button>
                ) : (
                  <button
                    onClick={() => startEditPreset(selectedPreset)}
                    className="flex items-center space-x-1 px-3 py-2 bg-onyx hover:bg-onyx-light text-xs font-bold text-cream-light rounded-lg shadow-sm cursor-pointer"
                  >
                    <Edit3 size={13} />
                    <span>Edit Preset</span>
                  </button>
                )}
              </div>
            </div>

            {/* Resolved Preview container */}
            <div className="space-y-3 flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-onyx/50 uppercase tracking-wider flex items-center space-x-1">
                  <Sparkles size={12} className="text-saffron-dark animate-pulse" />
                  <span>Live Token-Resolved Preview</span>
                </span>
                <span className="text-[9px] font-mono text-saffron-dark font-semibold bg-saffron/10 border border-saffron/20 px-2 py-0.5 rounded-full">
                  Fully Resolved
                </span>
              </div>
              <div className="flex-1 bg-cream-dark/25 border border-onyx/5 rounded-xl p-5 overflow-y-auto max-h-[50vh] font-sans">
                {previewHtml ? (
                  <div 
                    className="prose prose-sm prose-slate max-w-none text-onyx"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="text-center py-12 text-onyx/40 text-xs">No preset body to show.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PRESET VIEW */}
      {activeTab === "presets" && isEditingPreset && (
        <form onSubmit={handleSavePreset} className="glass-card rounded-xl border border-onyx/5 p-6 space-y-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-onyx/5 pb-4">
            <div>
              <h3 className="font-heading text-sm font-bold flex items-center space-x-2">
                <span>Customizing Template:</span>
                <span className="text-saffron-dark font-mono text-xs">[{selectedPreset.key}]</span>
              </h3>
              <p className="text-[10px] text-onyx/50 mt-1">Modify terms markdown and token defaults. Saving overrides system defaults for all future PO generation.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsEditingPreset(false)}
              className="text-xs px-3 py-1.5 border border-onyx/10 rounded-lg hover:bg-cream-dark transition cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Preset Display Name *</label>
              <input
                type="text"
                value={editPresetForm.name}
                onChange={(e) => setEditPresetForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Description</label>
              <input
                type="text"
                value={editPresetForm.description}
                onChange={(e) => setEditPresetForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Applicable PO Types *</label>
              <div className="flex items-center space-x-4 p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg flex-wrap gap-y-2">
                {Object.values(PoType).map(t => {
                  const checked = editPresetForm.appliesTo.includes(t);
                  return (
                    <label key={t} className="inline-flex items-center space-x-1.5 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const list = checked 
                            ? editPresetForm.appliesTo.filter(x => x !== t)
                            : [...editPresetForm.appliesTo, t];
                          setEditPresetForm(prev => ({ ...prev, appliesTo: list }));
                        }}
                        className="rounded text-saffron focus:ring-saffron"
                      />
                      <span className="font-mono text-[10px]">{t}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center pt-5">
              <label className="inline-flex items-center space-x-2 text-xs font-bold text-onyx cursor-pointer">
                <input
                  type="checkbox"
                  checked={editPresetForm.isDefault}
                  onChange={(e) => setEditPresetForm(prev => ({ ...prev, isDefault: e.target.checked }))}
                  className="rounded text-saffron focus:ring-saffron"
                />
                <span>Set as DEFAULT Preset for chosen PO Types</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Editor column */}
            <div className="md:col-span-2 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">
                  Preset Body (Markdown template) *
                </label>
                <textarea
                  value={editPresetForm.bodyMarkdown}
                  onChange={(e) => setEditPresetForm(prev => ({ ...prev, bodyMarkdown: e.target.value }))}
                  className="w-full text-xs p-3 bg-cream-dark/45 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[350px] font-mono leading-relaxed resize-y"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">
                  Preset-Level Override Token Defaults (JSON)
                </label>
                <textarea
                  value={editPresetForm.tokenDefaultsString}
                  onChange={(e) => setEditPresetForm(prev => ({ ...prev, tokenDefaultsString: e.target.value }))}
                  className="w-full text-xs p-3 bg-cream-dark/45 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[80px] font-mono leading-relaxed"
                  placeholder="{}"
                />
              </div>
            </div>

            {/* Resolved Preview Column */}
            <div className="space-y-3 flex flex-col">
              <span className="text-[10px] font-bold text-onyx/50 uppercase tracking-wider flex items-center space-x-1">
                <Sparkles size={12} className="text-saffron-dark animate-pulse" />
                <span>Live Resolved Preview</span>
              </span>
              <div className="flex-1 bg-cream-dark/25 border border-onyx/5 rounded-xl p-4 overflow-y-auto max-h-[460px] font-sans">
                {previewHtml ? (
                  <div 
                    className="prose prose-sm max-w-none text-onyx"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="text-center py-12 text-onyx/40 text-xs">Live resolved template preview...</div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-onyx/5">
            <button
              type="button"
              onClick={() => setIsEditingPreset(false)}
              className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-bold hover:bg-cream-dark cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingLoading}
              className="flex items-center space-x-1 px-4.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md cursor-pointer disabled:opacity-50"
            >
              {savingLoading ? <RefreshCw className="animate-spin" size={13} /> : <Check size={13} />}
              <span>Save Template changes</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB CONTENT: COMMERCIAL DEFAULTS */}
      {activeTab === "defaults" && config && (
        <form onSubmit={handleSaveConfig} className="glass-card rounded-xl border border-onyx/5 p-6 space-y-6 shadow-sm">
          <div className="border-b border-onyx/5 pb-4">
            <h3 className="text-sm font-heading font-bold">Company PO Commercial Defaults</h3>
            <p className="text-xs text-onyx/50 mt-1">Configure default values utilized for resolving commercial terms across presets if not explicitly set on the PO or Vendor.</p>
          </div>

          {/* Grid layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {/* Payment & Credit */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-onyx/65 uppercase tracking-wider border-b border-onyx/5 pb-1">Payment & Credit</h4>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Default Credit Days</label>
                <input
                  type="number"
                  value={config.creditDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, creditDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Arbitration Act/Forum</label>
                <input
                  type="text"
                  value={config.arbitrationForum}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, arbitrationForum: e.target.value }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Default Jurisdiction City</label>
                <input
                  type="text"
                  value={config.jurisdictionCity || ""}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, jurisdictionCity: e.target.value || null }) : null)}
                  placeholder="Defaults to company city"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>
            </div>

            {/* Quality & Deliveries */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-onyx/65 uppercase tracking-wider border-b border-onyx/5 pb-1">QC & Goods Handling</h4>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Inspection Window (Days)</label>
                <input
                  type="number"
                  value={config.inspectionDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, inspectionDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Replacement Deadline (Days)</label>
                <input
                  type="number"
                  value={config.replacementDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, replacementDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Return Collection Deadline (Days)</label>
                <input
                  type="number"
                  value={config.returnCollectionDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, returnCollectionDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
            </div>

            {/* Warranties & Penalties */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-onyx/65 uppercase tracking-wider border-b border-onyx/5 pb-1">Warranties & Penalties</h4>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Default Warranty (Months)</label>
                <input
                  type="number"
                  value={config.warrantyMonths}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, warrantyMonths: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">LD Rate (% per day)</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.ldPctPerDay}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, ldPctPerDay: parseFloat(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">LD Maximum Cap (% of PO)</label>
                <input
                  type="number"
                  value={config.ldCapPct}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, ldCapPct: parseFloat(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
            </div>

            {/* Job-work & Contract Extra Defaults */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-onyx/65 uppercase tracking-wider border-b border-onyx/5 pb-1">Spares & Safety</h4>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Latent Defect Window (Days)</label>
                <input
                  type="number"
                  value={config.latentDefectDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, latentDefectDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Spares Availability (Years)</label>
                <input
                  type="number"
                  value={config.sparesYears}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, sparesYears: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Qty Tolerance (%)</label>
                <input
                  type="number"
                  value={config.qtyTolerancePct}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, qtyTolerancePct: parseFloat(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
            </div>

            {/* Termination & Clauses */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-onyx/65 uppercase tracking-wider border-b border-onyx/5 pb-1">Termination & Force Majeure</h4>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">FM Termination Threshold (Days)</label>
                <input
                  type="number"
                  value={config.fmTerminationDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, fmTerminationDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-onyx/75 mb-1">Default Breach Cure Period (Days)</label>
                <input
                  type="number"
                  value={config.cureDays}
                  onChange={(e) => setConfig(prev => prev ? ({ ...prev, cureDays: parseInt(e.target.value) || 0 }) : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-onyx/5">
            <button
              type="submit"
              disabled={savingLoading}
              className="flex items-center space-x-1 px-4.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md cursor-pointer disabled:opacity-50"
            >
              {savingLoading ? <RefreshCw className="animate-spin" size={13} /> : <Check size={13} />}
              <span>Save Configuration</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB CONTENT: COMPANY IDENTITY PROFILE */}
      {activeTab === "identity" && profile && (
        <form onSubmit={handleSaveIdentity} className="glass-card rounded-xl border border-onyx/5 p-6 space-y-6 shadow-sm">
          <div className="border-b border-onyx/5 pb-4">
            <h3 className="text-sm font-heading font-bold">Company Identity Information</h3>
            <p className="text-xs text-onyx/50 mt-1">Populate details that auto-fill into identity tokens (such as COMPANY_ADDRESS, COMPANY_GSTIN) across all preset clauses.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Registered Company Name (Read-Only)</label>
              <input
                type="text"
                value={profile.name}
                className="w-full text-xs p-2.5 bg-cream-dark/45 border border-onyx/10 rounded-lg text-onyx/50 font-bold"
                disabled
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Company GSTIN</label>
              <input
                type="text"
                value={profile.gstin || ""}
                onChange={(e) => setProfile(prev => prev ? ({ ...prev, gstin: e.target.value.toUpperCase() }) : null)}
                placeholder="GSTIN Code (e.g. 07AAAAA1111A1Z1)"
                className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Registered Corporate Address</label>
              <textarea
                value={profile.address || ""}
                onChange={(e) => setProfile(prev => prev ? ({ ...prev, address: e.target.value }) : null)}
                placeholder="Full corporate headquarters or factory billing address"
                className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[70px] leading-relaxed"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">City</label>
              <input
                type="text"
                value={profile.city || ""}
                onChange={(e) => setProfile(prev => prev ? ({ ...prev, city: e.target.value }) : null)}
                placeholder="City of incorporation (e.g. New Delhi)"
                className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-onyx/70 mb-1">Governing Place / State</label>
              <input
                type="text"
                value={profile.governingPlace || ""}
                onChange={(e) => setProfile(prev => prev ? ({ ...prev, governingPlace: e.target.value }) : null)}
                placeholder="State / Country for Governing Law (e.g. Delhi, India)"
                className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-onyx/5">
            <button
              type="submit"
              disabled={savingLoading}
              className="flex items-center space-x-1 px-4.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md cursor-pointer disabled:opacity-50"
            >
              {savingLoading ? <RefreshCw className="animate-spin" size={13} /> : <Check size={13} />}
              <span>Save Profile</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
