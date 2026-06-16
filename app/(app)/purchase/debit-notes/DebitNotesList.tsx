"use client";

import { useState } from "react";
import { 
  postDebitCreditNote, 
  createDebitNote,
  updateDebitNote,
  deleteDebitNote,
  bulkPostDebitNotes,
  bulkDeleteDebitNotes
} from "@/app/actions/debitCreditNotes";
import { 
  Search, 
  X, 
  Plus, 
  Check, 
  AlertTriangle,
  FileText,
  DollarSign,
  TrendingDown,
  ShieldCheck,
  Building,
  Edit,
  Trash2,
  Printer,
  Download,
  CheckSquare,
  Square
} from "lucide-react";
import Link from "next/link";
import { can, SessionUser } from "@/lib/rbac";

interface SerializedNote {
  id: string;
  number: string;
  type: "DEBIT" | "CREDIT";
  vendorId: string;
  vendorName: string;
  refType: string | null;
  refId: string | null;
  amount: number;
  posted: boolean;
  createdAt: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface DebitNotesListProps {
  notes: SerializedNote[];
  vendors: Vendor[];
  user: SessionUser;
}

function amountToWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  
  function convertLessThanOneThousand(n: number): string {
    if (n < 20) return ones[n];
    const digit = n % 10;
    if (n < 100) return tens[Math.floor(n / 10)] + (digit ? " " + ones[digit] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 === 0 ? "" : " and " + convertLessThanOneThousand(n % 100));
  }
  
  const integerPart = Math.floor(amount);
  const decimalPart = Math.round((amount - integerPart) * 100);
  
  let result = "";
  
  let n = integerPart;
  if (n === 0) {
    result = "Zero";
  } else {
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    const remaining = n;
    
    if (crore) result += convertLessThanOneThousand(crore) + " Crore ";
    if (lakh) result += convertLessThanOneThousand(lakh) + " Lakh ";
    if (thousand) result += convertLessThanOneThousand(thousand) + " Thousand ";
    if (remaining) result += convertLessThanOneThousand(remaining);
  }
  
  result = result.trim() + " Rupees";
  
  if (decimalPart > 0) {
    result += " and " + convertLessThanOneThousand(decimalPart) + " Paise";
  }
  
  return result + " Only";
}

