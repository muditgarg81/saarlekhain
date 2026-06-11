"use client";

import { useState } from "react";
import { updateRejectedMaterialStatus } from "@/app/actions/rejectedMaterials";
import { limitYearTo4Digits } from "@/lib/date";
import { 
  Search, 
  X, 
  Truck, 
  Trash2, 
  Calendar, 
  FileText, 
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowLeft,
  Plus,
  Edit3
} from "lucide-react";
import Link from "next/link";

interface SerializedMaterial {
  id: string;
  companyId: string;
  grnLineId: string;
  grnNumber: string;
  itemCode: string;
  itemName: string;
  vendorName: string;
  rejectedQty: number;
  status: "PENDING_RETURN" | "RETURNED_TO_VENDOR" | "DISPOSED";
  gatepassRef: string | null;
  actionDate: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RejectedMaterialClientProps {
  initialMaterials: SerializedMaterial[];
}

export default function RejectedMaterialClient({ initialMaterials }: RejectedMaterialClientProps) {
  const [materialsList, setMaterialsList] = useState<SerializedMaterial[]>(initialMaterials);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING_RETURN" | "RETURNED_TO_VENDOR" | "DISPOSED">("ALL");

  // Modal and Form States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<SerializedMaterial | null>(null);
  const [targetStatus, setTargetStatus] = useState<"RETURNED_TO_VENDOR" | "DISPOSED">("RETURNED_TO_VENDOR");
  
  // Inputs
  const [gatepassRef, setGatepassRef] = useState("");
  const [actionDate, setActionDate] = useState("");
  const [remarks, setRemarks] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filtered List
  const filteredMaterials = materialsList.filter((m) => {
    const matchesSearch = 
      m.itemName.toLowerCase().includes(search.toLowerCase()) ||
      m.itemCode.toLowerCase().includes(search.toLowerCase()) ||
      m.grnNumber.toLowerCase().includes(search.toLowerCase()) ||
      m.vendorName.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === "ALL" ? true : m.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Calculate Metrics
  const totalCount = materialsList.length;
  const pendingCount = materialsList.filter((m) => m.status === "PENDING_RETURN").length;
  const returnedCount = materialsList.filter((m) => m.status === "RETURNED_TO_VENDOR").length;
  const disposedCount = materialsList.filter((m) => m.status === "DISPOSED").length;

  const handleOpenActionModal = (m: SerializedMaterial, status: "RETURNED_TO_VENDOR" | "DISPOSED") => {
    setSelectedMaterial(m);
    setTargetStatus(status);
    
    // Set default values
    setGatepassRef(m.gatepassRef || "");
    
    if (m.actionDate) {
      setActionDate(m.actionDate.split("T")[0]);
    } else {
      setActionDate(new Date().toISOString().split("T")[0]);
    }
    
    setRemarks(m.remarks || "");
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (m: SerializedMaterial) => {
    setSelectedMaterial(m);
    // If it's already returned or disposed, target that status, otherwise default to RETURNED_TO_VENDOR
    setTargetStatus(m.status === "DISPOSED" ? "DISPOSED" : "RETURNED_TO_VENDOR");
    setGatepassRef(m.gatepassRef || "");
    
    if (m.actionDate) {
      setActionDate(m.actionDate.split("T")[0]);
    } else {
      setActionDate(new Date().toISOString().split("T")[0]);
    }
    
    setRemarks(m.remarks || "");
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsModalOpen(true);
  };

  const handleSubmitStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload = {
      status: targetStatus,
      gatepassRef: targetStatus === "RETURNED_TO_VENDOR" ? gatepassRef.trim() : null,
      actionDate: actionDate ? new Date(actionDate).toISOString() : null,
      remarks: remarks.trim() || null,
    };

    try {
      const res = await updateRejectedMaterialStatus(selectedMaterial.id, payload);
      if (res.success && res.rejectedMaterial) {
        const updated = {
          ...res.rejectedMaterial,
          createdAt: res.rejectedMaterial.createdAt.toISOString(),
          updatedAt: res.rejectedMaterial.updatedAt.toISOString(),
          actionDate: res.rejectedMaterial.actionDate ? res.rejectedMaterial.actionDate.toISOString() : null
        } as SerializedMaterial;

        setMaterialsList((prev) =>
          prev.map((m) => (m.id === selectedMaterial.id ? updated : m))
        );
        setSuccessMsg(`Status successfully updated to ${targetStatus === "RETURNED_TO_VENDOR" ? "Returned to Vendor" : "Disposed"}`);
        setTimeout(() => {
          setIsModalOpen(false);
          setSelectedMaterial(null);
          setSuccessMsg(null);
        }, 1500);
      } else {
        setErrorMsg(res.error || "Failed to update rejected material status");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleResetToPending = async (material: SerializedMaterial) => {
    if (!confirm("Are you sure you want to revert this material back to PENDING_RETURN? All recorded Gatepass and Date logs will be cleared.")) {
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await updateRejectedMaterialStatus(material.id, {
        status: "PENDING_RETURN",
        gatepassRef: null,
        actionDate: null,
        remarks: null
      });

      if (res.success && res.rejectedMaterial) {
        const updated = {
          ...res.rejectedMaterial,
          createdAt: res.rejectedMaterial.createdAt.toISOString(),
          updatedAt: res.rejectedMaterial.updatedAt.toISOString(),
          actionDate: null
        } as SerializedMaterial;

        setMaterialsList((prev) =>
          prev.map((m) => (m.id === material.id ? updated : m))
        );
        setSuccessMsg("Status successfully reset to Pending Return");
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(res.error || "Failed to reset status");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Rejected Material Register</h2>
          <p className="text-xs text-onyx/50 mt-1">Track and manage disposal or return-to-vendor actions for incoming QC failures.</p>
        </div>
        <div>
          <Link
            href="/stores/inspection"
            className="flex items-center space-x-1 px-3 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg shadow-sm transition-all"
          >
            <ArrowLeft size={14} className="mr-1" />
            <span>Back to QC Inspection</span>
          </Link>
        </div>
      </div>

      {/* Global Message Alerts */}
      {successMsg && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-green-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <CheckCircle className="text-green-500 shrink-0 mt-0.5" size={16} />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-red-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-onyx/5 text-onyx">
            <FileText size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total Rejected Batches</div>
            <div className="text-lg font-bold text-onyx">{totalCount}</div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-amber-100 text-amber-600 border border-amber-200">
            <Clock size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Pending Action</div>
            <div className="text-lg font-bold text-onyx">{pendingCount}</div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-green-100 text-green-600 border border-green-200">
            <Truck size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Returned to Vendor</div>
            <div className="text-lg font-bold text-onyx">{returnedCount}</div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-zinc-100 text-zinc-600 border border-zinc-200">
            <Trash2 size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Disposed / Scrapped</div>
            <div className="text-lg font-bold text-onyx">{disposedCount}</div>
          </div>
        </div>
      </div>

      {/* Filter and Table Section */}
      <div className="glass-card p-6 rounded-xl border border-onyx/5 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-onyx/40 pointer-events-none">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search by Item name, Item code, GRN, Vendor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-onyx/40 hover:text-onyx cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Status filter tabs */}
          <div className="flex bg-cream-dark/30 border border-onyx/10 rounded-lg p-0.5 text-xs font-semibold">
            {(["ALL", "PENDING_RETURN", "RETURNED_TO_VENDOR", "DISPOSED"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  statusFilter === status
                    ? "bg-white text-onyx shadow-xs font-bold"
                    : "text-onyx/60 hover:text-onyx"
                }`}
              >
                {status === "ALL" ? "All" : status === "PENDING_RETURN" ? "Pending" : status === "RETURNED_TO_VENDOR" ? "Returned" : "Disposed"}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table */}
        <div className="border border-onyx/10 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-cream-dark/50 border-b border-onyx/10 text-onyx font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Item Details</th>
                  <th className="p-3">GRN & Vendor</th>
                  <th className="p-3">Rejected Qty</th>
                  <th className="p-3">Rejection Date</th>
                  <th className="p-3">Current Status</th>
                  <th className="p-3">Action Details</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredMaterials.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-onyx/40">
                      No rejected materials found matching the filters.
                    </td>
                  </tr>
                ) : (
                  filteredMaterials.map((m) => (
                    <tr key={m.id} className="hover:bg-cream-dark/10 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-onyx">{m.itemName}</div>
                        <div className="font-mono text-[10px] text-onyx/50 mt-0.5">{m.itemCode}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-onyx">GRN: {m.grnNumber}</div>
                        <div className="text-[10px] text-onyx/60 mt-0.5">{m.vendorName}</div>
                      </td>
                      <td className="p-3 font-mono font-bold text-red-600">
                        {m.rejectedQty}
                      </td>
                      <td className="p-3 text-onyx/70">
                        {new Date(m.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric"
                        })}
                      </td>
                      <td className="p-3">
                        {m.status === "PENDING_RETURN" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            Pending Return
                          </span>
                        )}
                        {m.status === "RETURNED_TO_VENDOR" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                            Returned to Vendor
                          </span>
                        )}
                        {m.status === "DISPOSED" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 text-zinc-800 border border-zinc-200">
                            Disposed / Scrapped
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {m.status === "PENDING_RETURN" ? (
                          <span className="text-onyx/30">N/A</span>
                        ) : (
                          <div className="space-y-0.5">
                            {m.gatepassRef && (
                              <div className="text-[10px] font-bold text-onyx/80">
                                GP Ref: {m.gatepassRef}
                              </div>
                            )}
                            {m.actionDate && (
                              <div className="text-[10px] text-onyx/60 flex items-center gap-1">
                                <Calendar size={10} />
                                <span>
                                  {new Date(m.actionDate).toLocaleDateString("en-IN", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric"
                                  })}
                                </span>
                              </div>
                            )}
                            {m.remarks && (
                              <div className="text-[10px] italic text-onyx/50 truncate max-w-[150px]" title={m.remarks}>
                                "{m.remarks}"
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {m.status === "PENDING_RETURN" ? (
                            <>
                              <button
                                onClick={() => handleOpenActionModal(m, "RETURNED_TO_VENDOR")}
                                className="px-2.5 py-1 bg-white border border-onyx/10 hover:border-onyx/20 rounded-md text-[10px] font-bold text-onyx shadow-2xs hover:bg-cream-dark cursor-pointer flex items-center gap-1 transition-all"
                              >
                                <Truck size={12} className="text-green-600" />
                                <span>Return</span>
                              </button>
                              <button
                                onClick={() => handleOpenActionModal(m, "DISPOSED")}
                                className="px-2.5 py-1 bg-white border border-onyx/10 hover:border-onyx/20 rounded-md text-[10px] font-bold text-onyx shadow-2xs hover:bg-cream-dark cursor-pointer flex items-center gap-1 transition-all"
                              >
                                <Trash2 size={12} className="text-red-600" />
                                <span>Scrap</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleOpenEditModal(m)}
                                className="p-1.5 text-onyx/50 hover:text-saffron-dark hover:bg-cream-dark rounded-md transition-colors cursor-pointer"
                                title="Edit Log details"
                              >
                                <Edit3 size={14} />
                              </button>
                              <button
                                onClick={() => handleResetToPending(m)}
                                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-bold rounded-md transition-colors cursor-pointer"
                                title="Revert to Pending"
                              >
                                Reset
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Action / Edit Modal */}
      {isModalOpen && selectedMaterial && (
        <div className="fixed inset-0 bg-onyx/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-cream max-w-md w-full flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-4 bg-onyx text-cream flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-saffron">
                  {selectedMaterial.status !== "PENDING_RETURN" ? "Edit Disposition Log" : `Record ${targetStatus === "RETURNED_TO_VENDOR" ? "Vendor Return" : "Material Scrapping"}`}
                </h3>
                <p className="text-[10px] text-cream-light/70 font-mono mt-0.5">
                  Item: {selectedMaterial.itemName} ({selectedMaterial.itemCode})
                </p>
              </div>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedMaterial(null);
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-cream-light hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitStatusUpdate} className="p-5 space-y-4">
              {/* If editing, let them switch the disposition type if they want */}
              {selectedMaterial.status !== "PENDING_RETURN" && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Disposition Status
                  </label>
                  <select
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value as any)}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    disabled={loading}
                  >
                    <option value="RETURNED_TO_VENDOR">Returned to Vendor</option>
                    <option value="DISPOSED">Disposed / Scrapped</option>
                  </select>
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-cream-dark/30 border border-onyx/5 rounded-lg text-xs">
                <div>
                  <div className="text-[10px] text-onyx/40 font-bold uppercase">Rejected Qty</div>
                  <div className="font-bold font-mono text-red-600">{selectedMaterial.rejectedQty} units</div>
                </div>
                <div>
                  <div className="text-[10px] text-onyx/40 font-bold uppercase">GRN Number</div>
                  <div className="font-bold">{selectedMaterial.grnNumber}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] text-onyx/40 font-bold uppercase">Supplier / Vendor</div>
                  <div className="font-semibold text-onyx/85">{selectedMaterial.vendorName}</div>
                </div>
              </div>

              {/* Gatepass Reference (Returned to Vendor only) */}
              {targetStatus === "RETURNED_TO_VENDOR" && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Gatepass / Challan Reference *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. GP/2026/0491 or Return Challan Ref"
                    value={gatepassRef}
                    onChange={(e) => setGatepassRef(e.target.value)}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold"
                    disabled={loading}
                  />
                </div>
              )}

              {/* Action Date */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Action Date *
                </label>
                <input
                  type="date"
                  required
                  value={actionDate}
                  onChange={(e) => setActionDate(limitYearTo4Digits(e.target.value))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold"
                  disabled={loading}
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Remarks / Comments
                </label>
                <textarea
                  placeholder="Enter return details, scraping witness, or vendor acknowledgment comments..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron resize-none"
                  disabled={loading}
                />
              </div>

              {/* Modal Actions */}
              <div className="flex space-x-2 pt-2 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setSelectedMaterial(null);
                  }}
                  className="flex-1 py-2.5 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-saffron hover:bg-saffron-dark text-xs font-bold text-onyx rounded-lg shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? "Saving..." : "Save Log"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
