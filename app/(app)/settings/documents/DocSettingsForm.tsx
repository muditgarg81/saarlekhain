"use client";

import { useState } from "react";
import { updateDocSettings, upsertNumberingScheme } from "@/app/actions/company";
import { FileText, Save, CheckCircle, AlertCircle, Edit, ListOrdered } from "lucide-react";

interface DocSettingsData {
  id: string;
  companyId: string;
  poHeaderNote?: string | null;
  poFooterNote?: string | null;
  authorizedSignatory?: string | null;
  declaration?: string | null;
  showBankDetails: boolean;
  bankDetails?: any;
}

interface NumberingData {
  id: string;
  docType: string;
  prefix: string;
  padding: number;
  resetOnFY: boolean;
}

interface DocSettingsFormProps {
  initialSettings: DocSettingsData;
  initialSchemes: NumberingData[];
  userPermissions: {
    docSettings: boolean;
    numbering: boolean;
  };
}

const DOC_TYPES = [
  { type: "PO", name: "Purchase Order" },
  { type: "GRN", name: "Goods Receipt Note" },
  { type: "PR", name: "Purchase Requisition" },
  { type: "RFQ", name: "Request for Quotation" },
  { type: "IND", name: "Indent Request" },
  { type: "ISS", name: "Material Issue" },
  { type: "GP", name: "Gate Pass" },
  { type: "INSP", name: "QC Inspection" },
  { type: "DN", name: "Debit Note" },
  { type: "CN", name: "Credit Note" },
  { type: "PAY", name: "Payment Voucher" },
];

