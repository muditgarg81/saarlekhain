"use client";

import { useState } from "react";
import { 
  createSupplierInvoice, 
  updateInvoiceMatchStatus 
} from "@/app/actions/invoices";
import { can } from "@/lib/rbac";
import { limitYearTo4Digits } from "@/lib/date";
import { 
  Search, 
  Plus, 
  X, 
  Trash2, 
  Check, 
  RefreshCw, 
  Eye, 
  AlertCircle, 
  ShieldCheck, 
  FileText,
  Building2,
  Calendar,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  FileCheck2,
  FileX2,
  Clock
} from "lucide-react";

interface InvoiceLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  rate: number;
}

interface InvoiceRecord {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string | null;
  amount: number;
  matchStatus: string;
  discrepancies: string[];
  vendorId: string;
  vendorName: string;
  poId: string | null;
  poNumber: string | null;
  lines: InvoiceLine[];
}

interface Item {
  id: string;
  code: string;
  name: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface PurchaseOrder {
  id: string;
  number: string;
  lines: {
    itemId: string;
    qty: number;
    rate: number;
  }[];
}

interface InvoicesListProps {
  invoices: InvoiceRecord[];
  purchaseOrders: PurchaseOrder[];
  items: Item[];
  vendors: Vendor[];
  user: any;
}

export default function InvoicesList({
  invoices,
  purchaseOrders,
  items,
  vendors,
  user
}: InvoicesListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modals & States
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);

  // New Invoice Form
  const [newInvoice, setNewInvoice] = useState({
    vendorId: "",
    poId: "",
    invoiceNo: "",
    invoiceDate: "",
    amount: 0,
    lines: [] as { itemId: string; qty: number; rate: number }[]
  });
  const [newInvLine, setNewInvLine] = useState({ itemId: "", qty: 1, rate: 0 });

  const [ocrLoading, setOcrLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const isAccounts = can(user, "invoice.match") || ["ACCOUNTS", "ADMIN", "OWNER"].includes(user.role);

  const handlePoChange = (poId: string) => {
    const selectedPo = purchaseOrders.find(p => p.id === poId);
    if (selectedPo) {
      setNewInvoice(prev => ({
        ...prev,
        poId,
        lines: selectedPo.lines.map(l => ({
          itemId: l.itemId,
          qty: l.qty,
          rate: l.rate
        }))
      }));
    } else {
      setNewInvoice(prev => ({
        ...prev,
        poId: "",
        lines: []
      }));
    }
  };

  const handleAddLine = () => {
    if (!newInvLine.itemId) return;
    setNewInvoice(prev => ({
      ...prev,
      lines: [...prev.lines, { ...newInvLine }]
    }));
    setNewInvLine({ itemId: "", qty: 1, rate: 0 });
  };

  // Run Gemini OCR Mock or Real parser
  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/ocr/grn", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      setOcrLoading(false);

      if (result.success && result.data) {
        const ocr = result.data;
        
        // Find vendor match by name
        const matchedVendor = vendors.find(v => 
          v.name.toLowerCase().includes((ocr.supplierName || "").toLowerCase())
        );

        // Find PO match by number
        const matchedPo = purchaseOrders.find(p => 
          p.number.toLowerCase() === (ocr.poNo || "").toLowerCase()
        );

        // Map lines
        const ocrLines = (ocr.lineItems || []).map((l: any) => {
          const matchedItem = items.find(i => 
            i.code.toLowerCase() === (l.itemCode || "").toLowerCase() ||
            i.name.toLowerCase().includes((l.description || "").toLowerCase())
          );
          return {
            itemId: matchedItem?.id || "",
            qty: l.quantity || 0,
            rate: l.rate || 0
          };
        }).filter((l: any) => l.itemId !== "");

        // Set form states
        setNewInvoice({
          vendorId: matchedVendor?.id || vendors[0]?.id || "",
          poId: matchedPo?.id || "",
          invoiceNo: ocr.invoiceNo || "",
          invoiceDate: ocr.invoiceDate || "",
          amount: ocrLines.reduce((sum: number, l: any) => sum + (l.qty * l.rate), 0),
          lines: ocrLines.length > 0 ? ocrLines : (matchedPo ? matchedPo.lines : [])
        });

        alert("Gemini OCR successfully extracted invoice metadata and line item rates!");
      } else {
        alert("OCR failed: " + result.error);
      }
    } catch (err) {
      setOcrLoading(false);
      alert("Failed to contact OCR service.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newInvoice.lines.length === 0) {
      alert("Please add at least one line item");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);

    const res = await createSupplierInvoice({
      ...newInvoice,
      amount: newInvoice.lines.reduce((sum, l) => sum + (l.qty * l.rate), 0)
    });
    
    setActionLoading(false);

    if (res.success) {
      setIsOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to post invoice");
    }
  };

