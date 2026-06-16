"use client";

import { useState } from "react";
import { 
  runReplenishmentScan, 
  reviewSuggestion, 
  rejectSuggestion, 
  approveAndConvertSuggestions,
  updateReorderPolicy
} from "@/app/actions/reorders";
import { 
  Play, 
  Check, 
  X, 
  Edit2, 
  Trash2, 
  Settings, 
  AlertTriangle, 
  Info, 
  CheckCircle,
  TrendingDown,
  RefreshCw,
  Sliders,
  DollarSign
} from "lucide-react";

interface Suggestion {
  id: string;
  itemId: string;
  storeId: string;
  itemName: string;
  itemCode: string;
  storeName: string;
  onHand: number;
  onOrder: number;
  inPipeline: number;
  netAvailable: number;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  suggestedQty: number;
  approvedQty: number | null;
  reason: string;
  priority: string;
  preferredVendorId: string | null;
  preferredVendorName?: string | null;
  lastPurchasePrice: number | null;
  leadTimeDays: number;
  estValue: number | null;
  status: string;
  abcClass?: string;
}

interface ReorderPolicy {
  id: string;
  enabled: boolean;
  scanCron: string;
  method: string;
  lotRounding: number;
  autoApproveBelowValue: number | null;
  secondApprovalAboveValue: number | null;
  criticalClasses: string[];
}

interface ReorderBasketListProps {
  suggestions: Suggestion[];
  policy: ReorderPolicy;
  vendors: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}