export default function DocSettingsForm({
  initialSettings,
  initialSchemes,
  userPermissions,
}: DocSettingsFormProps) {
  // Document PDF text states
  const [poHeaderNote, setPoHeaderNote] = useState(initialSettings.poHeaderNote || "");
  const [poFooterNote, setPoFooterNote] = useState(initialSettings.poFooterNote || "");
  const [authorizedSignatory, setAuthorizedSignatory] = useState(initialSettings.authorizedSignatory || "");
  const [declaration, setDeclaration] = useState(initialSettings.declaration || "");
  const [showBankDetails, setShowBankDetails] = useState(initialSettings.showBankDetails);
  
  const initialBank = initialSettings.bankDetails || {};
  const [bankDetails, setBankDetails] = useState({
    bankName: initialBank.bankName || "",
    accountNo: initialBank.accountNo || "",
    ifscCode: initialBank.ifscCode || "",
    branchName: initialBank.branchName || "",
  });

  // Schemes states
  const [schemes, setSchemes] = useState<Record<string, { prefix: string; padding: number; resetOnFY: boolean }>>(
    DOC_TYPES.reduce((acc, dt) => {
      const match = initialSchemes.find((s) => s.docType === dt.type);
      acc[dt.type] = {
        prefix: match?.prefix || `${dt.type}-`,
        padding: match?.padding || 5,
        resetOnFY: match?.resetOnFY !== undefined ? match.resetOnFY : true,
      };
      return acc;
    }, {} as any)
  );

  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSaveDocSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPermissions.docSettings) return;
    setSavingSettings(true);
    setMsg(null);

    try {
      await updateDocSettings({
        poHeaderNote,
        poFooterNote,
        authorizedSignatory,
        declaration,
        showBankDetails,
        bankDetails,
      });
      setMsg({ type: "success", text: "PDF document branding settings saved successfully!" });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to save settings." });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveScheme = async (docType: string) => {
    if (!userPermissions.numbering) return;
    setMsg(null);
    const scheme = schemes[docType];

    try {
      await upsertNumberingScheme({
        docType,
        prefix: scheme.prefix,
        padding: Number(scheme.padding),
        resetOnFY: scheme.resetOnFY,
      });
      setMsg({ type: "success", text: `Numbering format for ${docType} updated successfully!` });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to update numbering format." });
    }
  };

  return (
    <div className="space-y-6 font-body text-xs text-onyx">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-onyx">Document & Sequence Configuration</h2>
        <p className="text-xs text-onyx/50 mt-1">
          Customize signatures, boilerplate notes, and sequencing schemes for purchase documents, indents, GRNs, and vouchers.
        </p>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl border flex items-start space-x-2.5 font-semibold ${msg.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          {msg.type === "success" ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Card: PDF Templates Notes & Signatures */}
        {userPermissions.docSettings ? (
          <div className="glass-card p-6 rounded-xl border border-onyx/5 bg-white space-y-5">
            <h3 className="font-bold text-sm tracking-wide border-b border-cream-dark pb-2 flex items-center space-x-2">
              <FileText size={16} className="text-saffron-dark" />
              <span>PDF Layouts & Boilerplate Notes</span>
            </h3>

            <form onSubmit={handleSaveDocSettings} className="space-y-4">
              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Purchase Order Header Note</label>
                <input
                  type="text"
                  value={poHeaderNote}
                  onChange={(e) => setPoHeaderNote(e.target.value)}
                  placeholder="e.g. Please deliver items per terms specified."
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Purchase Order Footer note / Terms</label>
                <textarea
                  value={poFooterNote}
                  onChange={(e) => setPoFooterNote(e.target.value)}
                  placeholder="e.g. Terms & Conditions apply."
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[60px]"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Standard PO Declaration Text</label>
                <textarea
                  value={declaration}
                  onChange={(e) => setDeclaration(e.target.value)}
                  placeholder="Boilerplate declaration..."
                  className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[60px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Authorized Signatory Label</label>
                  <input
                    type="text"
                    value={authorizedSignatory}
                    onChange={(e) => setAuthorizedSignatory(e.target.value)}
                    placeholder="e.g. Stores & Purchase Director"
                    className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold"
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center space-x-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={showBankDetails}
                      onChange={(e) => setShowBankDetails(e.target.checked)}
                      className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                    />
                    <span className="font-semibold">Show Bank details on PDF Invoice</span>
                  </label>
                </div>
              </div>

              {showBankDetails && (
                <div className="p-4 bg-cream/35 rounded-xl border border-cream-dark space-y-3">
                  <span className="text-[10px] font-bold text-onyx/60 uppercase block">Invoice Payment Bank Details</span>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Bank Name</label>
                      <input
                        type="text"
                        value={bankDetails.bankName}
                        onChange={(e) => setBankDetails(prev => ({ ...prev, bankName: e.target.value }))}
                        placeholder="e.g. State Bank of India"
                        className="w-full text-xs p-1.5 bg-cream border border-onyx/10 rounded-md focus:outline-none focus:border-saffron"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Account Number</label>
                      <input
                        type="text"
                        value={bankDetails.accountNo}
                        onChange={(e) => setBankDetails(prev => ({ ...prev, accountNo: e.target.value }))}
                        placeholder="e.g. 10002223334"
                        className="w-full text-xs p-1.5 bg-cream border border-onyx/10 rounded-md focus:outline-none focus:border-saffron font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">IFSC Code</label>
                      <input
                        type="text"
                        value={bankDetails.ifscCode}
                        onChange={(e) => setBankDetails(prev => ({ ...prev, ifscCode: e.target.value.toUpperCase() }))}
                        placeholder="e.g. SBIN0001234"
                        className="w-full text-xs p-1.5 bg-cream border border-onyx/10 rounded-md focus:outline-none focus:border-saffron uppercase font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Branch Name</label>
                      <input
                        type="text"
                        value={bankDetails.branchName}
                        onChange={(e) => setBankDetails(prev => ({ ...prev, branchName: e.target.value }))}
                        placeholder="e.g. Industrial Area Noida"
                        className="w-full text-xs p-1.5 bg-cream border border-onyx/10 rounded-md focus:outline-none focus:border-saffron"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-3">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="flex items-center space-x-2 px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow transition-all duration-150 cursor-pointer disabled:opacity-50"
                >
                  <Save size={14} />
                  <span>{savingSettings ? "Saving..." : "Save PDF Layout"}</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-4 bg-cream border border-onyx/5 rounded-xl text-center text-onyx/40">
            Branding settings are locked for your role.
          </div>
        )}

        {/* Right Card: Numbering Sequence Configuration */}
        {userPermissions.numbering ? (
          <div className="glass-card p-6 rounded-xl border border-onyx/5 bg-white space-y-4">
            <h3 className="font-bold text-sm tracking-wide border-b border-cream-dark pb-2 flex items-center space-x-2">
              <ListOrdered size={16} className="text-saffron-dark" />
              <span>Document Numbering Sequences</span>
            </h3>
            
            <p className="text-[10px] text-onyx/50 leading-normal">
              Define the prefix formats, sequence number padding, and whether the counter resets at the start of each Financial Year.
            </p>

            <div className="divide-y divide-cream-dark max-h-[440px] overflow-y-auto pr-1">
              {DOC_TYPES.map((dt) => {
                const s = schemes[dt.type] || { prefix: "", padding: 5, resetOnFY: true };
                return (
                  <div key={dt.type} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 first:pt-0 last:pb-0">
                    <div className="min-w-[120px]">
                      <h4 className="font-bold text-onyx text-xs">{dt.name}</h4>
                      <span className="text-[10px] text-onyx/40 font-mono">Type: {dt.type}</span>
                    </div>

                    <div className="flex items-center space-x-3 flex-1 max-w-md justify-end">
                      <div className="w-20">
                        <label className="block text-[8px] uppercase font-bold text-onyx/40 mb-0.5">Prefix</label>
                        <input
                          type="text"
                          value={s.prefix}
                          onChange={(e) => setSchemes(prev => ({
                            ...prev,
                            [dt.type]: { ...prev[dt.type], prefix: e.target.value }
                          }))}
                          className="w-full text-[11px] p-1 border border-onyx/10 bg-cream rounded font-mono uppercase"
                          maxLength={10}
                        />
                      </div>

                      <div className="w-12">
                        <label className="block text-[8px] uppercase font-bold text-onyx/40 mb-0.5">Digits</label>
                        <input
                          type="number"
                          value={s.padding}
                          onChange={(e) => setSchemes(prev => ({
                            ...prev,
                            [dt.type]: { ...prev[dt.type], padding: Number(e.target.value) }
                          }))}
                          className="w-full text-[11px] p-1 border border-onyx/10 bg-cream rounded font-mono text-center"
                          min={2}
                          max={8}
                        />
                      </div>

                      <div className="flex flex-col items-center">
                        <label className="block text-[8px] uppercase font-bold text-onyx/40 mb-0.5">FY Reset</label>
                        <input
                          type="checkbox"
                          checked={s.resetOnFY}
                          onChange={(e) => setSchemes(prev => ({
                            ...prev,
                            [dt.type]: { ...prev[dt.type], resetOnFY: e.target.checked }
                          }))}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron mt-1.5"
                        />
                      </div>

                      <button
                        onClick={() => handleSaveScheme(dt.type)}
                        className="flex items-center space-x-1.5 px-2.5 py-1.5 mt-2 bg-cream hover:bg-cream-dark border border-onyx/10 text-onyx font-bold rounded-lg text-[10px] shadow-sm transition-all duration-150 cursor-pointer"
                      >
                        <Edit size={10} />
                        <span>Update</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-cream border border-onyx/5 rounded-xl text-center text-onyx/40">
            Numbering schemes are locked for your role.
          </div>
        )}

      </div>
    </div>
  );
}