  const handleOverrideStatus = async (status: "MATCHED" | "ON_HOLD") => {
    if (!overrideReason.trim()) {
      alert("Please enter a reason for override");
      return;
    }

    setActionLoading(true);
    const res = await updateInvoiceMatchStatus(selectedInvoice!.id, status, overrideReason);
    setActionLoading(false);

    if (res.success) {
      setIsDetailOpen(false);
      window.location.reload();
    } else {
      alert("Failed to override status: " + res.error);
    }
  };

  const filteredInvoices = invoices.filter(inv => 
    inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
    inv.vendorName.toLowerCase().includes(search.toLowerCase()) ||
    (inv.poNumber?.toLowerCase() || "").includes(search.toLowerCase())
  ).filter(inv => 
    statusFilter === "all" || inv.matchStatus === statusFilter
  );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Supplier Invoices & 3-Way Match</h2>
          <p className="text-xs text-onyx/50 mt-1">Audit inbound vendor invoices against approved Purchase Orders and accepted GRN warehouse quantities.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setErrorMsg(null);
              setNewInvoice({
                vendorId: "",
                poId: "",
                invoiceNo: "",
                invoiceDate: "",
                amount: 0,
                lines: []
              });
              setIsOpen(true);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Record Invoice</span>
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
            placeholder="Search by invoice no, supplier, PO number..."
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
          <option value="MATCHED">Matched Only</option>
          <option value="MISMATCH">Mismatch Alert</option>
          <option value="ON_HOLD">On Hold</option>
        </select>
      </div>

      {/* Register Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Supplier</th>
                <th>Linked PO</th>
                <th>Invoice Date</th>
                <th>Amount</th>
                <th>Due Date</th>
                <th className="text-center font-bold">3-Way Match</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-onyx/40 font-medium">
                    No supplier invoices recorded.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  return (
                    <tr key={inv.id}>
                      <td className="font-mono font-bold text-xs text-onyx/85">{inv.invoiceNo}</td>
                      <td className="font-semibold text-onyx">{inv.vendorName}</td>
                      <td className="font-mono text-xs text-onyx/65">{inv.poNumber || "Direct"}</td>
                      <td suppressHydrationWarning>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                      <td className="font-mono font-bold">₹{inv.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                      <td suppressHydrationWarning>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</td>
                      <td className="text-center">
                        <span className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          inv.matchStatus === "MATCHED" ? "bg-green-150 text-green-800 border border-green-200" :
                          inv.matchStatus === "MISMATCH" ? "bg-red-150 text-red-800 border border-red-200 animate-pulse" :
                          "bg-yellow-150 text-yellow-800 border border-yellow-200"
                        }`}>
                          {inv.matchStatus === "MATCHED" && <CheckCircle size={10} />}
                          {inv.matchStatus === "MISMATCH" && <AlertTriangle size={10} />}
                          {inv.matchStatus === "ON_HOLD" && <Clock size={10} />}
                          <span>{inv.matchStatus}</span>
                        </span>
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => {
                            setSelectedInvoice(inv);
                            setOverrideReason("");
                            setIsDetailOpen(true);
                          }}
                          className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                        >
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Invoice Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-3xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Record Supplier Invoice</h3>
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

              {/* Gemini OCR Invoice upload */}
              <div className="p-4 bg-saffron/10 border border-saffron/20 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-saffron-dark flex items-center space-x-1.5">
                    <Sparkles size={14} />
                    <span>Gemini AI Invoice OCR</span>
                  </h4>
                  <p className="text-[10px] text-onyx/50">Upload a supplier challan or invoice to auto-extract items, quantities, rates, and numbers.</p>
                </div>
                <div>
                  <label className="flex items-center space-x-2 px-3 py-1.5 bg-saffron hover:bg-saffron-dark border border-saffron-dark/10 rounded font-bold text-[10px] text-onyx shadow-md cursor-pointer">
                    <input 
                      type="file" 
                      accept="image/*,application/pdf" 
                      onChange={handleOcrUpload} 
                      disabled={ocrLoading} 
                      className="hidden" 
                    />
                    <span>{ocrLoading ? "Extracting..." : "Scan Invoice"}</span>
                  </label>
                </div>
              </div>

