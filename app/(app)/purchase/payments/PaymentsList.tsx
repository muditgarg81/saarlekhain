"use client";

import { useState } from "react";
import { 
  recordPayment, 
  updatePayment, 
  deletePayment, 
  bulkDeletePayments 
} from "@/app/actions/payments";
import { limitYearTo4Digits } from "@/lib/date";
import { 
  Search, 
  Plus, 
  X, 
  Eye, 
  AlertCircle, 
  CheckCircle, 
  CreditCard,
  Building2,
  Calendar,
  Lock,
  Coins,
  Edit,
  Trash2,
  Printer,
  Download,
  CheckSquare,
  Square
} from "lucide-react";

interface PaymentRecord {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  invoiceAmount?: number;
  debitNotesAmount?: number;
  netAmount?: number;
  amount: number;
  paidOn: string;
  mode: string | null;
  reference: string | null;
  recordedBy: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  amount: number;
  debitNotesAmount: number;
  netAmount: number;
  vendorId: string;
  vendorName: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface PaymentsListProps {
  payments: PaymentRecord[];
  invoices: Invoice[];
  vendors: Vendor[];
  userRole: string;
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

export default function PaymentsList({
  payments,
  invoices,
  vendors,
  userRole
}: PaymentsListProps) {
  const [search, setSearch] = useState("");

  // Modals & States
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);


  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Form states
  const [newPayment, setNewPayment] = useState({
    vendorId: "",
    invoiceId: "",
    amount: 0,
    paidOn: new Date().toISOString().split("T")[0],
    mode: "NEFT",
    reference: ""
  });

  const [editPayment, setEditPayment] = useState({
    id: "",
    vendorId: "",
    invoiceId: "",
    amount: 0,
    paidOn: "",
    mode: "NEFT",
    reference: ""
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredInvoices = invoices.filter(inv => inv.vendorId === newPayment.vendorId);
  
  // Find current payment's link if editing, to display current invoice option
  const currentPayment = payments.find(p => p.id === editPayment.id);
  const editFilteredInvoices = invoices.filter(inv => inv.vendorId === editPayment.vendorId);

  const handleVendorChange = (vendorId: string) => {
    setNewPayment(prev => ({
      ...prev,
      vendorId,
      invoiceId: "",
      amount: 0
    }));
  };

  const handleInvoiceChange = (invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    setNewPayment(prev => ({
      ...prev,
      invoiceId,
      amount: inv ? inv.netAmount : 0
    }));
  };

  const handleEditVendorChange = (vendorId: string) => {
    setEditPayment(prev => ({
      ...prev,
      vendorId,
      invoiceId: "",
      amount: 0
    }));
  };

  const handleEditInvoiceChange = (invoiceId: string) => {
    if (invoiceId === currentPayment?.invoiceId) {
      setEditPayment(prev => ({
        ...prev,
        invoiceId,
        amount: currentPayment?.netAmount || currentPayment?.amount || 0
      }));
    } else {
      const inv = invoices.find(i => i.id === invoiceId);
      setEditPayment(prev => ({
        ...prev,
        invoiceId,
        amount: inv ? inv.netAmount : 0
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPayment.vendorId || newPayment.amount <= 0) {
      alert("Please select vendor and enter a positive payment amount");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    const res = await recordPayment(newPayment);
    setActionLoading(false);

    if (res.success) {
      setIsOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to log payment");
    }
  };

  const handleEditOpen = (pay: PaymentRecord) => {
    setEditPayment({
      id: pay.id,
      vendorId: pay.vendorId,
      invoiceId: pay.invoiceId || "",
      amount: pay.amount,
      paidOn: pay.paidOn,
      mode: pay.mode || "NEFT",
      reference: pay.reference || ""
    });
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPayment.vendorId || editPayment.amount <= 0) {
      alert("Please select vendor and enter a positive payment amount");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    const res = await updatePayment(editPayment.id, editPayment);
    setActionLoading(false);

    if (res.success) {
      setIsEditOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to update payment voucher");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this payment voucher? This cannot be undone.")) return;

    setActionLoading(true);
    const res = await deletePayment(id);
    setActionLoading(false);

    if (res.success) {
      window.location.reload();
    } else {
      alert(res.error || "Failed to delete payment voucher");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete the ${selectedIds.length} selected payment vouchers? This cannot be undone.`)) return;

    setActionLoading(true);
    const res = await bulkDeletePayments(selectedIds);
    setActionLoading(false);

    if (res.success) {
      setSelectedIds([]);
      window.location.reload();
    } else {
      alert(res.error || "Failed to bulk delete payment vouchers");
    }
  };

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Toggle select all
  const handleToggleSelectAll = () => {
    const currentFilteredIds = filteredPayments.map(p => p.id);
    const allSelected = currentFilteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !currentFilteredIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...currentFilteredIds])));
    }
  };

  // CSV Export
  const handleExportCSV = (targetIds?: string[]) => {
    const idsToExport = targetIds || (selectedIds.length > 0 ? selectedIds : filteredPayments.map(p => p.id));
    
    if (idsToExport.length === 0) {
      alert("No payments available to export.");
      return;
    }

    const paymentsToExport = payments.filter(p => idsToExport.includes(p.id));
    
    const headers = ["Voucher Number", "Supplier/Vendor", "Invoice Ref", "Amount", "Paid On", "Payment Mode", "Txn/Chq Ref", "Recorded By"];
    const rows = paymentsToExport.map(p => [
      p.number,
      `"${p.vendorName.replace(/"/g, '""')}"`,
      p.invoiceNo || "On Account",
      p.amount.toFixed(2),
      new Date(p.paidOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      p.mode || "N/A",
      p.reference || "-",
      `"${p.recordedBy.replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `PaymentsExport_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print via popup window
  const handlePrint = () => {
    const printContent = document.getElementById("print-payment-voucher")?.innerHTML;
    if (!printContent) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to print the voucher");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Payment Voucher - ${selectedPayment?.number || ""}</title>
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
              color: #1e1e24;
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
            \${printContent}
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

  const filteredPayments = payments.filter(pay => 
    pay.number.toLowerCase().includes(search.toLowerCase()) ||
    pay.vendorName.toLowerCase().includes(search.toLowerCase()) ||
    (pay.reference?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass-card p-5 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-saffron/10 text-saffron-dark rounded-lg">
            <Coins size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total Recorded Outflow</p>
            <p className="text-xl font-heading font-extrabold text-onyx mt-0.5">
              ₹{totalPayments.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
        <div className="glass-card p-5 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <CreditCard size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Unpaid Matched Invoices</p>
            <p className="text-xl font-heading font-extrabold text-onyx mt-0.5">
              {invoices.length} outstanding
            </p>
          </div>
        </div>
      </div>

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Supplier Payments Register</h2>
          <p className="text-xs text-onyx/50 mt-1">Immutable journal log of payables outflows. Real-time bank transfer commands are not executed.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setErrorMsg(null);
              setNewPayment({
                vendorId: "",
                invoiceId: "",
                amount: 0,
                paidOn: new Date().toISOString().split("T")[0],
                mode: "NEFT",
                reference: ""
              });
              setIsOpen(true);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Record Payment Voucher</span>
          </button>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Search by voucher number, supplier, reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th className="p-3 w-10 text-center">
                  <button
                    onClick={handleToggleSelectAll}
                    className="text-onyx/65 hover:text-onyx cursor-pointer"
                  >
                    {filteredPayments.length > 0 && filteredPayments.every(p => selectedIds.includes(p.id)) ? (
                      <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                </th>
                <th>Voucher No</th>
                <th>Supplier Name</th>
                <th>Invoice Ref</th>
                <th>Payment Mode</th>
                <th>Txn/Chq Ref</th>
                <th>Amount</th>
                <th>Paid On</th>
                <th className="text-center w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-onyx/40 font-medium">
                    No payment vouchers recorded.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((pay) => {
                  const isSelected = selectedIds.includes(pay.id);
                  return (
                    <tr key={pay.id} className={isSelected ? "bg-saffron/5" : ""}>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleToggleSelect(pay.id)}
                          className="text-onyx/60 hover:text-onyx cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                          ) : (
                            <Square size={16} />
                          )}
                        </button>
                      </td>
                      <td className="font-mono font-bold text-xs text-onyx/85">{pay.number}</td>
                      <td className="font-semibold text-onyx">{pay.vendorName}</td>
                      <td className="font-mono text-xs text-onyx/60">{pay.invoiceNo || "On Account"}</td>
                      <td>{pay.mode}</td>
                      <td className="font-mono text-xs">{pay.reference || "-"}</td>
                      <td className="font-mono font-bold">₹{pay.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                      <td suppressHydrationWarning>{new Date(pay.paidOn).toLocaleDateString()}</td>
                      <td className="text-center space-x-1">
                        <button
                          onClick={() => {
                            setSelectedPayment(pay);
                            setIsDetailOpen(true);
                          }}
                          title="View Details"
                          className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => handleEditOpen(pay)}
                          title="Edit Voucher"
                          className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                        >
                          <Edit size={13} />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPayment(pay);
                            setIsPrintModalOpen(true);
                          }}
                          title="Print Voucher"
                          className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                        >
                          <Printer size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(pay.id)}
                          title="Delete Voucher"
                          className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-red-600 hover:text-red-800 cursor-pointer inline-flex"
                        >
                          <Trash2 size={13} />
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

      {/* Record Payment Voucher Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Record Supplier Payment Voucher</h3>
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

              {/* Vendor Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Supplier *
                </label>
                <select
                  value={newPayment.vendorId}
                  onChange={(e) => handleVendorChange(e.target.value)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  required
                >
                  <option value="">Select Vendor</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Invoice Selector */}
              {newPayment.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Settle Against Invoice
                  </label>
                  <select
                    value={newPayment.invoiceId}
                    onChange={(e) => handleInvoiceChange(e.target.value)}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="">On Account / Advance Payment</option>
                    {filteredInvoices.map(inv => {
                      const hasDn = inv.debitNotesAmount > 0;
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNo} (₹{inv.amount.toLocaleString("en-IN")}{hasDn ? ` | Net off DN: ₹${inv.netAmount.toLocaleString("en-IN")}` : ""})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Amount & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Amount Paid (INR) *
                  </label>
                  <input
                    type="number"
                    required
                    value={newPayment.amount || ""}
                    onChange={(e) => setNewPayment(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Date Paid *
                  </label>
                  <input
                    type="date"
                    required
                    value={newPayment.paidOn}
                    onChange={(e) => setNewPayment(prev => ({ ...prev, paidOn: limitYearTo4Digits(e.target.value) }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
              </div>

              {/* Mode & Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Payment Mode *
                  </label>
                  <select
                    value={newPayment.mode}
                    onChange={(e) => setNewPayment(prev => ({ ...prev, mode: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="NEFT">NEFT / RTGS</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="UPI">UPI Transfer</option>
                    <option value="CASH">Cash Payment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Txn / Cheque Reference Code
                  </label>
                  <input
                    type="text"
                    value={newPayment.reference}
                    onChange={(e) => setNewPayment(prev => ({ ...prev, reference: e.target.value }))}
                    placeholder="e.g. UTR-1234567, Chq-890123"
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
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
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer"
                >
                  {actionLoading ? "Saving..." : "Record Payment Voucher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="mt-4 bg-onyx text-cream-light p-4 rounded-xl shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 border border-onyx-light animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center space-x-3 text-xs">
            <div className="p-2 bg-saffron text-onyx rounded-lg font-bold">
              {selectedIds.length} Selected
            </div>
            <span>Manage multiple payment vouchers simultaneously.</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleExportCSV(selectedIds)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-onyx-light hover:bg-white/10 border border-onyx-light text-xs font-bold rounded-lg transition-all cursor-pointer"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center space-x-1 px-3 py-1.5 bg-red-900 hover:bg-red-800 border border-red-800 text-cream-light text-xs font-bold rounded-lg transition-all cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Delete Vouchers</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-xs text-onyx/40 hover:text-white transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Edit Payment Voucher Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Edit Payment Voucher</h3>
              <button onClick={() => setIsEditOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Vendor Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Supplier *
                </label>
                <select
                  value={editPayment.vendorId}
                  onChange={(e) => handleEditVendorChange(e.target.value)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  required
                >
                  <option value="">Select Vendor</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Invoice Selector */}
              {editPayment.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Settle Against Invoice
                  </label>
                  <select
                    value={editPayment.invoiceId}
                    onChange={(e) => handleEditInvoiceChange(e.target.value)}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="">On Account / Advance Payment</option>
                    {currentPayment?.invoiceId && (
                      <option value={currentPayment.invoiceId}>
                        {currentPayment.invoiceNo} (Current - ₹{currentPayment.invoiceAmount?.toLocaleString("en-IN")}{(currentPayment.debitNotesAmount || 0) > 0 ? ` | Net off DN: ₹${currentPayment.netAmount?.toLocaleString("en-IN")}` : ""})
                      </option>
                    )}
                    {editFilteredInvoices.map(inv => {
                      const hasDn = inv.debitNotesAmount > 0;
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNo} (₹{inv.amount.toLocaleString("en-IN")}{hasDn ? ` | Net off DN: ₹${inv.netAmount.toLocaleString("en-IN")}` : ""})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Amount & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Amount Paid (INR) *
                  </label>
                  <input
                    type="number"
                    required
                    value={editPayment.amount || ""}
                    onChange={(e) => setEditPayment(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Date Paid *
                  </label>
                  <input
                    type="date"
                    required
                    value={editPayment.paidOn}
                    onChange={(e) => setEditPayment(prev => ({ ...prev, paidOn: limitYearTo4Digits(e.target.value) }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
              </div>

              {/* Mode & Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Payment Mode *
                  </label>
                  <select
                    value={editPayment.mode}
                    onChange={(e) => setEditPayment(prev => ({ ...prev, mode: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="NEFT">NEFT / RTGS</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="UPI">UPI Transfer</option>
                    <option value="CASH">Cash Payment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Txn / Cheque Reference Code
                  </label>
                  <input
                    type="text"
                    value={editPayment.reference}
                    onChange={(e) => setEditPayment(prev => ({ ...prev, reference: e.target.value }))}
                    placeholder="e.g. UTR-1234567, Chq-890123"
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit buttons */}
              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer"
                >
                  {actionLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Payment Voucher Modal */}
      {isPrintModalOpen && selectedPayment && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[95vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Print Payment Voucher Voucher</h3>
              <button
                onClick={() => {
                  setIsPrintModalOpen(false);
                  setSelectedPayment(null);
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-cream-light hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-zinc-50 flex justify-center">
              {/* PRINTABLE VOUCHER TEMPLATE */}
              <div id="print-payment-voucher" className="bg-white border-2 border-double border-onyx p-8 w-full max-w-xl text-onyx font-sans shadow-sm text-xs relative flex flex-col justify-between" style={{ minHeight: "297mm", height: "auto" }}>
                <div>
                  {/* Company Info */}
                  <div className="text-center border-b border-onyx pb-4 mb-4">
                    <h2 className="text-base font-bold tracking-wide uppercase">CROX OIL AND GAS PVT. LTD.</h2>
                    <p className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold mt-0.5">Stores & Purchase Division • Finance Department</p>
                  </div>

                  {/* Header Title Block */}
                  <div className="text-center my-4">
                    <span className="border-2 border-onyx px-6 py-1.5 font-bold uppercase tracking-widest bg-zinc-50 text-sm">
                      PAYMENT VOUCHER
                    </span>
                  </div>

                  {/* Metadata Row */}
                  <div className="grid grid-cols-2 gap-4 border-b border-onyx pb-3 my-6">
                    <div>
                      <p className="mb-1"><strong>Voucher No:</strong> <span className="font-mono font-bold">{selectedPayment.number}</span></p>
                      <p><strong>Payment Date:</strong> {new Date(selectedPayment.paidOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="text-right">
                      <p className="mb-1"><strong>Payment Mode:</strong> {selectedPayment.mode}</p>
                      <p><strong>Reference Code:</strong> {selectedPayment.reference || "N/A"}</p>
                    </div>
                  </div>

                  {/* To Party */}
                  <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 my-6">
                    <p className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Paid To Account of:</p>
                    <p className="text-sm font-bold">{selectedPayment.vendorName}</p>
                    <p className="text-[10px] text-zinc-500 mt-1 font-mono">Supplier Account Code: {vendors.find(v => v.id === selectedPayment.vendorId)?.code || "N/A"}</p>
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
                            <p className="font-semibold">Supplier Payment outflow adjustment.</p>
                            <p className="text-[10px] text-zinc-600 font-mono">
                              {selectedPayment.invoiceNo 
                                ? `Settlement against invoice reference number: ${selectedPayment.invoiceNo}`
                                : "Direct disbursement / on account advance payment."}
                            </p>
                          </td>
                          <td className="p-3 text-right font-mono font-bold">
                            ₹{selectedPayment.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                        <tr className="bg-zinc-50 font-bold border-t border-onyx">
                          <td colSpan={2} className="p-3 text-right border-r border-onyx uppercase tracking-wider text-[10px]">
                            Grand Total
                          </td>
                          <td className="p-3 text-right font-mono text-sm border-onyx">
                            ₹{selectedPayment.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Amount in words */}
                  <div className="my-6 border-b border-onyx pb-4">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Amount in Words:</p>
                    <p className="font-bold italic text-zinc-800">{amountToWords(selectedPayment.amount)}</p>
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
                      <p className="font-semibold">Passed By</p>
                      <p className="text-[9px] text-zinc-500">Internal Auditor</p>
                    </div>
                  </div>
                  <div>
                    <div className="border-t border-onyx pt-2 mx-2">
                      <p className="font-semibold">Authorized Signatory</p>
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
                  setSelectedPayment(null);
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

      {/* Payment Detail Side Drawer */}
      {isDetailOpen && selectedPayment && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                  {selectedPayment.number}
                </span>
                <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded flex items-center space-x-1 uppercase">
                  <CheckCircle size={10} />
                  <span>Audited Record</span>
                </span>
              </div>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                Supplier Payment Journal record
              </h3>
              <p className="text-xs text-onyx/50">Supplier: {selectedPayment.vendorName}</p>
            </div>

            <div className="flex-1 overflow-y-auto py-6 space-y-6 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-cream-dark/20 p-3 rounded-lg">
                <div>
                  <span className="font-semibold text-onyx/50">Payment Amount:</span>
                  <p className="font-mono font-extrabold text-saffron-dark text-sm mt-0.5">
                    ₹{selectedPayment.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Settlement Mode:</span>
                  <p className="font-bold text-onyx mt-0.5">{selectedPayment.mode}</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Paid Date:</span>
                  <p suppressHydrationWarning className="font-bold text-onyx mt-0.5">{new Date(selectedPayment.paidOn).toLocaleDateString()}</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/50">Transaction Ref:</span>
                  <p className="font-mono font-bold text-onyx mt-0.5">{selectedPayment.reference || "N/A"}</p>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-blue-800 space-y-1">
                <p className="font-bold flex items-center space-x-1">
                  <CheckCircle size={13} className="text-blue-600 shrink-0" />
                  <span>Audit Trail Reconciliation Compliance:</span>
                </p>
                <p className="text-[10px] text-blue-700 leading-relaxed font-semibold">
                  This transaction is recorded directly inside the materials and purchase ledger. Any updates or deletions made will be captured in the system audit logs for compliance.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-onyx/60">
                <div>
                  <span className="font-semibold text-onyx/40">Recorded By:</span>
                  <p className="font-bold mt-0.5">{selectedPayment.recordedBy}</p>
                </div>
                <div>
                  <span className="font-semibold text-onyx/40">System Timestamp:</span>
                  <p className="font-bold mt-0.5">{new Date(selectedPayment.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="w-full py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
