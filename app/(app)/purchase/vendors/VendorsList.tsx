"use client";

import { useState } from "react";
import { 
  createVendor, 
  updateVendor, 
  updateVendorStatus, 
  deleteVendor 
} from "@/app/actions/vendors";
import { 
  Search, 
  Plus, 
  X, 
  Trash2, 
  Edit3, 
  Check, 
  ShieldAlert, 
  ShieldCheck, 
  Eye, 
  Building2, 
  AlertCircle,
  Lock,
  Unlock,
  DollarSign
} from "lucide-react";
import { VendorStatus } from "@prisma/client";

interface BankDetails {
  bankName?: string;
  accountNo?: string;
  ifsc?: string;
  branch?: string;
}

interface Vendor {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  udyamNo: string | null;
  category: string | null;
  paymentTerms: string | null;
  creditDays: number;
  tdsApplicable: boolean;
  bankDetails: BankDetails | null;
  status: VendorStatus;
}

interface VendorsListProps {
  initialVendors: Vendor[];
  userRole: string;
}

export default function VendorsList({ initialVendors, userRole }: VendorsListProps) {
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Dialog & Form States
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Form Field States
  const [formFields, setFormFields] = useState({
    name: "",
    code: "",
    gstin: "",
    pan: "",
    udyamNo: "",
    category: "RM",
    paymentTerms: "",
    creditDays: 0,
    tdsApplicable: false,
    bankName: "",
    accountNo: "",
    ifsc: "",
    branch: "",
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSeeBankDetails = ["ACCOUNTS", "ADMIN", "OWNER"].includes(userRole);
  const canApprove = ["PURCHASE_MANAGER", "ADMIN", "OWNER"].includes(userRole);

  const filteredVendors = vendors.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(search.toLowerCase()) || 
                          v.code.toLowerCase().includes(search.toLowerCase()) ||
                          (v.gstin?.toLowerCase() || "").includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || v.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenCreate = () => {
    setErrorMsg(null);
    setIsEditing(false);
    setFormFields({
      name: "",
      code: "",
      gstin: "",
      pan: "",
      udyamNo: "",
      category: "RM",
      paymentTerms: "Net 30",
      creditDays: 30,
      tdsApplicable: false,
      bankName: "",
      accountNo: "",
      ifsc: "",
      branch: "",
    });
    setIsOpen(true);
  };

  const handleOpenEdit = (v: Vendor) => {
    setErrorMsg(null);
    setIsEditing(true);
    setSelectedVendor(v);
    setFormFields({
      name: v.name,
      code: v.code,
      gstin: v.gstin || "",
      pan: v.pan || "",
      udyamNo: v.udyamNo || "",
      category: v.category || "RM",
      paymentTerms: v.paymentTerms || "",
      creditDays: v.creditDays,
      tdsApplicable: v.tdsApplicable,
      bankName: v.bankDetails?.bankName || "",
      accountNo: v.bankDetails?.accountNo || "",
      ifsc: v.bankDetails?.ifsc || "",
      branch: v.bankDetails?.branch || "",
    });
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);

    const payload = {
      name: formFields.name,
      code: formFields.code || undefined,
      gstin: formFields.gstin || null,
      pan: formFields.pan || null,
      udyamNo: formFields.udyamNo || null,
      category: formFields.category || null,
      paymentTerms: formFields.paymentTerms || null,
      creditDays: formFields.creditDays,
      tdsApplicable: formFields.tdsApplicable,
      bankDetails: {
        bankName: formFields.bankName || undefined,
        accountNo: formFields.accountNo || undefined,
        ifsc: formFields.ifsc || undefined,
        branch: formFields.branch || undefined,
      }
    };

    let res;
    if (isEditing && selectedVendor) {
      res = await updateVendor(selectedVendor.id, { ...payload, code: formFields.code });
    } else {
      res = await createVendor(payload);
    }

    setActionLoading(false);

    if (res.success) {
      setIsOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Something went wrong");
    }
  };

  const handleStatusChange = async (id: string, nextStatus: VendorStatus) => {
    if (!confirm(`Are you sure you want to change status to ${nextStatus}?`)) return;
    setActionLoading(true);
    const res = await updateVendorStatus(id, nextStatus);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert("Error updating status: " + res.error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this vendor? This cannot be undone.")) return;
    setActionLoading(true);
    const res = await deleteVendor(id);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert("Error deleting vendor: " + res.error);
    }
  };

  const maskBankNo = (no?: string) => {
    if (!no) return "N/A";
    if (canSeeBankDetails) return no;
    return `•••• •••• •••• ${no.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Supplier & Vendor Master</h2>
          <p className="text-xs text-onyx/50 mt-1">Manage vendor credentials, payment schedules, and role-secured banking detail records.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleOpenCreate}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Onboard Supplier</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Search by vendor name, code, GSTIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
        >
          <option value="all">All Statuses</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="HOLD">On Hold</option>
          <option value="BLACKLISTED">Blacklisted</option>
        </select>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th>Vendor Code</th>
                <th>Vendor Name</th>
                <th>Category</th>
                <th>GSTIN</th>
                <th>Credit (Days)</th>
                <th>Bank Account</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-onyx/40 font-medium">
                    No vendors registered.
                  </td>
                </tr>
              ) : (
                filteredVendors.map((v) => {
                  return (
                    <tr key={v.id}>
                      <td className="font-mono font-bold text-xs text-onyx/85">{v.code}</td>
                      <td className="font-semibold text-onyx">{v.name}</td>
                      <td>
                        <span className="text-[10px] font-bold uppercase text-onyx/60 bg-cream-dark/40 px-2 py-0.5 rounded">
                          {v.category || "General"}
                        </span>
                      </td>
                      <td className="font-mono text-xs">{v.gstin || "-"}</td>
                      <td className="font-mono font-semibold">{v.creditDays} days</td>
                      <td>
                        <div className="flex items-center space-x-1">
                          {canSeeBankDetails ? (
                            <Unlock size={12} className="text-green-600 shrink-0" />
                          ) : (
                            <Lock size={12} className="text-onyx/30 shrink-0" />
                          )}
                          <span className="font-mono text-xs">
                            {maskBankNo(v.bankDetails?.accountNo)}
                          </span>
                        </div>
                      </td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          v.status === "APPROVED" ? "bg-green-100 text-green-800" :
                          v.status === "PENDING_APPROVAL" ? "bg-yellow-100 text-yellow-800" :
                          v.status === "HOLD" ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800"
                        }`}>
                          {v.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedVendor(v);
                              setIsDetailOpen(true);
                            }}
                            title="View Info"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(v)}
                            title="Edit Vendor"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                          >
                            <Edit3 size={13} />
                          </button>

                          {canApprove && v.status === "PENDING_APPROVAL" && (
                            <button
                              onClick={() => handleStatusChange(v.id, "APPROVED")}
                              title="Approve Vendor"
                              className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer"
                            >
                              <Check size={13} />
                            </button>
                          )}

                          {canApprove && v.status === "APPROVED" && (
                            <button
                              onClick={() => handleStatusChange(v.id, "HOLD")}
                              title="Put on Hold"
                              className="p-1 hover:bg-orange-50 text-orange-600 hover:text-orange-700 rounded border border-transparent hover:border-orange-200 cursor-pointer"
                            >
                              <ShieldAlert size={13} />
                            </button>
                          )}

                          {canApprove && v.status === "HOLD" && (
                            <button
                              onClick={() => handleStatusChange(v.id, "APPROVED")}
                              title="Release Hold"
                              className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer"
                            >
                              <ShieldCheck size={13} />
                            </button>
                          )}

                          {canApprove && (
                            <button
                              onClick={() => handleDelete(v.id)}
                              title="Delete Vendor"
                              className="p-1 hover:bg-red-50 text-red-600 hover:text-red-700 rounded border border-transparent hover:border-red-200 cursor-pointer"
                            >
                              <Trash2 size={13} />
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

      {/* Add / Edit Vendor Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">
                {isEditing ? `Edit Vendor (${formFields.code})` : "Onboard New Vendor"}
              </h3>
              <button onClick={() => setIsOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Vendor Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Vendor Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formFields.name}
                    onChange={(e) => setFormFields(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Acme Industrial Corp"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Vendor Code (Optional)
                  </label>
                  <input
                    type="text"
                    disabled={isEditing}
                    value={formFields.code}
                    onChange={(e) => setFormFields(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                    placeholder="Auto-generated if left blank"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              {/* GSTIN, PAN, Udyam */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    GSTIN
                  </label>
                  <input
                    type="text"
                    value={formFields.gstin}
                    onChange={(e) => setFormFields(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))}
                    placeholder="e.g. 07AAAAA1111A1Z1"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    PAN
                  </label>
                  <input
                    type="text"
                    value={formFields.pan}
                    onChange={(e) => setFormFields(prev => ({ ...prev, pan: e.target.value.toUpperCase() }))}
                    placeholder="e.g. AAAAA1111A"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Udyam MSME No
                  </label>
                  <input
                    type="text"
                    value={formFields.udyamNo}
                    onChange={(e) => setFormFields(prev => ({ ...prev, udyamNo: e.target.value }))}
                    placeholder="e.g. UDYAM-DL-00-1234567"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              {/* Category, payment terms, credit days */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Category *
                  </label>
                  <select
                    value={formFields.category}
                    onChange={(e) => setFormFields(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="RM">Raw Material (RM)</option>
                    <option value="CONSUMABLE">Consumable</option>
                    <option value="SERVICE">Service Provider</option>
                    <option value="CAPITAL">Capital Goods</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Payment Terms
                  </label>
                  <input
                    type="text"
                    value={formFields.paymentTerms}
                    onChange={(e) => setFormFields(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    placeholder="e.g. Net 30, 50% Advance"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Credit Days
                  </label>
                  <input
                    type="number"
                    value={formFields.creditDays}
                    onChange={(e) => setFormFields(prev => ({ ...prev, creditDays: parseInt(e.target.value) || 0 }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* TDS Checkbox */}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="tdsApplicable"
                  checked={formFields.tdsApplicable}
                  onChange={(e) => setFormFields(prev => ({ ...prev, tdsApplicable: e.target.checked }))}
                  className="rounded border-onyx/15 text-saffron focus:ring-saffron"
                />
                <label htmlFor="tdsApplicable" className="text-xs font-bold uppercase tracking-wider text-onyx/75">
                  TDS (Withholding Tax) Applicable
                </label>
              </div>

              {/* Bank Details Panel */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-4">
                <div className="flex items-center justify-between border-b border-onyx/5 pb-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">
                    Bank Account Details (Role Protected)
                  </h4>
                  <Lock size={12} className="text-onyx/40" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Bank Name</label>
                    <input
                      type="text"
                      value={formFields.bankName}
                      onChange={(e) => setFormFields(prev => ({ ...prev, bankName: e.target.value }))}
                      placeholder="e.g. State Bank of India"
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Account Number</label>
                    <input
                      type="text"
                      value={formFields.accountNo}
                      onChange={(e) => setFormFields(prev => ({ ...prev, accountNo: e.target.value }))}
                      placeholder="e.g. 123456789012"
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">IFSC Code</label>
                    <input
                      type="text"
                      value={formFields.ifsc}
                      onChange={(e) => setFormFields(prev => ({ ...prev, ifsc: e.target.value.toUpperCase() }))}
                      placeholder="e.g. SBIN0001234"
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Branch</label>
                    <input
                      type="text"
                      value={formFields.branch}
                      onChange={(e) => setFormFields(prev => ({ ...prev, branch: e.target.value }))}
                      placeholder="e.g. Connaught Place, New Delhi"
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Form Buttons */}
              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving..." : "Save Vendor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {isDetailOpen && selectedVendor && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button 
              onClick={() => setIsDetailOpen(false)} 
              className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer"
            >
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedVendor.code}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                {selectedVendor.name}
              </h3>
              <p className="text-xs text-onyx/50">Category: {selectedVendor.category || "N/A"}</p>
            </div>

            {/* General Info */}
            <div className="flex-1 overflow-y-auto py-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                  Registration Details
                </h4>
                <div className="grid grid-cols-2 gap-4 text-xs bg-cream-dark/20 p-3 rounded-lg">
                  <div>
                    <span className="font-semibold text-onyx/50">GSTIN:</span>
                    <p className="font-mono font-bold text-onyx mt-0.5">{selectedVendor.gstin || "Not provided"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">PAN:</span>
                    <p className="font-mono font-bold text-onyx mt-0.5">{selectedVendor.pan || "Not provided"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Udyam No:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedVendor.udyamNo || "Not provided"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">TDS Applicable:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedVendor.tdsApplicable ? "Yes" : "No"}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                  Commercial Terms
                </h4>
                <div className="grid grid-cols-2 gap-4 text-xs bg-cream-dark/20 p-3 rounded-lg">
                  <div>
                    <span className="font-semibold text-onyx/50">Payment Terms:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedVendor.paymentTerms || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Credit Limit Days:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedVendor.creditDays} days</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                    Bank Details
                  </h4>
                  {canSeeBankDetails ? (
                    <span className="text-[9px] font-bold uppercase text-green-700 bg-green-50 px-2 py-0.5 rounded flex items-center space-x-1 border border-green-150">
                      <Unlock size={10} />
                      <span>Decrypted</span>
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase text-red-700 bg-red-50 px-2 py-0.5 rounded flex items-center space-x-1 border border-red-150">
                      <Lock size={10} />
                      <span>Masked</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs bg-cream-dark/20 p-3 rounded-lg">
                  <div>
                    <span className="font-semibold text-onyx/50">Bank Name:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedVendor.bankDetails?.bankName || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Account Number:</span>
                    <p className="font-mono font-bold text-onyx mt-0.5">
                      {maskBankNo(selectedVendor.bankDetails?.accountNo)}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">IFSC Code:</span>
                    <p className="font-mono font-bold text-onyx mt-0.5">{selectedVendor.bankDetails?.ifsc || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Branch:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedVendor.bankDetails?.branch || "N/A"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="w-full py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