export default function DebitNotesList({ notes: initialNotes, vendors, user }: DebitNotesListProps) {
  const [notes, setNotes] = useState<SerializedNote[]>(initialNotes);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "POSTED" | "UNPOSTED">("ALL");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<SerializedNote | null>(null);

  const [formData, setFormData] = useState({
    vendorId: "",
    amount: "",
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isFinance = can(user, "invoice.match") || can(user, "payment.record") || ["ADMIN", "OWNER"].includes(user.role);

  // Filtered Notes
  const filteredNotes = notes.filter((n) => {
    const matchesSearch = 
      n.number.toLowerCase().includes(search.toLowerCase()) ||
      n.vendorName.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = 
      statusFilter === "ALL" ? true :
      statusFilter === "POSTED" ? n.posted : !n.posted;

    return matchesSearch && matchesStatus;
  });

  // Calculate Metrics
  const totalCount = notes.length;
  const unpostedCount = notes.filter((n) => !n.posted).length;
  const postedCount = notes.filter((n) => n.posted).length;
  const totalAmount = notes.reduce((sum, n) => sum + n.amount, 0);

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Toggle select all
  const handleToggleSelectAll = () => {
    const currentFilteredIds = filteredNotes.map(n => n.id);
    const allSelected = currentFilteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !currentFilteredIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...currentFilteredIds])));
    }
  };
  // Print handler via new window popup to prevent blank page print issues
  const handlePrint = () => {
    const printContent = document.getElementById("print-voucher")?.innerHTML;
    if (!printContent) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to print the voucher");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Debit Note - ${selectedNote?.number || ""}</title>
          <style>
            @page {
              size: A4;
              margin: 10mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 0;
              background: white;
              color: #1e1e24; /* onyx */
            }
            .border-double {
              border: 4px double #1e1e24;
            }
            .p-8 { padding: 2rem; }
            .text-center { text-align: center; }
            .border-b { border-bottom: 1px solid #1e1e24; }
            .pb-4 { padding-bottom: 1rem; }
            .mb-4 { margin-bottom: 1rem; }
            .text-base { font-size: 1rem; }
            .font-bold { font-weight: 700; }
            .tracking-wide { letter-spacing: 0.025em; }
            .uppercase { text-transform: uppercase; }
            .text-\\[9px\\] { font-size: 9px; }
            .tracking-wider { letter-spacing: 0.05em; }
            .text-zinc-500 { color: #71717a; }
            .font-semibold { font-weight: 600; }
            .mt-0.5 { margin-top: 0.125rem; }
            .my-4 { margin-top: 1rem; margin-bottom: 1rem; }
            .border-2 { border-width: 2px; }
            .border-onyx { border-color: #1e1e24; }
            .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
            .py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
            .tracking-widest { letter-spacing: 0.1em; }
            .bg-zinc-50 { background-color: #f4f4f5; }
            .text-sm { font-size: 0.875rem; }
            .grid { display: grid; }
            .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .gap-4 { gap: 1rem; }
            .pb-3 { padding-bottom: 0.75rem; }
            .my-6 { margin-top: 1.5rem; margin-bottom: 1.5rem; }
            .mb-1 { margin-bottom: 0.25rem; }
            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
            .text-right { text-align: right; }
            .rounded-lg { border-radius: 0.5rem; }
            .p-4 { padding: 1rem; }
            .text-\\[10px\\] { font-size: 10px; }
            .border-zinc-200 { border-color: #e4e4e7; }
            .border { border: 1px solid #1e1e24; }
            .overflow-hidden { overflow: hidden; }
            .w-full { width: 100%; }
            .border-collapse { border-collapse: collapse; }
            .bg-zinc-150 { background-color: #e4e4e7; }
            .border-r { border-right: 1px solid #1e1e24; }
            .align-top { vertical-align: top; }
            .p-3 { padding: 0.75rem; }
            .italic { font-style: italic; }
            .text-zinc-800 { color: #27272a; }
            .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .mx-2 { margin-left: 0.5rem; margin-right: 0.5rem; }
            .pt-16 { padding-top: 4rem; }
            .border-t { border-top: 1px solid #1e1e24; }
            .space-y-2 > * + * { margin-top: 0.5rem; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #1e1e24; padding: 12px; }
            th { background-color: #f4f4f5; }
          </style>
        </head>
        <body>
          <div class="border-double p-8" style="width: 170mm; height: 250mm; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; margin: auto;">
            ${printContent}
          </div>
          <script>
            window.onload = function() {
              window.print();
              window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };
  // Create Note
  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.vendorId || !formData.amount) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await createDebitNote({
        vendorId: formData.vendorId,
        amount: parseFloat(formData.amount),
        refType: "MANUAL",
      });

      if (res.success && res.note) {
        const vendor = vendors.find((v) => v.id === res.note!.vendorId);
        const newNote: SerializedNote = {
          id: res.note.id,
          number: res.note.number,
          type: res.note.type as "DEBIT" | "CREDIT",
          vendorId: res.note.vendorId,
          vendorName: vendor ? vendor.name : "Unknown Vendor",
          refType: res.note.refType,
          refId: res.note.refId,
          amount: res.note.amount,
          posted: res.note.posted,
          createdAt: res.note.createdAt.toISOString()
        };

        setNotes((prev) => [newNote, ...prev]);
        setSuccessMsg(`Debit Note "${newNote.number}" created successfully!`);
        setFormData({ vendorId: "", amount: "" });
        setTimeout(() => {
          setIsCreateModalOpen(false);
          setSuccessMsg(null);
        }, 1500);
      } else {
        setErrorMsg(res.error || "Failed to create Debit Note");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (note: SerializedNote) => {
    setSelectedNote(note);
    setFormData({
      vendorId: note.vendorId,
      amount: note.amount.toString(),
    });
    setIsEditModalOpen(true);
  };

  // Submit Edit
  const handleEditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNote || !formData.vendorId || !formData.amount) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await updateDebitNote(selectedNote.id, {
        vendorId: formData.vendorId,
        amount: parseFloat(formData.amount),
      });

      if (res.success && res.note) {
        const vendor = vendors.find((v) => v.id === res.note!.vendorId);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === selectedNote.id
              ? {
                  ...n,
                  vendorId: res.note!.vendorId,
                  vendorName: vendor ? vendor.name : "Unknown Vendor",
                  amount: res.note!.amount,
                }
              : n
          )
        );
        setSuccessMsg(`Debit Note "${selectedNote.number}" updated successfully!`);
        setTimeout(() => {
          setIsEditModalOpen(false);
          setSuccessMsg(null);
          setSelectedNote(null);
        }, 1500);
      } else {
        setErrorMsg(res.error || "Failed to update Debit Note");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Single Delete
  const handleDeleteNote = async (id: string, number: string) => {
    if (!confirm(`Are you sure you want to delete draft Debit Note "${number}"?`)) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await deleteDebitNote(id);
      if (res.success) {
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setSelectedIds((prev) => prev.filter((item) => item !== id));
        setSuccessMsg(`Debit Note "${number}" deleted successfully.`);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(res.error || "Failed to delete Debit Note");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Single Post
  const handlePostNote = async (id: string, number: string) => {
    if (!confirm(`Are you sure you want to POST Debit Note "${number}"? Once posted, it becomes immutable and will adjust the vendor account balances.`)) {
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await postDebitCreditNote(id);
      if (res.success && res.note) {
        setNotes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, posted: true } : n))
        );
        setSuccessMsg(`Debit Note "${number}" successfully posted to accounts!`);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(res.error || "Failed to post Debit Note");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Bulk Post
  const handleBulkPost = async () => {
    const selectedDrafts = notes.filter(n => selectedIds.includes(n.id) && !n.posted);
    if (selectedDrafts.length === 0) {
      alert("No draft notes selected to post.");
      return;
    }

    if (!confirm(`Are you sure you want to post all ${selectedDrafts.length} selected draft notes?`)) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await bulkPostDebitNotes(selectedDrafts.map(n => n.id));
      if (res.success) {
        setNotes((prev) =>
          prev.map((n) => selectedIds.includes(n.id) ? { ...n, posted: true } : n)
        );
        setSuccessMsg(`Successfully posted ${selectedDrafts.length} Debit Notes!`);
        setSelectedIds([]);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(res.error || "Failed to bulk post Debit Notes");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    const selectedDrafts = notes.filter(n => selectedIds.includes(n.id));
    if (selectedDrafts.some(n => n.posted)) {
      alert("Cannot delete posted notes. Please deselect posted notes first.");
      return;
    }

    if (!confirm(`Are you sure you want to delete all ${selectedDrafts.length} selected draft notes?`)) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await bulkDeleteDebitNotes(selectedDrafts.map(n => n.id));
      if (res.success) {
        setNotes((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
        setSuccessMsg(`Successfully deleted ${selectedDrafts.length} Debit Notes.`);
        setSelectedIds([]);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(res.error || "Failed to bulk delete Debit Notes");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // CSV Export
  const handleExportCSV = (targetIds?: string[]) => {
    const idsToExport = targetIds || (selectedIds.length > 0 ? selectedIds : filteredNotes.map(n => n.id));
    
    if (idsToExport.length === 0) {
      alert("No notes available to export.");
      return;
    }

    const notesToExport = notes.filter(n => idsToExport.includes(n.id));
    
    // CSV Construction
    const headers = ["Note Number", "Supplier/Vendor", "Reference Context", "Amount", "Date Raised", "Status"];
    const rows = notesToExport.map(n => [
      n.number,
      `"${n.vendorName.replace(/"/g, '""')}"`,
      n.refType === "GRN_REJECTION" ? "QC REJECTION" : "MANUAL ADJUSTMENT",
      n.amount.toFixed(2),
      new Date(n.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      n.posted ? "Posted" : "Draft"
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `DebitCreditNotes_Export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Open Print Modal
  const handleOpenPrint = (note: SerializedNote) => {
    setSelectedNote(note);
    setIsPrintModalOpen(true);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">


      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Debit & Credit Notes</h2>
          <p className="text-xs text-onyx/50 mt-1">Manage vendor debit adjustments for rejected materials, rate differences, and invoice reconciliation.</p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => handleExportCSV()}
            className="flex items-center space-x-1.5 px-3 py-2 border border-onyx/10 hover:bg-cream-dark/50 text-onyx text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer bg-white"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
          {isFinance && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Raise Debit Note</span>
            </button>
          )}
        </div>
      </div>

      {/* Message alerts */}
      {successMsg && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-green-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <Check size={16} className="text-green-500 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-red-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI metrics cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-onyx/5 text-onyx">
            <FileText size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total Adjustment Notes</div>
            <div className="text-lg font-bold text-onyx">{totalCount}</div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-amber-100 text-amber-700 border border-amber-200">
            <FileText size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Draft / Unposted</div>
            <div className="text-lg font-bold text-onyx">{unpostedCount}</div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-green-100 text-green-700 border border-green-200">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Posted (Audited)</div>
            <div className="text-lg font-bold text-onyx">{postedCount}</div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-onyx/5 shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-blue-100 text-blue-700 border border-blue-200">
            <TrendingDown size={20} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total Debit Adjustments</div>
            <div className="text-lg font-bold text-onyx">₹{totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      {/* Floating Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-onyx text-cream-light p-4 rounded-xl shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 border border-onyx-light animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center space-x-3 text-xs">
            <div className="p-2 bg-saffron text-onyx rounded-lg font-bold">
              {selectedIds.length} Selected
            </div>
            <span>Manage multiple adjustment notes simultaneously.</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleExportCSV(selectedIds)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-onyx-light hover:bg-white/10 border border-onyx-light text-xs font-bold rounded-lg transition-all cursor-pointer"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
            {isFinance && (
              <>
                <button
                  onClick={handleBulkPost}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg transition-all cursor-pointer"
                >
                  <ShieldCheck size={13} />
                  <span>Post Drafts</span>
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-red-900 hover:bg-red-800 border border-red-800 text-cream-light text-xs font-bold rounded-lg transition-all cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Delete Drafts</span>
                </button>
              </>
            )}
            <button
              onClick={() => setSelectedIds([])}
              className="p-1.5 text-cream-dark hover:text-cream-light cursor-pointer"
              title="Clear selection"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Filter and Table Card */}
      <div className="glass-card p-6 rounded-xl border border-onyx/5 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-onyx/40 pointer-events-none">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search by Note number or Supplier name..."
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
            {(["ALL", "UNPOSTED", "POSTED"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  statusFilter === status
                    ? "bg-white text-onyx shadow-xs font-bold"
                    : "text-onyx/60 hover:text-onyx"
                }`}
              >
                {status === "ALL" ? "All" : status === "UNPOSTED" ? "Drafts" : "Posted"}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table (Desktop View) */}
        <div className="hidden md:block border border-onyx/10 rounded-xl overflow-hidden shadow-xs bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-cream-dark/50 border-b border-onyx/10 text-onyx font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <button
                      onClick={handleToggleSelectAll}
                      className="text-onyx/65 hover:text-onyx cursor-pointer"
                    >
                      {filteredNotes.length > 0 && filteredNotes.every(n => selectedIds.includes(n.id)) ? (
                        <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th className="p-3">Note Number</th>
                  <th className="p-3">Supplier / Vendor</th>
                  <th className="p-3">Reference Context</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Date Raised</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredNotes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-onyx/40">
                      No debit or credit notes found matching the filters.
                    </td>
                  </tr>
                ) : (
                  filteredNotes.map((note) => {
                    const isSelected = selectedIds.includes(note.id);
                    return (
                      <tr key={note.id} className={`hover:bg-cream-dark/10 transition-colors ${isSelected ? "bg-saffron/5" : ""}`}>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleSelect(note.id)}
                            className="text-onyx/60 hover:text-onyx cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </td>
                        <td className="p-3 font-mono font-bold text-onyx">
                          {note.number}
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-onyx">{note.vendorName}</div>
                        </td>
                        <td className="p-3">
                          {note.refType === "GRN_REJECTION" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-bold border border-red-100">
                              QC REJECTION
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px] font-bold border border-zinc-200">
                              MANUAL ADJUSTMENT
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono font-bold text-onyx">
                          ₹{note.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-onyx/75">
                          {new Date(note.createdAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric"
                          })}
                        </td>
                        <td className="p-3">
                          {note.posted ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                              Posted (Linked)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              Draft (Unposted)
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => handleOpenPrint(note)}
                              className="p-1 hover:bg-cream-dark/50 text-onyx/65 hover:text-onyx rounded cursor-pointer"
                              title="Print voucher"
                            >
                              <Printer size={14} />
                            </button>
                            
                            {!note.posted && isFinance && (
                              <>
                                <button
                                  onClick={() => handleOpenEdit(note)}
                                  className="p-1 hover:bg-cream-dark/50 text-blue-600 hover:text-blue-800 rounded cursor-pointer"
                                  title="Edit note"
                                  disabled={loading}
                                >
                                  <Edit size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteNote(note.id, note.number)}
                                  className="p-1 hover:bg-cream-dark/50 text-red-600 hover:text-red-800 rounded cursor-pointer"
                                  title="Delete note"
                                  disabled={loading}
                                >
                                  <Trash2 size={14} />
                                </button>
                                <button
                                  onClick={() => handlePostNote(note.id, note.number)}
                                  className="px-2 py-1 bg-saffron hover:bg-saffron-dark text-[10px] font-bold text-onyx rounded shadow-2xs cursor-pointer transition-all ml-1"
                                  disabled={loading}
                                >
                                  Post
                                </button>
                              </>
                            )}

                            {note.posted && (
                              <span className="text-[10px] text-green-600 font-bold flex items-center justify-end gap-1 select-none pr-1">
                                <Check size={12} />
                                <span>Audited</span>
                              </span>
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
          {filteredNotes.length === 0 ? (
            <div className="border border-onyx/10 rounded-xl p-6 text-center text-onyx/40 bg-white">
              No debit or credit notes found matching the filters.
            </div>
          ) : (
            filteredNotes.map((note) => {
              const isSelected = selectedIds.includes(note.id);
              return (
                <div
                  key={note.id}
                  className={`border rounded-xl p-4 transition-colors bg-white shadow-xs space-y-3 ${
                    isSelected ? "border-saffron bg-saffron/5" : "border-onyx/10"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-onyx/5 pb-2">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleToggleSelect(note.id)}
                        className="text-onyx/60 hover:text-onyx cursor-pointer"
                      >
                        {isSelected ? (
                          <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                      <span className="font-mono font-bold text-xs text-onyx">{note.number}</span>
                    </div>
                    <span className="font-mono font-bold text-xs text-saffron-dark">
                      ₹{note.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-onyx/70">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Supplier / Vendor</span>
                      <span className="font-semibold text-onyx">{note.vendorName}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Reference Context</span>
                        {note.refType === "GRN_REJECTION" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[9px] font-bold border border-red-100">
                            QC REJECTION
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[9px] font-bold border border-zinc-200">
                            MANUAL ADJUSTMENT
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Status</span>
                        {note.posted ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-800 border border-green-200">
                            Posted
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            Draft
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Date Raised</span>
                      <span className="font-semibold text-onyx" suppressHydrationWarning>
                        {new Date(note.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric"
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-onyx/5">
                    <button
                      onClick={() => handleOpenPrint(note)}
                      className="p-1.5 hover:bg-cream-dark/50 text-onyx/65 hover:text-onyx rounded cursor-pointer inline-flex border border-transparent hover:border-onyx/5"
                      title="Print voucher"
                    >
                      <Printer size={14} />
                    </button>
                    
                    {!note.posted && isFinance && (
                      <>
                        <button
                          onClick={() => handleOpenEdit(note)}
                          className="p-1.5 hover:bg-cream-dark/50 text-blue-600 hover:text-blue-800 rounded cursor-pointer inline-flex border border-transparent hover:border-onyx/5"
                          title="Edit note"
                          disabled={loading}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id, note.number)}
                          className="p-1.5 hover:bg-cream-dark/50 text-red-600 hover:text-red-800 rounded cursor-pointer inline-flex border border-transparent hover:border-onyx/5"
                          title="Delete note"
                          disabled={loading}
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          onClick={() => handlePostNote(note.id, note.number)}
                          className="px-2 py-1 bg-saffron hover:bg-saffron-dark text-[10px] font-bold text-onyx rounded shadow-2xs cursor-pointer transition-all ml-1"
                          disabled={loading}
                        >
                          Post
                        </button>
                      </>
                    )}

                    {note.posted && (
                      <span className="text-[10px] text-green-600 font-bold flex items-center gap-1 select-none pr-1">
                        <Check size={12} />
                        <span>Audited</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Raise / Create Debit Note Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-onyx/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-cream max-w-sm w-full flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 bg-onyx text-cream flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-saffron">
                  Raise Manual Debit Note
                </h3>
                <p className="text-[10px] text-cream-light/70 mt-0.5">
                  Raise accounts adjustment note against a supplier
                </p>
              </div>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setErrorMsg(null);
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-cream-light hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateNote} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Select Supplier / Vendor *
                </label>
                <select
                  required
                  value={formData.vendorId}
                  onChange={(e) => setFormData(prev => ({ ...prev, vendorId: e.target.value }))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx"
                  disabled={loading}
                >
                  <option value="">-- Choose Vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      [{v.code}] {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Adjustment Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="e.g. 1540.00"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono font-bold"
                  disabled={loading}
                />
              </div>

              <div className="flex space-x-2 pt-2 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
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
                  {loading ? "Creating..." : "Create Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Debit Note Modal */}
      {isEditModalOpen && selectedNote && (
        <div className="fixed inset-0 bg-onyx/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-cream max-w-sm w-full flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 bg-onyx text-cream flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-saffron">
                  Edit Debit Note ({selectedNote.number})
                </h3>
                <p className="text-[10px] text-cream-light/70 mt-0.5">
                  Modify details for this unposted draft note
                </p>
              </div>
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setErrorMsg(null);
                  setSelectedNote(null);
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-cream-light hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEditNote} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Select Supplier / Vendor *
                </label>
                <select
                  required
                  value={formData.vendorId}
                  onChange={(e) => setFormData(prev => ({ ...prev, vendorId: e.target.value }))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx"
                  disabled={loading}
                >
                  <option value="">-- Choose Vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      [{v.code}] {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Adjustment Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="e.g. 1540.00"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono font-bold"
                  disabled={loading}
                />
              </div>

              <div className="flex space-x-2 pt-2 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedNote(null);
                  }}
                  className="flex-1 py-2.5 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-saffron hover:bg-saffron-dark text-xs font-bold text-onyx rounded-lg shadow-sm transition-all duration-150 cursor-pointer"
                  disabled={loading}
                >
                  {loading ? "Updating..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Voucher Modal */}
      {isPrintModalOpen && selectedNote && (
        <div className="fixed inset-0 bg-onyx/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 no-print">
          <div className="bg-cream max-w-2xl w-full flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh]">
            <div className="p-4 bg-onyx text-cream flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-saffron">
                  Print Voucher Preview
                </h3>
                <p className="text-[10px] text-cream-light/70 mt-0.5">
                  Formal adjustment voucher layout
                </p>
              </div>
              <button
                onClick={() => {
                  setIsPrintModalOpen(false);
                  setSelectedNote(null);
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-cream-light hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-zinc-50 flex justify-center">
              {/* PRINTABLE VOUCHER TEMPLATE */}
              <div id="print-voucher" className="bg-white border-2 border-double border-onyx p-8 w-full max-w-xl text-onyx font-sans shadow-sm text-xs relative flex flex-col justify-between" style={{ minHeight: "297mm", height: "auto" }}>
                <div>
                  {/* Company Info */}
                  <div className="text-center border-b border-onyx pb-4 mb-4">
                    <h2 className="text-base font-bold tracking-wide uppercase">CROX OIL AND GAS PVT. LTD.</h2>
                    <p className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mt-0.5">Stores & Purchase Division • Accounts Department</p>
                  </div>

                  {/* Header Title Block */}
                  <div className="text-center my-4">
                    <span className="border-2 border-onyx px-6 py-1.5 font-bold uppercase tracking-widest bg-zinc-50 text-sm">
                      DEBIT NOTE
                    </span>
                  </div>

                  {/* Metadata Row */}
                  <div className="grid grid-cols-2 gap-4 border-b border-onyx pb-3 my-6">
                    <div>
                      <p className="mb-1"><strong>Note No:</strong> <span className="font-mono font-bold">{selectedNote.number}</span></p>
                      <p><strong>Note Date:</strong> {new Date(selectedNote.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="text-right">
                      <p className="mb-1"><strong>Reference:</strong> {selectedNote.refType === "GRN_REJECTION" ? "QC Rejection" : "Manual Adjustment"}</p>
                      <p><strong>Status:</strong> {selectedNote.posted ? "POSTED" : "DRAFT"}</p>
                    </div>
                  </div>

                  {/* To Party */}
                  <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 my-6">
                    <p className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Debited To Account of:</p>
                    <p className="text-sm font-bold">{selectedNote.vendorName}</p>
                    <p className="text-[10px] text-zinc-500 mt-1 font-mono">Supplier Account Code: {vendors.find(v => v.id === selectedNote.vendorId)?.code || "N/A"}</p>
                  </div>

                  {/* Ledger Table */}
                  <div className="border border-onyx rounded-lg overflow-hidden my-6">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-150 border-b border-onyx font-bold">
                          <th className="p-3 w-12 border-r border-onyx text-center">S.No</th>
                          <th className="p-3 border-r border-onyx">Particulars / Description</th>
                          <th className="p-3 text-right w-32">Amount (INR)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-onyx align-top" style={{ height: "150px" }}>
                          <td className="p-3 border-r border-onyx text-center font-mono">01</td>
                          <td className="p-3 border-r border-onyx space-y-2">
                            <p className="font-semibold">Debit adjustment raised for vendor return / QC rejection.</p>
                            <p className="text-[10px] text-zinc-600 font-mono">
                              {selectedNote.refType === "GRN_REJECTION" 
                                ? "Triggered automatically on status update: Rejected materials returned to vendor / disposed."
                                : "Raised manually to reconcile account balances."}
                            </p>
                          </td>
                          <td className="p-3 text-right font-mono font-bold">
                            ₹{selectedNote.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                        <tr className="bg-zinc-50 font-bold border-t border-onyx">
                          <td colSpan={2} className="p-3 text-right border-r border-onyx uppercase tracking-wider text-[10px]">
                            Grand Total
                          </td>
                          <td className="p-3 text-right font-mono text-sm border-onyx">
                            ₹{selectedNote.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Amount in words */}
                  <div className="my-6 border-b border-onyx pb-4">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Amount in Words:</p>
                    <p className="font-bold italic text-zinc-800">{amountToWords(selectedNote.amount)}</p>
                  </div>
                </div>

                {/* Signatures */}
                <div className="grid grid-cols-3 gap-4 text-center mt-auto pt-16">
                  <div>
                    <div className="border-t border-onyx pt-2 mx-2">
                      <p className="font-semibold">Prepared By</p>
                      <p className="text-[9px] text-zinc-500">Accounts Executive</p>
                    </div>
                  </div>
                  <div>
                    <div className="border-t border-onyx pt-2 mx-2">
                      <p className="font-semibold">Checked By</p>
                      <p className="text-[9px] text-zinc-500">Internal Auditor</p>
                    </div>
                  </div>
                  <div>
                    <div className="border-t border-onyx pt-2 mx-2">
                      <p className="font-semibold">Authorised Signatory</p>
                      <p className="text-[9px] text-zinc-500">Finance Manager</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-zinc-100 border-t border-onyx/10 flex justify-end space-x-2">
              <button
                onClick={() => {
                  setIsPrintModalOpen(false);
                  setSelectedNote(null);
                }}
                className="px-4 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handlePrint}
                className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg shadow-sm cursor-pointer"
              >
                Print Voucher
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
