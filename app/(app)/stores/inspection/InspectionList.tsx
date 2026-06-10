"use client";

import { useState, useRef } from "react";
import { submitInspectionResult } from "@/app/actions/inspections";
import { 
  Search, 
  X, 
  FileText, 
  UploadCloud, 
  Check, 
  Eye, 
  AlertTriangle,
  ClipboardList,
  ShieldCheck,
  ShieldAlert,
  Plus,
  Trash2
} from "lucide-react";

interface InspectionResult {
  id: string;
  paramName: string;
  observed: number | null;
  observedText: string | null;
  pass: boolean | null;
  specMin?: number | null;
  specMax?: number | null;
  specTarget?: number | null;
}

interface Inspection {
  id: string;
  number: string;
  grnNumber: string;
  grnLineId: string;
  itemName: string;
  itemCode: string;
  receivedQty: number;
  sampleSize: number;
  disposition: string | null;
  mtcRef: string | null;
  inspectedBy: string | null;
  inspectedAt: string | null;
  results: InspectionResult[];
}

interface InspectionListProps {
  initialInspections: Inspection[];
  userRole: string;
}

export default function InspectionList({ initialInspections, userRole }: InspectionListProps) {
  const [inspections, setInspections] = useState<Inspection[]>(initialInspections);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");

  // Detail & Action States
  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);

  // Form States
  const [disposition, setDisposition] = useState<"ACCEPT" | "REJECT" | "ACCEPT_WITH_DEVIATION" | "REWORK">("ACCEPT");
  const [mtcRef, setMtcRef] = useState("");
  const [acceptedQty, setAcceptedQty] = useState(0);
  const [rejectedQty, setRejectedQty] = useState(0);
  
  const [paramResults, setParamResults] = useState<Array<{
    id: string;
    paramName: string;
    observed: string;
    observedText: string;
    pass: boolean;
    specMin?: number | null;
    specMax?: number | null;
  }>>([]);

  // OCR MTC States
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrFeedback, setOcrFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isQC = ["ADMIN", "OWNER", "STORE_MANAGER", "QC_INSPECTOR"].includes(userRole);

  const filteredInspections = inspections.filter(i => {
    const matchesSearch = i.number.toLowerCase().includes(search.toLowerCase()) ||
                          i.itemName.toLowerCase().includes(search.toLowerCase()) ||
                          i.grnNumber.toLowerCase().includes(search.toLowerCase());
    
    let matchesStatus = false;
    if (statusFilter === "all") matchesStatus = true;
    else if (statusFilter === "pending") matchesStatus = !i.disposition;
    else if (statusFilter === "completed") matchesStatus = !!i.disposition;

    return matchesSearch && matchesStatus;
  });

  const handleOpenRecord = (insp: Inspection) => {
    setSelectedInspection(insp);
    setDisposition("ACCEPT");
    setMtcRef(insp.mtcRef || "");
    setAcceptedQty(insp.receivedQty);
    setRejectedQty(0);
    setErrorMsg(null);
    setOcrFeedback(null);

    // Initialize parameter entries
    const params = insp.results.map(r => ({
      id: r.id,
      paramName: r.paramName,
      observed: r.observed ? String(r.observed) : "",
      observedText: r.observedText || "",
      pass: r.pass !== null ? r.pass : true,
      specMin: r.specMin,
      specMax: r.specMax,
    }));
    setParamResults(params);
    setIsRecordOpen(true);
  };

  // Evaluate single parameter pass/fail based on specs
  const handleObservedValueChange = (index: number, valStr: string) => {
    setParamResults(prev => {
      return prev.map((param, idx) => {
        if (idx === index) {
          const val = parseFloat(valStr);
          let pass = true;

          if (!isNaN(val)) {
            if (param.specMin !== undefined && param.specMin !== null && val < param.specMin) {
              pass = false;
            }
            if (param.specMax !== undefined && param.specMax !== null && val > param.specMax) {
              pass = false;
            }
          }
          return { ...param, observed: valStr, pass };
        }
        return param;
      });
    });
  };

  // MTC OCR Upload
  const handleOcrMtcUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setOcrFeedback("Analyzing Material Test Certificate with Gemini...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/ocr/mtc", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success && result.data) {
          const data = result.data;
          setOcrFeedback("MTC values extracted and matched!");
          if (data.mtcRef) setMtcRef(data.mtcRef);
          
          if (Array.isArray(data.parameters)) {
            setParamResults(prev => {
              return prev.map(param => {
                const ocrParam = data.parameters.find((o: any) => 
                  o.name.toLowerCase().includes(param.paramName.toLowerCase()) ||
                  param.paramName.toLowerCase().includes(o.name.toLowerCase())
                );
                if (ocrParam && ocrParam.value !== undefined) {
                  const valStr = String(ocrParam.value);
                  const val = ocrParam.value;
                  let pass = true;
                  if (param.specMin !== undefined && param.specMin !== null && val < param.specMin) pass = false;
                  if (param.specMax !== undefined && param.specMax !== null && val > param.specMax) pass = false;
                  return { ...param, observed: valStr, pass };
                }
                return param;
              });
            });
          }
        }
      } else {
        setOcrFeedback("OCR extraction failed.");
      }
    } catch (err) {
      console.error(err);
      setOcrFeedback("Error communicating with OCR service.");
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInspection) return;

    if (acceptedQty + rejectedQty !== selectedInspection.receivedQty) {
      setErrorMsg(`Accepted (${acceptedQty}) + Rejected (${rejectedQty}) must equal total received (${selectedInspection.receivedQty}).`);
      return;
    }

    const hasBlankParam = paramResults.some(p => p.id.startsWith("new_") && !p.paramName.trim());
    if (hasBlankParam) {
      setErrorMsg("Please provide a name for all ad-hoc parameters.");
      return;
    }

    const payloadResults = paramResults.map(p => ({
      id: p.id,
      paramName: p.paramName,
      observed: p.observed ? parseFloat(p.observed) : null,
      observedText: p.observedText || null,
      pass: p.pass,
    }));

    setActionLoading(true);
    setErrorMsg(null);
    const res = await submitInspectionResult(selectedInspection.id, {
      disposition,
      mtcRef: mtcRef || null,
      acceptedQty,
      rejectedQty,
      results: payloadResults,
    });
    setActionLoading(false);

    if (res.success) {
      setIsRecordOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to submit inspection details");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-onyx">Incoming Material QC Testing</h2>
        <p className="text-xs text-onyx/50 mt-1">Verify material specifications, log test certificate results, and decide disposition.</p>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Search by QC no, item name, GRN number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        {/* Status Tab filters */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value="pending">Pending Inspections Only</option>
          <option value="completed">Completed QC Inspections</option>
          <option value="all">All Records</option>
        </select>
      </div>

      {/* Inspection List Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th>Inspection No</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Source GRN</th>
                <th className="text-right">Qty to Inspect</th>
                <th className="text-center">Sample size</th>
                <th>MTC Reference</th>
                <th className="text-center">Disposition</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInspections.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-onyx/40 font-medium">
                    No QC inspection records found.
                  </td>
                </tr>
              ) : (
                filteredInspections.map((insp) => {
                  return (
                    <tr key={insp.id}>
                      <td className="font-mono font-bold text-xs text-onyx/85">{insp.number}</td>
                      <td className="font-mono text-xs">{insp.itemCode}</td>
                      <td className="font-semibold">{insp.itemName}</td>
                      <td className="font-mono text-[11px] text-onyx/75">{insp.grnNumber}</td>
                      <td className="text-right font-mono font-bold">{insp.receivedQty}</td>
                      <td className="text-center font-semibold">{insp.sampleSize} units</td>
                      <td>{insp.mtcRef || "-"}</td>
                      <td className="text-center">
                        {insp.disposition ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            insp.disposition === "ACCEPT" ? "bg-green-100 text-green-800" :
                            insp.disposition === "REJECT" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                          }`}>
                            {insp.disposition.replace("_", " ")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-800 uppercase animate-pulse">
                            Pending QC
                          </span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => {
                              setSelectedInspection(insp);
                              setIsDetailOpen(true);
                            }}
                            title="View Results"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx"
                          >
                            <Eye size={13} />
                          </button>

                          {!insp.disposition && isQC && (
                            <button
                              onClick={() => handleOpenRecord(insp)}
                              title="Record QC Tests"
                              className="p-1 hover:bg-amber-50 text-amber-600 hover:text-amber-700 rounded border border-transparent hover:border-amber-200 cursor-pointer"
                            >
                              <ClipboardList size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Inspection Modal */}
      {isRecordOpen && selectedInspection && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-3xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Record Inspection Tests ({selectedInspection.number})</h3>
              <button onClick={() => setIsRecordOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* metadata card */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="font-semibold text-onyx/50">Item:</span>
                  <p className="font-bold text-onyx">[{selectedInspection.itemCode}] {selectedInspection.itemName}</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Total Qty:</span>
                  <p className="font-bold text-onyx font-mono">{selectedInspection.receivedQty} units</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Sample Size:</span>
                  <p className="font-bold text-onyx font-mono">{selectedInspection.sampleSize} units</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Source GRN:</span>
                  <p className="font-bold font-mono text-onyx">{selectedInspection.grnNumber}</p>
                </div>
              </div>

              {/* Gemini MTC Import */}
              <div className="border border-dashed border-onyx/10 p-4 rounded-xl bg-cream-dark/15 flex flex-col items-center justify-center text-center space-y-2 hover:bg-saffron/5">
                <UploadCloud size={24} className="text-saffron-dark" />
                <p className="text-[10px] font-bold text-onyx">Gemini MTC Test Certificate OCR</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleOcrMtcUpload} 
                  accept="image/*,application/pdf" 
                  className="hidden" 
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="px-3 py-1 bg-white border border-onyx/10 rounded-lg text-[10px] font-bold text-onyx shadow-sm hover:bg-cream-dark cursor-pointer disabled:opacity-50"
                >
                  {ocrLoading ? "Analyzing certificate..." : "Upload Certificate / MTC"}
                </button>
                {ocrFeedback && (
                  <p className="text-[10px] font-semibold text-saffron-dark">{ocrFeedback}</p>
                )}
              </div>

              {/* MTC Reference No */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Supplier MTC Test Certificate Reference
                </label>
                <input
                  type="text"
                  value={mtcRef}
                  onChange={(e) => setMtcRef(e.target.value)}
                  placeholder="e.g. HEAT-9018-TATA"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              {/* Test Parameters parameters */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Recorded Param Values
                </label>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-2.5 font-bold">Parameter</th>
                        <th className="p-2.5 font-bold text-center w-28">Specification Limits</th>
                        <th className="p-2.5 font-bold text-center w-28">Observed Value</th>
                        <th className="p-2.5 font-bold text-center w-28">Remarks / Notes</th>
                        <th className="p-2.5 font-bold text-center w-20">Pass/Fail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paramResults.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-4 text-onyx/40 italic">
                            No parameters logged. Click "Add Ad-hoc Parameter" to enter test results manually.
                          </td>
                        </tr>
                      ) : (
                        paramResults.map((param, idx) => {
                          const min = param.specMin !== null && param.specMin !== undefined ? param.specMin : "-";
                          const max = param.specMax !== null && param.specMax !== undefined ? param.specMax : "-";
                          return (
                            <tr key={param.id} className="border-t border-onyx/5">
                              <td className="p-2.5 font-semibold">
                                {param.id.startsWith("new_") ? (
                                  <input
                                    type="text"
                                    value={param.paramName}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setParamResults(prev => prev.map((p, i) => i === idx ? { ...p, paramName: val } : p));
                                    }}
                                    placeholder="e.g. Yarn Strength"
                                    className="w-full text-xs p-1 border border-onyx/15 rounded font-semibold text-onyx focus:outline-none focus:border-saffron"
                                    required
                                  />
                                ) : (
                                  param.paramName
                                )}
                              </td>
                              <td className="p-2.5 text-center font-mono text-onyx/60">
                                {param.id.startsWith("new_") ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <input
                                      type="number"
                                      step="any"
                                      value={param.specMin ?? ""}
                                      onChange={(e) => {
                                        const valStr = e.target.value;
                                        const val = valStr ? parseFloat(valStr) : null;
                                        setParamResults(prev => prev.map((p, i) => {
                                          if (i === idx) {
                                            const updated = { ...p, specMin: val };
                                            // Re-evaluate pass/fail
                                            const observedVal = parseFloat(p.observed);
                                            let pass = p.pass;
                                            if (!isNaN(observedVal)) {
                                              pass = true;
                                              if (val !== null && observedVal < val) pass = false;
                                              if (p.specMax !== null && p.specMax !== undefined && observedVal > p.specMax) pass = false;
                                            }
                                            return { ...updated, pass };
                                          }
                                          return p;
                                        }));
                                      }}
                                      placeholder="Min"
                                      className="w-12 text-center text-[10px] p-0.5 border border-onyx/15 rounded font-mono"
                                    />
                                    <span className="text-[10px] text-onyx/40">to</span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={param.specMax ?? ""}
                                      onChange={(e) => {
                                        const valStr = e.target.value;
                                        const val = valStr ? parseFloat(valStr) : null;
                                        setParamResults(prev => prev.map((p, i) => {
                                          if (i === idx) {
                                            const updated = { ...p, specMax: val };
                                            // Re-evaluate pass/fail
                                            const observedVal = parseFloat(p.observed);
                                            let pass = p.pass;
                                            if (!isNaN(observedVal)) {
                                              pass = true;
                                              if (p.specMin !== null && p.specMin !== undefined && observedVal < p.specMin) pass = false;
                                              if (val !== null && observedVal > val) pass = false;
                                            }
                                            return { ...updated, pass };
                                          }
                                          return p;
                                        }));
                                      }}
                                      placeholder="Max"
                                      className="w-12 text-center text-[10px] p-0.5 border border-onyx/15 rounded font-mono"
                                    />
                                  </div>
                                ) : (
                                  `${min} to ${max}`
                                )}
                              </td>
                              <td className="p-2.5 text-center">
                                <input
                                  type="number"
                                  step="any"
                                  value={param.observed}
                                  onChange={(e) => handleObservedValueChange(idx, e.target.value)}
                                  placeholder="Observed"
                                  className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono font-bold"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                <input
                                  type="text"
                                  value={param.observedText}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setParamResults(prev => prev.map((p, i) => i === idx ? { ...p, observedText: val } : p));
                                  }}
                                  placeholder="Remarks"
                                  className="w-full text-xs p-1 border border-onyx/15 rounded text-center"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setParamResults(prev => prev.map((p, i) => i === idx ? { ...p, pass: !p.pass } : p));
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer ${
                                      param.pass 
                                        ? "bg-green-100 text-green-800 hover:bg-green-200" 
                                        : "bg-red-100 text-red-800 hover:bg-red-200"
                                    }`}
                                    title="Click to toggle Pass/Fail"
                                  >
                                    {param.pass ? "PASS" : "FAIL"}
                                  </button>
                                  
                                  {param.id.startsWith("new_") && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setParamResults(prev => prev.filter((_, i) => i !== idx));
                                      }}
                                      className="text-red-500 hover:text-red-700 p-0.5 cursor-pointer shrink-0"
                                      title="Remove parameter"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  
                  {/* Add Parameter Button */}
                  <div className="p-2.5 bg-cream-dark/15 border-t border-onyx/5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const tempId = "new_" + Math.random().toString(36).substr(2, 9);
                        setParamResults(prev => [
                          ...prev,
                          {
                            id: tempId,
                            paramName: "",
                            observed: "",
                            observedText: "",
                            pass: true,
                            specMin: null,
                            specMax: null,
                          }
                        ]);
                      }}
                      className="px-2.5 py-1 bg-white border border-onyx/10 hover:border-onyx/20 rounded-lg text-[10px] font-bold text-onyx shadow-xs hover:bg-cream-dark/20 cursor-pointer flex items-center gap-1.5"
                    >
                      <Plus size={12} className="text-saffron-dark" />
                      <span>Add Ad-hoc Parameter</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Disposition & Qty routing */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-onyx/10 pt-5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Quality Disposition *
                  </label>
                  <select
                    value={disposition}
                    onChange={(e) => setDisposition(e.target.value as any)}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                    required
                  >
                    <option value="ACCEPT">Accept (Clear to Store)</option>
                    <option value="REJECT">Reject (Return to Vendor)</option>
                    <option value="ACCEPT_WITH_DEVIATION">Accept with Deviation</option>
                    <option value="REWORK">Rework Needed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Accepted Qty *
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={acceptedQty}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setAcceptedQty(val);
                      setRejectedQty(Math.max(0, selectedInspection.receivedQty - val));
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg font-mono font-bold text-green-700"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Rejected Qty *
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={rejectedQty}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setRejectedQty(val);
                      setAcceptedQty(Math.max(0, selectedInspection.receivedQty - val));
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg font-mono font-bold text-red-700"
                    required
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsRecordOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving..." : "Post QC Test Results"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details Side Drawer */}
      {isDetailOpen && selectedInspection && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedInspection.number}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                QC Inspection Report Details
              </h3>
              <p className="text-xs text-onyx/50">Item: [{selectedInspection.itemCode}] {selectedInspection.itemName}</p>
            </div>

            {/* QC results card */}
            <div className="py-4 grid grid-cols-2 gap-4 text-xs border-b border-onyx/5 bg-cream-dark/20 p-3 rounded-lg mt-4">
              <div>
                <span className="font-semibold text-onyx/50">Disposition:</span>
                <p className="font-bold text-onyx mt-0.5 uppercase">
                  {selectedInspection.disposition || "PENDING"}
                </p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">MTC Certificate Ref:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedInspection.mtcRef || "N/A"}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Total Inspected:</span>
                <p className="font-bold text-onyx font-mono mt-0.5">{selectedInspection.receivedQty} units</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Date Completed:</span>
                <p suppressHydrationWarning className="font-bold text-onyx mt-0.5">
                  {selectedInspection.inspectedAt ? new Date(selectedInspection.inspectedAt).toLocaleDateString() : "-"}
                </p>
              </div>
            </div>

            {/* Parameter results */}
            <div className="flex-1 overflow-y-auto py-6 space-y-4">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                QC Parameters Log
              </h4>

              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50">
                    <tr>
                      <th className="p-2 font-bold">Parameter</th>
                      <th className="p-2 font-bold text-center">Spec Limits</th>
                      <th className="p-2 font-bold text-center">Observed</th>
                      <th className="p-2 font-bold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInspection.results.map((line) => {
                      const min = line.specMin !== null && line.specMin !== undefined ? line.specMin : "-";
                      const max = line.specMax !== null && line.specMax !== undefined ? line.specMax : "-";
                      return (
                        <tr key={line.id} className="border-t border-onyx/5">
                          <td className="p-2 font-semibold">{line.paramName}</td>
                          <td className="p-2 text-center font-mono text-onyx/50">{min} to {max}</td>
                          <td className="p-2 text-center font-mono font-bold text-onyx">{line.observed || "-"}</td>
                          <td className="p-2 text-center">
                            {line.pass !== null ? (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                line.pass ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                              }`}>
                                {line.pass ? "Pass" : "Fail"}
                              </span>
                            ) : (
                              <span className="text-[10px] text-onyx/40">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="w-full py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