              {/* Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Supplier *
                  </label>
                  <select
                    value={newInvoice.vendorId}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, vendorId: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                    required
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Linked PO (For 3-Way Match)
                  </label>
                  <select
                    value={newInvoice.poId}
                    onChange={(e) => handlePoChange(e.target.value)}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="">Direct Invoice (No PO)</option>
                    {purchaseOrders.map(po => (
                      <option key={po.id} value={po.id}>{po.number}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Invoice Number & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Invoice Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={newInvoice.invoiceNo}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, invoiceNo: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Invoice Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={newInvoice.invoiceDate}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, invoiceDate: limitYearTo4Digits(e.target.value) }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
              </div>

              {/* Add line item (for direct invoices) */}
              {!newInvoice.poId && (
                <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Direct Invoice Line</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-6">
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                      <select
                        value={newInvLine.itemId}
                        onChange={(e) => setNewInvLine(prev => ({ ...prev, itemId: e.target.value }))}
                        className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg"
                      >
                        <option value="">Select Item</option>
                        {items.map(item => (
                          <option key={item.id} value={item.id}>[{item.code}] {item.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Qty *</label>
                      <input
                        type="number"
                        value={newInvLine.qty}
                        onChange={(e) => setNewInvLine(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                        className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Rate *</label>
                      <input
                        type="number"
                        step="any"
                        value={newInvLine.rate || ""}
                        onChange={(e) => setNewInvLine(prev => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
                        className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-1 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                    Invoice Items List ({newInvoice.lines.length})
                  </label>
                  <p className="text-xs font-bold text-saffron-dark font-mono">
                    Total: ₹{newInvoice.lines.reduce((sum, l) => sum + (l.qty * l.rate), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-2 font-bold uppercase">Item</th>
                        <th className="p-2 font-bold uppercase text-right w-24">Qty</th>
                        <th className="p-2 font-bold uppercase text-right w-28">Rate</th>
                        <th className="p-2 font-bold uppercase text-right w-28">Landed</th>
                        {!newInvoice.poId && <th className="p-2 text-center w-12">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {newInvoice.lines.map((line, idx) => {
                        const item = items.find(i => i.id === line.itemId);
                        return (
                          <tr key={idx} className="border-t border-onyx/5">
                            <td className="p-2">[{item?.code}] {item?.name}</td>
                            <td className="p-2 text-right">
                              {newInvoice.poId ? (
                                <input
                                  type="number"
                                  value={line.qty}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setNewInvoice(prev => {
                                      const updated = [...prev.lines];
                                      updated[idx].qty = val;
                                      return { ...prev, lines: updated };
                                    });
                                  }}
                                  className="w-20 text-xs p-1 border border-onyx/15 rounded text-right font-mono"
                                />
                              ) : line.qty}
                            </td>
                            <td className="p-2 text-right">
                              {newInvoice.poId ? (
                                <input
                                  type="number"
                                  step="any"
                                  value={line.rate}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setNewInvoice(prev => {
                                      const updated = [...prev.lines];
                                      updated[idx].rate = val;
                                      return { ...prev, lines: updated };
                                    });
                                  }}
                                  className="w-24 text-xs p-1 border border-onyx/15 rounded text-right font-mono"
                                />
                              ) : `₹${line.rate.toFixed(2)}`}
                            </td>
                            <td className="p-2 text-right font-mono font-bold">₹{(line.qty * line.rate).toFixed(2)}</td>
                            {!newInvoice.poId && (
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setNewInvoice(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))}
                                  className="text-red-600 hover:text-red-800 cursor-pointer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Submit buttons */}
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
                  disabled={actionLoading || newInvoice.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Processing Match..." : "Post & Run 3-Way Match"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Detail Drawer */}
      {isDetailOpen && selectedInvoice && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                  {selectedInvoice.invoiceNo}
                </span>
                <span className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                  selectedInvoice.matchStatus === "MATCHED" ? "bg-green-100 text-green-800" :
                  selectedInvoice.matchStatus === "MISMATCH" ? "bg-red-100 text-red-800" :
                  "bg-yellow-105 text-yellow-800"
                }`}>
                  {selectedInvoice.matchStatus}
                </span>
              </div>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                Supplier Invoice Audit
              </h3>
              <p className="text-xs text-onyx/50">Supplier: {selectedInvoice.vendorName}</p>
            </div>

            <div className="flex-1 overflow-y-auto py-6 space-y-6">
              {/* Failed validation check alarms */}
              {selectedInvoice.matchStatus === "MISMATCH" && selectedInvoice.discrepancies.length > 0 && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded text-xs space-y-1">
                  <h4 className="font-bold text-red-800 flex items-center space-x-1">
                    <AlertTriangle size={14} className="text-red-500 shrink-0" />
                    <span>Failed 3-Way Match Verification Alarms:</span>
                  </h4>
                  <ul className="list-disc list-inside text-red-700 text-[11px] space-y-1 mt-1 font-semibold">
                    {selectedInvoice.discrepancies.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* General details */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-cream-dark/20 p-3 rounded-lg">
                <div>
                  <span className="font-semibold text-onyx/50">Invoice Date:</span>
                  <p suppressHydrationWarning className="font-bold text-onyx mt-0.5">{new Date(selectedInvoice.invoiceDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Due Date:</span>
                  <p suppressHydrationWarning className="font-bold text-onyx mt-0.5">
                    {selectedInvoice.dueDate ? new Date(selectedInvoice.dueDate).toLocaleDateString() : "Immediate"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Total Amount:</span>
                  <p className="font-mono font-extrabold text-onyx mt-0.5">₹{selectedInvoice.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Purchase Order:</span>
                  <p className="font-mono font-bold text-onyx mt-0.5">{selectedInvoice.poNumber || "Direct (No PO)"}</p>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                  Invoice Items List
                </h4>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-2.5 font-bold">Item Description</th>
                        <th className="p-2.5 font-bold text-right">Qty</th>
                        <th className="p-2.5 font-bold text-right">Unit Rate</th>
                        <th className="p-2.5 font-bold text-right">Landed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.lines.map((line) => (
                        <tr key={line.id} className="border-t border-onyx/5">
                          <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                          <td className="p-2.5 text-right font-mono font-bold">{line.qty}</td>
                          <td className="p-2.5 text-right font-mono">₹{line.rate.toFixed(2)}</td>
                          <td className="p-2.5 text-right font-mono font-bold">₹{(line.qty * line.rate).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Accounts override action panel */}
              {isAccounts && (
                <div className="p-4 bg-cream-dark/30 border border-onyx/10 rounded-xl space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/65">
                    Accounts Override & Reconciliation Action
                  </h4>
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Provide reason for manual match override..."
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                  />
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleOverrideStatus("MATCHED")}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center space-x-1 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      <FileCheck2 size={13} />
                      <span>Manually Match</span>
                    </button>
                    <button
                      onClick={() => handleOverrideStatus("ON_HOLD")}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center space-x-1 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      <FileX2 size={13} />
                      <span>Hold Invoice</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="w-full py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