export default function ReorderBasketList({ 
  suggestions: initialSuggestions, 
  policy: initialPolicy, 
  vendors, 
  stores 
}: ReorderBasketListProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>(initialSuggestions);
  const [policy, setPolicy] = useState<ReorderPolicy>(initialPolicy);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [clubIntoSingleIndent, setClubIntoSingleIndent] = useState(false);
  
  // Loading & Error States
  const [scanLoading, setScanLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit Suggestion State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    approvedQty: 0,
    priority: "NORMAL",
    preferredVendorId: "" as string | null
  });

  // Rejection Dialog State
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Policy Dialog State
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    enabled: policy.enabled,
    scanCron: policy.scanCron,
    method: policy.method,
    lotRounding: policy.lotRounding,
    autoApproveBelowValue: policy.autoApproveBelowValue || "",
    secondApprovalAboveValue: policy.secondApprovalAboveValue || "",
    criticalClasses: policy.criticalClasses
  });

  // Filters logic
  const filtered = suggestions.filter(s => {
    const matchesSearch = s.itemName.toLowerCase().includes(search.toLowerCase()) || 
                          s.itemCode.toLowerCase().includes(search.toLowerCase());
    const matchesStore = storeFilter === "all" || s.storeId === storeFilter;
    const matchesPriority = priorityFilter === "all" || s.priority === priorityFilter;
    return matchesSearch && matchesStore && matchesPriority;
  });

  // RunScan
  const handleTriggerScan = async () => {
    setScanLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await runReplenishmentScan(storeFilter === "all" ? null : storeFilter);
      if (res.success) {
        setSuccessMsg(`Replenishment scan completed. Scanned items. ${res.suggestedCount} suggestion(s) added/updated in review basket.`);
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Failed to trigger scan");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error during scan");
    } finally {
      setScanLoading(false);
    }
  };

  // Select item toggle
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(f => f.id));
    }
  };

  // Edit suggestion
  const startEdit = (s: Suggestion) => {
    setEditingId(s.id);
    setEditForm({
      approvedQty: s.approvedQty ?? s.suggestedQty,
      priority: s.priority,
      preferredVendorId: s.preferredVendorId
    });
  };

  const saveEdit = async (id: string) => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await reviewSuggestion(id, {
        approvedQty: editForm.approvedQty,
        priority: editForm.priority,
        preferredVendorId: editForm.preferredVendorId || null
      });

      if (res.success && res.suggestion) {
        setSuggestions(prev => prev.map(s => s.id === id ? { ...s, ...res.suggestion } : s));
        setEditingId(null);
        setSuccessMsg("Suggestion updated successfully.");
      } else {
        setErrorMsg(res.error || "Failed to update suggestion");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Reject suggestion
  const submitReject = async () => {
    if (!rejectId || !rejectReason.trim()) return;
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await rejectSuggestion(rejectId, rejectReason);
      if (res.success) {
        setSuggestions(prev => prev.filter(s => s.id !== rejectId));
        setRejectId(null);
        setRejectReason("");
        setSuccessMsg("Suggestion rejected.");
      } else {
        setErrorMsg(res.error || "Failed to reject suggestion");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Approve & convert
  const handleApproveAndConvert = async () => {
    if (selectedIds.length === 0) return;
    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await approveAndConvertSuggestions(selectedIds, clubIntoSingleIndent);
      if (res.success) {
        setSuccessMsg("Approved suggestions successfully converted to Indents.");
        setSelectedIds([]);
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Failed to convert suggestions");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Save policy
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await updateReorderPolicy({
        enabled: policyForm.enabled,
        scanCron: policyForm.scanCron,
        method: policyForm.method as any,
        lotRounding: parseFloat(String(policyForm.lotRounding)) || 1,
        autoApproveBelowValue: policyForm.autoApproveBelowValue ? parseFloat(String(policyForm.autoApproveBelowValue)) : null,
        secondApprovalAboveValue: policyForm.secondApprovalAboveValue ? parseFloat(String(policyForm.secondApprovalAboveValue)) : null,
        criticalClasses: policyForm.criticalClasses
      });

      if (res.success && res.policy) {
        setPolicy(res.policy as any);
        setIsPolicyOpen(false);
        setSuccessMsg("Reorder policy updated successfully.");
      } else {
        setErrorMsg(res.error || "Failed to save policy");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Replenishment Reorder Basket</h2>
          <p className="text-xs text-onyx/50 mt-1">Review items currently under reorder point, adjust suggested quantities, and approve indents.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsPolicyOpen(true)}
            className="flex items-center space-x-2 px-3 py-2 border border-onyx/10 rounded-lg text-xs font-bold text-onyx bg-white hover:bg-cream-dark transition shadow-sm cursor-pointer"
          >
            <Settings size={14} />
            <span>Configure Policy</span>
          </button>
          <button
            onClick={handleTriggerScan}
            disabled={scanLoading || !policy.enabled}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition disabled:opacity-50 cursor-pointer"
          >
            <Play size={14} />
            <span>{scanLoading ? "Scanning stock..." : "Trigger Reorder Scan"}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-lg flex items-center justify-between text-xs text-green-800 font-semibold transition-all">
          <div className="flex items-center space-x-2">
            <CheckCircle className="text-green-500 shrink-0" size={16} />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-green-600 hover:text-green-800 font-bold ml-4">
            <X size={14} />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg flex items-center justify-between text-xs text-red-800 font-semibold transition-all">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="text-red-500 shrink-0" size={16} />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-600 hover:text-red-800 font-bold ml-4">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters and Actions Bar */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <input
            type="text"
            placeholder="Search by item code or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-4 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        {/* Store filter */}
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none w-full md:w-48"
        >
          <option value="all">All Stores</option>
          {stores.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Priority filter */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none w-full md:w-48"
        >
          <option value="all">All Priorities</option>
          <option value="URGENT">Urgent (Below Min)</option>
          <option value="NORMAL">Normal (Below Reorder)</option>
        </select>

        {/* Bulk approve button */}
        {selectedIds.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <label className="flex items-center space-x-2 text-xs font-bold text-onyx bg-white/50 border border-onyx/10 px-3 py-2 rounded-lg cursor-pointer hover:bg-cream-dark transition shadow-sm w-full sm:w-auto justify-center select-none">
              <input
                type="checkbox"
                checked={clubIntoSingleIndent}
                onChange={(e) => setClubIntoSingleIndent(e.target.checked)}
                className="rounded text-saffron focus:ring-saffron w-4 h-4 cursor-pointer"
              />
              <span>Club into single Indent</span>
            </label>
            <button
              onClick={handleApproveAndConvert}
              disabled={actionLoading}
              className="w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Check size={14} />
              <span>Approve & Convert ({selectedIds.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Suggestions Table */}
      <div className="hidden md:block glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.length === filtered.length}
                    onChange={toggleSelectAll}
                    className="rounded text-saffron focus:ring-saffron"
                  />
                </th>
                <th>Item Code / Name</th>
                <th>Store</th>
                <th className="text-right">Stock On-Hand</th>
                <th className="text-right">On Order</th>
                <th className="text-right">Pipeline</th>
                <th className="text-right">Net Available</th>
                <th className="text-right border-l border-onyx/5">Reorder Level</th>
                <th className="text-right">Suggested Qty</th>
                <th className="text-right bg-cream-dark/10">Approved Qty</th>
                <th>Priority</th>
                <th>Vendor / Price</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-12 text-onyx/40 font-medium">
                    <TrendingDown className="mx-auto text-onyx/20 mb-2" size={32} />
                    No reorder suggestions pending review.
                  </td>
                </tr>
              ) : (
                filtered.map((s) => {
                  const isEditing = editingId === s.id;
                  const isUrgent = s.priority === "URGENT";
                  const value = (s.approvedQty ?? s.suggestedQty) * (s.lastPurchasePrice || 0);

                  return (
                    <tr key={s.id} className={isUrgent ? "bg-red-50/20" : ""}>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="rounded text-saffron focus:ring-saffron"
                        />
                      </td>
                      <td>
                        <div className="flex items-center space-x-1.5">
                          <span className="font-mono font-bold text-xs text-onyx/85">[{s.itemCode}]</span>
                          <span className="font-semibold text-onyx">{s.itemName}</span>
                          {s.abcClass && (
                            <span className={`px-1 rounded text-[8px] font-extrabold ${
                              s.abcClass === "A" ? "bg-red-100 text-red-800" :
                              s.abcClass === "B" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-800"
                            }`}>
                              Class {s.abcClass}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-onyx/70">{s.storeName}</td>
                      <td className="text-right font-mono text-xs">{s.onHand}</td>
                      <td className="text-right font-mono text-xs text-blue-600 font-medium">+{s.onOrder}</td>
                      <td className="text-right font-mono text-xs text-amber-600 font-medium">+{s.inPipeline}</td>
                      <td className="text-right font-mono font-bold text-xs">{s.netAvailable}</td>
                      <td className="text-right font-mono text-xs border-l border-onyx/5 text-onyx/60">{s.reorderLevel}</td>
                      <td className="text-right font-mono font-bold text-xs text-onyx/80">{s.suggestedQty}</td>
                      
                      {/* Approved Qty Column */}
                      <td className="text-right font-mono font-bold bg-cream-dark/10">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.approvedQty}
                            onChange={(e) => setEditForm(prev => ({ ...prev, approvedQty: parseFloat(e.target.value) || 0 }))}
                            className="w-16 p-1 text-xs border border-onyx/20 rounded font-mono font-bold text-right"
                          />
                        ) : (
                          <span className="text-green-700">{s.approvedQty ?? s.suggestedQty}</span>
                        )}
                      </td>

                      {/* Priority Column */}
                      <td>
                        {isEditing ? (
                          <select
                            value={editForm.priority}
                            onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value }))}
                            className="text-[10px] p-1 border border-onyx/20 rounded"
                          >
                            <option value="NORMAL">Normal</option>
                            <option value="URGENT">Urgent</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-1.5 py-0.25 rounded text-[9px] font-bold ${
                            isUrgent ? "bg-red-100 text-red-800" : "bg-zinc-150 text-zinc-700"
                          }`}>
                            {s.priority}
                          </span>
                        )}
                      </td>

                      {/* Vendor/Price Column */}
                      <td>
                        {isEditing ? (
                          <select
                            value={editForm.preferredVendorId || ""}
                            onChange={(e) => setEditForm(prev => ({ ...prev, preferredVendorId: e.target.value || null }))}
                            className="text-[10px] p-1 border border-onyx/20 rounded w-28"
                          >
                            <option value="">No vendor</option>
                            {vendors.map(v => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </select>
                        ) : (
                          <div>
                            <p className="text-[10px] font-semibold text-onyx/80">{s.preferredVendorName || "No preferred vendor"}</p>
                            {s.lastPurchasePrice && (
                              <p className="text-[9px] text-onyx/40 font-mono">Last Price: ₹{s.lastPurchasePrice.toFixed(2)} | Val: ₹{value.toFixed(2)}</p>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actions Column */}
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(s.id)}
                                disabled={actionLoading}
                                className="p-1 hover:bg-green-50 text-green-600 rounded cursor-pointer border border-transparent hover:border-green-200"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1 hover:bg-red-50 text-red-600 rounded cursor-pointer border border-transparent hover:border-red-200"
                              >
                                <X size={12} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(s)}
                                title="Edit Suggestion"
                                className="p-1 hover:bg-cream-dark text-onyx/65 hover:text-onyx rounded cursor-pointer border border-transparent hover:border-onyx/10"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => setRejectId(s.id)}
                                title="Reject Suggestion"
                                className="p-1 hover:bg-red-50 text-red-500 hover:text-red-700 rounded cursor-pointer border border-transparent hover:border-red-100"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
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

      {/* Mobile Card List View */}
      <div className="md:hidden space-y-4">
        {filtered.length === 0 ? (
          <div className="glass-card p-6 text-center text-onyx/40 font-medium border border-onyx/5 rounded-xl">
            <TrendingDown className="mx-auto text-onyx/20 mb-2" size={32} />
            No reorder suggestions pending review.
          </div>
        ) : (
          filtered.map((s) => {
            const isEditing = editingId === s.id;
            const isUrgent = s.priority === "URGENT";
            const isSelected = selectedIds.includes(s.id);
            const value = (s.approvedQty ?? s.suggestedQty) * (s.lastPurchasePrice || 0);

            return (
              <div
                key={s.id}
                className={`glass-card p-4 rounded-xl border transition-all duration-150 ${
                  isUrgent ? "bg-red-50/20" : "bg-cream"
                } ${
                  isSelected ? "border-saffron bg-saffron/5" : "border-onyx/5"
                }`}
              >
                {/* Header: Checkbox, Code, ABC Class, Status/Priority */}
                <div className="flex items-center justify-between border-b border-onyx/5 pb-2 mb-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(s.id)}
                      className="rounded text-saffron focus:ring-saffron w-4 h-4 cursor-pointer"
                    />
                    <span className="font-mono font-bold text-xs text-onyx/85">[{s.itemCode}]</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {s.abcClass && (
                      <span className={`px-1 rounded text-[8px] font-extrabold ${
                        s.abcClass === "A" ? "bg-red-100 text-red-800" :
                        s.abcClass === "B" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-800"
                      }`}>
                        Class {s.abcClass}
                      </span>
                    )}
                    {isEditing ? (
                      <select
                        value={editForm.priority}
                        onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value }))}
                        className="text-[10px] p-1 border border-onyx/20 rounded bg-white"
                      >
                        <option value="NORMAL">Normal</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                    ) : (
                      <span className={`inline-flex items-center px-1.5 py-0.25 rounded text-[9px] font-bold ${
                        isUrgent ? "bg-red-100 text-red-800" : "bg-zinc-150 text-zinc-700"
                      }`}>
                        {s.priority}
                      </span>
                    )}
                  </div>
                </div>

                {/* Body Content */}
                <div className="space-y-2.5 text-xs text-onyx/70">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Item Name</span>
                    <span className="font-semibold text-onyx">{s.itemName}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Store</span>
                      <span className="font-semibold text-onyx">{s.storeName}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Reorder Level</span>
                      <span className="font-mono font-semibold text-onyx">{s.reorderLevel}</span>
                    </div>
                  </div>

                  {/* Stock metrics grid */}
                  <div className="grid grid-cols-4 gap-1 bg-cream-dark/25 p-2 rounded-lg text-center font-mono">
                    <div>
                      <span className="text-[8px] uppercase font-bold text-onyx/40 tracking-wider block">On-Hand</span>
                      <span className="text-[11px] font-bold text-onyx">{s.onHand}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase font-bold text-onyx/40 tracking-wider block">On Order</span>
                      <span className="text-[11px] font-bold text-blue-600">+{s.onOrder}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase font-bold text-onyx/40 tracking-wider block">Pipeline</span>
                      <span className="text-[11px] font-bold text-amber-600">+{s.inPipeline}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase font-bold text-onyx/40 tracking-wider block">Net Avail</span>
                      <span className="text-[11px] font-extrabold text-onyx">{s.netAvailable}</span>
                    </div>
                  </div>

                  {/* Qty & Vendor Edit Section */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Suggested / Approved Qty</span>
                      {isEditing ? (
                        <div className="flex items-center space-x-1.5 mt-1">
                          <span className="text-[10px] font-mono text-onyx/50">{s.suggestedQty} /</span>
                          <input
                            type="number"
                            value={editForm.approvedQty}
                            onChange={(e) => setEditForm(prev => ({ ...prev, approvedQty: parseFloat(e.target.value) || 0 }))}
                            className="w-20 p-1 text-xs border border-onyx/20 rounded font-mono font-bold text-right bg-white"
                          />
                        </div>
                      ) : (
                        <div className="font-semibold text-onyx mt-0.5">
                          <span className="font-mono text-onyx/50">{s.suggestedQty}</span>
                          <span className="text-onyx/50 mx-1">→</span>
                          <span className="font-mono font-bold text-green-700">{s.approvedQty ?? s.suggestedQty}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Preferred Vendor</span>
                      {isEditing ? (
                        <select
                          value={editForm.preferredVendorId || ""}
                          onChange={(e) => setEditForm(prev => ({ ...prev, preferredVendorId: e.target.value || null }))}
                          className="text-[10px] p-1 border border-onyx/20 rounded w-full bg-white mt-1"
                        >
                          <option value="">No vendor</option>
                          {vendors.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="mt-0.5">
                          <span className="font-semibold text-onyx">{s.preferredVendorName || "No preferred vendor"}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pricing and total value */}
                  {!isEditing && s.lastPurchasePrice && (
                    <div className="bg-cream-dark/15 px-2 py-1 rounded text-[10px] font-mono flex justify-between items-center text-onyx/60">
                      <span>Last Price: ₹{s.lastPurchasePrice.toFixed(2)}</span>
                      <span className="font-bold">Total Val: ₹{value.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Actions footer */}
                <div className="flex items-center justify-end space-x-2 pt-2 mt-3 border-t border-onyx/5">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveEdit(s.id)}
                        disabled={actionLoading}
                        className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-bold shadow-sm cursor-pointer flex items-center space-x-1"
                      >
                        <Check size={12} />
                        <span>Save</span>
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1.5 border border-onyx/10 rounded text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer flex items-center space-x-1"
                      >
                        <X size={12} />
                        <span>Cancel</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(s)}
                        title="Edit Suggestion"
                        className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => setRejectId(s.id)}
                        title="Reject Suggestion"
                        className="p-1.5 hover:bg-red-50 border border-transparent hover:border-red-100 rounded text-red-500 hover:text-red-700 cursor-pointer inline-flex"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reject Suggestion Dialog */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-md w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Reject Reorder Suggestion</h3>
              <button onClick={() => setRejectId(null)} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start space-x-2 text-xs bg-amber-50 text-amber-800 p-2.5 rounded border border-amber-150">
                <Info size={14} className="shrink-0 mt-0.5 text-amber-600" />
                <span>Provide a rejection reason for auditing. This suggestion will be removed from the active review basket.</span>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Reason for Rejection *</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Items are being sourced from alternative project transfers"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[80px]"
                  required
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  onClick={() => setRejectId(null)}
                  className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={submitReject}
                  disabled={actionLoading || !rejectReason.trim()}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Configure Policy Modal */}
      {isPolicyOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-lg w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sliders size={18} className="text-saffron" />
                <h3 className="font-heading text-base font-bold">Replenishment Reorder Policy</h3>
              </div>
              <button onClick={() => setIsPolicyOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSavePolicy} className="p-6 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-onyx/5 pb-3">
                <div>
                  <p className="font-bold text-onyx text-xs">Enable Auto-Replenishment Scan</p>
                  <p className="text-[10px] text-onyx/40">When active, hourly background scans evaluate inventory points.</p>
                </div>
                <input
                  type="checkbox"
                  checked={policyForm.enabled}
                  onChange={(e) => setPolicyForm(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="rounded text-saffron focus:ring-saffron w-4 h-4 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Scan Schedule (Cron)</label>
                  <input
                    type="text"
                    value={policyForm.scanCron}
                    onChange={(e) => setPolicyForm(prev => ({ ...prev, scanCron: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Replenishment Method</label>
                  <select
                    value={policyForm.method}
                    onChange={(e) => setPolicyForm(prev => ({ ...prev, method: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="REORDER_TO_MAX">Reorder to Max Stock</option>
                    <option value="FIXED_QTY">Fixed Order Lot</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Lot Size Rounding (Multiple)</label>
                  <input
                    type="number"
                    step="any"
                    value={policyForm.lotRounding}
                    onChange={(e) => setPolicyForm(prev => ({ ...prev, lotRounding: parseFloat(e.target.value) || 1 }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Auto-Approve Value Cap (₹)</label>
                  <input
                    type="number"
                    value={policyForm.autoApproveBelowValue}
                    onChange={(e) => setPolicyForm(prev => ({ ...prev, autoApproveBelowValue: e.target.value ? parseFloat(e.target.value) : "" }))}
                    placeholder="e.g. 10000 (empty = require review)"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">Critical ABC Classes (Always review)</label>
                <div className="flex items-center space-x-4">
                  {["A", "B", "C"].map((cls) => {
                    const isChecked = policyForm.criticalClasses.includes(cls);
                    return (
                      <label key={cls} className="flex items-center space-x-1.5 font-bold text-onyx/80 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const current = [...policyForm.criticalClasses];
                            const next = e.target.checked 
                              ? [...current, cls]
                              : current.filter(c => c !== cls);
                            setPolicyForm(prev => ({ ...prev, criticalClasses: next }));
                          }}
                          className="rounded text-saffron focus:ring-saffron"
                        />
                        <span>Class {cls}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsPolicyOpen(false)}
                  className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-3.5 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
