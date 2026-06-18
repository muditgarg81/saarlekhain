"use client";

import { useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as xlsx from "xlsx";
import { 
  recordPayment, 
  updatePayment, 
  deletePayment, 
  bulkDeletePayments,
  confirmPendingPayment
} from "@/app/actions/payments";
import {
  createPaymentRequest,
  updatePaymentRequest,
  deletePaymentRequest,
  reviewPaymentRequest,
  confirmPaymentRequest,
  updatePaymentRequestStatus
} from "@/app/actions/paymentRequests";
import { limitYearTo4Digits } from "@/lib/date";
import { SearchableSelect } from "@/components/SearchableSelect";
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
  Square,
  Check,
  FileText,
  MoreVertical,
  Sliders
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
  paidAmount: number;
  balanceAmount: number;
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
  paymentRequests: any[];
  approvedPos: any[];
  pendingGrns: any[];
  allPos?: any[];
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
  userRole,
  paymentRequests,
  approvedPos,
  pendingGrns,
  allPos = []
}: PaymentsListProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"VOUCHERS" | "REQUESTS" | "DUE_GRNS">("VOUCHERS");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Modals & States
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // PO Detail States
  const [selectedPO, setSelectedPO] = useState<any | null>(null);
  const [isPODetailOpen, setIsPODetailOpen] = useState(false);

  // Payment Request States
  const [isReqOpen, setIsReqOpen] = useState(false);
  const [isEditReqOpen, setIsEditReqOpen] = useState(false);
  const [newRequest, setNewRequest] = useState({
    vendorId: "",
    poId: "",
    grnId: "",
    type: "ADVANCE" as "ADVANCE" | "AGAINST_BILL" | "OTHERS",
    amount: 0,
    remarks: ""
  });
  const [editRequest, setEditRequest] = useState({
    id: "",
    vendorId: "",
    poId: "",
    grnId: "",
    type: "ADVANCE" as "ADVANCE" | "AGAINST_BILL" | "OTHERS",
    amount: 0,
    remarks: ""
  });

  // Confirm Payment modal state
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    type: "REQUEST" | "PENDING_VOUCHER" | "GRN_DIRECT";
    id: string;
    amount: number;
    vendorName: string;
  } | null>(null);

  const [confirmForm, setConfirmForm] = useState({
    paidOn: new Date().toISOString().split("T")[0],
    mode: "NEFT",
    reference: ""
  });

  // Edit Request Status states
  const [isEditStatusOpen, setIsEditStatusOpen] = useState(false);
  const [editStatusReq, setEditStatusReq] = useState({
    id: "",
    number: "",
    status: "PENDING" as "PENDING" | "APPROVED" | "REJECTED",
    remarks: ""
  });

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
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dropdown-action")) {
        setActiveDropdownId(null);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, []);

  // Close dropdown when active tab changes
  useEffect(() => {
    setActiveDropdownId(null);
  }, [activeTab]);

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
      amount: inv ? inv.balanceAmount : 0
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
      const originalAmt = currentPayment?.amount || 0;
      const inv = invoices.find(i => i.id === invoiceId);
      const allowedMax = inv ? (inv.balanceAmount + originalAmt) : originalAmt;
      setEditPayment(prev => ({
        ...prev,
        invoiceId,
        amount: allowedMax
      }));
    } else {
      const inv = invoices.find(i => i.id === invoiceId);
      setEditPayment(prev => ({
        ...prev,
        invoiceId,
        amount: inv ? inv.balanceAmount : 0
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPayment.vendorId || newPayment.amount <= 0) {
      alert("Please select vendor and enter a positive payment amount");
      return;
    }

    if (newPayment.invoiceId) {
      const inv = invoices.find(i => i.id === newPayment.invoiceId);
      if (inv && newPayment.amount > inv.balanceAmount + 0.01) {
        if (!confirm(`Warning: Payment amount (₹${newPayment.amount.toLocaleString()}) exceeds the invoice balance amount (₹${inv.balanceAmount.toLocaleString()}). Do you still want to proceed?`)) {
          return;
        }
      }
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

    if (editPayment.invoiceId) {
      const inv = invoices.find(i => i.id === editPayment.invoiceId);
      const currentPay = payments.find(p => p.id === editPayment.id);
      const originalAmt = currentPay ? currentPay.amount : 0;
      const allowedMax = inv ? (inv.balanceAmount + originalAmt) : originalAmt;
      if (editPayment.amount > allowedMax + 0.01) {
        if (!confirm(`Warning: Payment amount (₹${editPayment.amount.toLocaleString()}) exceeds the allowed invoice balance (₹${allowedMax.toLocaleString()}). Do you still want to proceed?`)) {
          return;
        }
      }
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

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRequest.vendorId || newRequest.amount <= 0) {
      alert("Please select vendor and enter a positive payment request amount");
      return;
    }
    setActionLoading(true);
    setErrorMsg(null);
    const res = await createPaymentRequest({
      vendorId: newRequest.vendorId,
      poId: newRequest.poId || null,
      grnId: newRequest.grnId || null,
      type: newRequest.type,
      amount: newRequest.amount,
      remarks: newRequest.remarks || null
    });
    setActionLoading(false);
    if (res.success) {
      setIsReqOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to create payment request");
    }
  };

  const handleEditReqOpen = (req: any) => {
    setEditRequest({
      id: req.id,
      vendorId: req.vendorId,
      poId: req.poId || "",
      grnId: req.grnId || "",
      type: req.type,
      amount: req.amount,
      remarks: req.remarks || ""
    });
    setIsEditReqOpen(true);
  };

  const handleUpdateRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRequest.vendorId || editRequest.amount <= 0) {
      alert("Please select vendor and enter a positive payment request amount");
      return;
    }
    setActionLoading(true);
    setErrorMsg(null);
    const res = await updatePaymentRequest(editRequest.id, {
      vendorId: editRequest.vendorId,
      poId: editRequest.poId || null,
      grnId: editRequest.grnId || null,
      type: editRequest.type,
      amount: editRequest.amount,
      remarks: editRequest.remarks || null
    });
    setActionLoading(false);
    if (res.success) {
      setIsEditReqOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to update payment request");
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!confirm("Are you sure you want to delete this payment request? This cannot be undone.")) return;
    setActionLoading(true);
    const res = await deletePaymentRequest(id);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert(res.error || "Failed to delete payment request");
    }
  };

  const handleEditStatusOpen = (req: any) => {
    setEditStatusReq({
      id: req.id,
      number: req.number,
      status: req.status,
      remarks: req.remarks || ""
    });
    setIsEditStatusOpen(true);
  };

  const handleUpdateStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);
    const res = await updatePaymentRequestStatus(editStatusReq.id, {
      status: editStatusReq.status,
      remarks: editStatusReq.remarks
    });
    setActionLoading(false);
    if (res.success) {
      setIsEditStatusOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to update payment request status");
    }
  };


  const handleReviewRequest = async (id: string, status: "APPROVED" | "REJECTED") => {
    if (!confirm(`Are you sure you want to ${status.toLowerCase()} this payment request?`)) return;
    setActionLoading(true);
    const res = await reviewPaymentRequest(id, status);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert(res.error || `Failed to ${status.toLowerCase()} payment request`);
    }
  };

  const handleConfirmOpen = (target: {
    type: "REQUEST" | "PENDING_VOUCHER" | "GRN_DIRECT";
    id: string;
    amount: number;
    vendorName: string;
  }) => {
    setConfirmTarget(target);
    setConfirmForm({
      paidOn: new Date().toISOString().split("T")[0],
      mode: "NEFT",
      reference: ""
    });
    setIsConfirmOpen(true);
  };

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTarget) return;
    if (!confirmForm.reference.trim()) {
      alert("Please enter a transaction/cheque reference");
      return;
    }
    setActionLoading(true);
    setErrorMsg(null);

    let res;
    if (confirmTarget.type === "REQUEST") {
      res = await confirmPaymentRequest(confirmTarget.id, confirmForm);
    } else if (confirmTarget.type === "GRN_DIRECT") {
      const grn = pendingGrns.find(g => g.id === confirmTarget.id);
      if (!grn) {
        setActionLoading(false);
        setErrorMsg("GRN not found");
        return;
      }
      res = await recordPayment({
        vendorId: grn.vendorId,
        invoiceId: null,
        amount: confirmTarget.amount,
        paidOn: confirmForm.paidOn,
        mode: confirmForm.mode,
        reference: `${confirmForm.reference} (GRN: ${grn.number})`,
      });
    } else {
      res = await confirmPendingPayment(confirmTarget.id, confirmForm);
    }

    setActionLoading(false);
    if (res.success) {
      setIsConfirmOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to confirm payment");
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

  // Excel Export
  const handleExportExcel = (targetIds?: string[]) => {
    const idsToExport = targetIds || (selectedIds.length > 0 ? selectedIds : filteredPayments.map(p => p.id));
    if (idsToExport.length === 0) {
      alert("No payments available to export.");
      return;
    }

    const paymentsToExport = payments.filter(p => idsToExport.includes(p.id));

    const data = paymentsToExport.map(p => ({
      "Voucher Number": p.number,
      "Supplier/Vendor": p.vendorName,
      "Invoice Ref": p.invoiceNo || "On Account",
      "Amount (INR)": p.amount,
      "Paid On": new Date(p.paidOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      "Payment Mode": p.mode || "N/A",
      "Txn/Chq Ref": p.reference || "-",
      "Recorded By": p.recordedBy
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Payment Vouchers");
    xlsx.writeFile(workbook, `PaymentsExport_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // PDF Export
  const handleExportPDF = (targetIds?: string[]) => {
    const idsToExport = targetIds || (selectedIds.length > 0 ? selectedIds : filteredPayments.map(p => p.id));
    if (idsToExport.length === 0) {
      alert("No payments available to export.");
      return;
    }

    const paymentsToExport = payments.filter(p => idsToExport.includes(p.id));

    const doc = new jsPDF();
    
    // Title & Header details
    doc.setFontSize(16);
    doc.text("Saarlekha - Payment Vouchers Export", 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, 14, 21);
    
    const tableColumn = ["Voucher No", "Supplier/Vendor", "Invoice Ref", "Amount", "Paid On", "Mode", "Txn/Chq Ref"];
    const tableRows = paymentsToExport.map(p => [
      p.number,
      p.vendorName,
      p.invoiceNo || "On Account",
      `INR ${p.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
      new Date(p.paidOn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      p.mode || "N/A",
      p.reference || "-"
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 25,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 30, 36], textColor: [244, 244, 245] }
    });

    doc.save(`PaymentsExport_${new Date().toISOString().slice(0,10)}.pdf`);
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

  const filteredPayments = payments.filter(pay => 
    pay.number.toLowerCase().includes(search.toLowerCase()) ||
    pay.vendorName.toLowerCase().includes(search.toLowerCase()) ||
    (pay.reference?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const filteredRequests = paymentRequests.filter(req => {
    const matchesSearch = 
      req.number.toLowerCase().includes(search.toLowerCase()) ||
      req.vendorName.toLowerCase().includes(search.toLowerCase()) ||
      (req.remarks?.toLowerCase() || "").includes(search.toLowerCase()) ||
      (req.poNumber?.toLowerCase() || "").includes(search.toLowerCase()) ||
      (req.grnNumber?.toLowerCase() || "").includes(search.toLowerCase());

    const matchesStatus = statusFilter === "ALL" || req.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const pendingRequestsCount = paymentRequests.filter(
    (req) => req.status === "PENDING" || req.status === "APPROVED"
  ).length;

  const filteredGrns = pendingGrns.filter(grn => 
    grn.number.toLowerCase().includes(search.toLowerCase()) ||
    grn.vendorName.toLowerCase().includes(search.toLowerCase()) ||
    (grn.poNumber?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const computePoTotals = (
    lines: { qty: number; rate: number; discount: number; gstRate: number }[],
    otherCharges = 0
  ) => {
    let basicTotal = 0;
    let discountTotal = 0;
    let gstTotal = 0;
    let grandTotal = 0;

    const totalTaxable = lines.reduce((sum, line) => {
      return sum + line.qty * line.rate * (1 - line.discount / 100);
    }, 0);

    lines.forEach((line) => {
      const basic = line.qty * line.rate;
      const discount = basic * (line.discount / 100);
      const taxable = basic - discount;
      const allocatedOtherCharges = totalTaxable > 0 ? otherCharges * (taxable / totalTaxable) : 0;
      const gst = (taxable + allocatedOtherCharges) * (line.gstRate / 100);
      const landed = taxable + allocatedOtherCharges + gst;

      basicTotal += basic;
      discountTotal += discount;
      gstTotal += gst;
      grandTotal += landed;
    });

    return {
      basicTotal,
      discountTotal,
      gstTotal,
      grandTotal,
    };
  };

  const calculateLandedCost = (
    qty: number,
    rate: number,
    discount: number,
    gstRate: number,
    totalTaxable: number,
    otherCharges: number
  ) => {
    const basic = qty * rate;
    const discounted = basic * (1 - discount / 100);
    const allocatedOtherCharges = totalTaxable > 0 ? otherCharges * (discounted / totalTaxable) : 0;
    return (discounted + allocatedOtherCharges) * (1 + gstRate / 100);
  };

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

    // Code
    html = html.replace(/`(.*?)`/g, "<code class='px-1 bg-onyx/5 font-mono text-[10px] text-saffron-dark font-bold rounded'>$1</code>");

    // Bullet points
    html = html.split("\n").map(line => {
      if (line.trim().startsWith("- ")) {
        return `<li class="ml-4 list-disc text-xs text-onyx/75 mb-1">${line.trim().substring(2)}</li>`;
      }
      return line;
    }).join("\n");

    // Newlines to br or paragraphs
    html = html.split("\n\n").map(para => {
      return `<p class="mb-2 leading-relaxed">${para.replace(/\n/g, "<br />")}</p>`;
    }).join("");

    return html;
  };

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
          <p className="text-xs text-onyx/50 mt-1">Manage payment vouchers, log vendor payment requests, and track overdue bills.</p>
        </div>
        <div className="flex items-center space-x-3">
          {activeTab === "VOUCHERS" && (
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
          )}
          {activeTab === "REQUESTS" && (
            <button
              onClick={() => {
                setErrorMsg(null);
                setNewRequest({
                  vendorId: "",
                  poId: "",
                  grnId: "",
                  type: "ADVANCE",
                  amount: 0,
                  remarks: ""
                });
                setIsReqOpen(true);
              }}
              className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
            >
              <Plus size={15} />
              <span>Add Payment Request</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex border-b border-onyx/10 space-x-6 text-xs font-bold uppercase tracking-wider text-onyx/65 pb-0.5">
        <button
          onClick={() => {
            setActiveTab("VOUCHERS");
            setSelectedIds([]);
          }}
          className={`pb-2 px-1 border-b-2 cursor-pointer transition-all ${
            activeTab === "VOUCHERS" ? "border-saffron text-onyx font-extrabold" : "border-transparent hover:text-onyx"
          }`}
        >
          Payment Vouchers ({payments.length})
        </button>
        <button
          onClick={() => {
            setActiveTab("REQUESTS");
            setSelectedIds([]);
          }}
          className={`pb-2 px-1 border-b-2 cursor-pointer transition-all ${
            activeTab === "REQUESTS" ? "border-saffron text-onyx font-extrabold" : "border-transparent hover:text-onyx"
          }`}
        >
          Payment Requests ({pendingRequestsCount})
        </button>
        <button
          onClick={() => {
            setActiveTab("DUE_GRNS");
            setSelectedIds([]);
          }}
          className={`pb-2 px-1 border-b-2 cursor-pointer transition-all ${
            activeTab === "DUE_GRNS" ? "border-saffron text-onyx font-extrabold" : "border-transparent hover:text-onyx"
          }`}
        >
          Due / Overdue Bills (GRNs) ({pendingGrns.length})
        </button>
      </div>

      {/* Filter and Search */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5">
        <div className="flex flex-col md:flex-row gap-3 items-center w-full">
          <div className="relative flex-1 w-full">
            <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
              <Search size={15} />
            </span>
            <input
              type="text"
              placeholder={
                activeTab === "VOUCHERS"
                  ? "Search by voucher number, supplier, reference..."
                  : activeTab === "REQUESTS"
                  ? "Search by request number, supplier, PO/GRN, remarks..."
                  : "Search by GRN number, supplier, PO..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
            />
          </div>
          {activeTab === "REQUESTS" && (
            <div className="w-full md:w-48">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="PAID">Paid / Disbursed</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ==================== VOUCHERS TAB ==================== */}
      {activeTab === "VOUCHERS" && (
        <>
          {/* Table (Desktop View) */}
          <div className="hidden md:block glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
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
                    <th className="text-center w-20">Actions</th>
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
                      const isPending = pay.reference?.startsWith("ADVANCE PAY PENDING");
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
                          <td>
                            {pay.mode ? (
                              <span>{pay.mode}</span>
                            ) : (
                              <span className="text-onyx/30 italic">Unspecified</span>
                            )}
                          </td>
                          <td className="font-mono text-xs py-2">
                            {(() => {
                              const poMatch = pay.reference?.match(/\(PO:\s*([A-Za-z0-9-]+)\)/i) || pay.reference?.match(/PO:\s*([A-Za-z0-9-]+)/i);
                              const poNum = poMatch ? poMatch[1] : null;
                              if (poNum) {
                                const mainRef = pay.reference?.replace(/\s*\(?PO:\s*[A-Za-z0-9-]+\)?/i, "").trim() || "";
                                return (
                                  <div className="flex flex-col space-y-1">
                                    {isPending ? (
                                      <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider animate-pulse inline-flex items-center space-x-1 shadow-sm w-fit">
                                        <AlertCircle size={10} className="text-amber-600 animate-bounce" />
                                        <span>{mainRef || "ADVANCE PAY PENDING"}</span>
                                      </span>
                                    ) : (
                                      <span className="font-semibold text-onyx">
                                        {mainRef || "-"}
                                      </span>
                                    )}
                                    <div className="flex items-center space-x-1.5 text-[10px] text-onyx/50 font-sans mt-0.5">
                                      <span>PO: {poNum}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const matchedPo = allPos.find((p) => p.number === poNum);
                                          if (matchedPo) {
                                            setSelectedPO(matchedPo);
                                            setIsPODetailOpen(true);
                                          }
                                        }}
                                        title={`View PO ${poNum}`}
                                        className="px-1.5 py-0.5 bg-saffron hover:bg-saffron-dark text-[9px] font-mono font-bold rounded text-onyx hover:underline cursor-pointer inline-flex items-center"
                                      >
                                        <Eye size={8} className="mr-0.5 shrink-0" />
                                        <span>PO</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              return isPending ? (
                                <span className="px-2 py-1.5 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider animate-pulse inline-flex items-center space-x-1 shadow-sm">
                                  <AlertCircle size={10} className="text-amber-600 animate-bounce" />
                                  <span>{pay.reference}</span>
                                </span>
                              ) : (
                                pay.reference || "-"
                              );
                            })()}
                          </td>
                          <td className="font-mono font-bold">₹{pay.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                          <td suppressHydrationWarning>{new Date(pay.paidOn).toLocaleDateString()}</td>
                          <td className="text-center">
                            <div className="relative inline-block text-left dropdown-action">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdownId(activeDropdownId === pay.id ? null : pay.id);
                                }}
                                className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                                title="Actions"
                              >
                                <MoreVertical size={14} />
                              </button>
                              {activeDropdownId === pay.id && (
                                <div className="absolute right-0 mt-1 w-44 bg-white border border-onyx/10 rounded-lg shadow-xl z-50 py-1 font-sans text-xs text-left">
                                  <button
                                    onClick={() => {
                                      setSelectedPayment(pay);
                                      setIsDetailOpen(true);
                                      setActiveDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-cream-dark text-onyx flex items-center space-x-2 transition-colors duration-150"
                                  >
                                    <Eye size={13} className="text-onyx/60" />
                                    <span>View Details</span>
                                  </button>
                                  {isPending && (
                                    <button
                                      onClick={() => {
                                        handleConfirmOpen({
                                          type: "PENDING_VOUCHER",
                                          id: pay.id,
                                          amount: pay.amount,
                                          vendorName: pay.vendorName
                                        });
                                        setActiveDropdownId(null);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-green-50 text-green-600 flex items-center space-x-2 transition-colors duration-150 font-semibold"
                                    >
                                      <Check size={13} />
                                      <span>Confirm Pay</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      handleEditOpen(pay);
                                      setActiveDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-cream-dark text-onyx flex items-center space-x-2 transition-colors duration-150"
                                  >
                                    <Edit size={13} className="text-onyx/60" />
                                    <span>Edit Voucher</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSelectedPayment(pay);
                                      setIsPrintModalOpen(true);
                                      setActiveDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-cream-dark text-onyx flex items-center space-x-2 transition-colors duration-150"
                                  >
                                    <Printer size={13} className="text-onyx/60" />
                                    <span>Print Voucher</span>
                                  </button>
                                  <div className="border-t border-onyx/5 my-1" />
                                  <button
                                    onClick={() => {
                                      handleDelete(pay.id);
                                      setActiveDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-650 flex items-center space-x-2 transition-colors duration-150"
                                  >
                                    <Trash2 size={13} />
                                    <span>Delete Voucher</span>
                                  </button>
                                </div>
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
            {filteredPayments.length === 0 ? (
              <div className="glass-card p-6 text-center text-onyx/40 font-medium border border-onyx/5 rounded-xl animate-pulse">
                No payment vouchers recorded.
              </div>
            ) : (
              filteredPayments.map((pay) => {
                const isSelected = selectedIds.includes(pay.id);
                const isPending = pay.reference?.startsWith("ADVANCE PAY PENDING");
                return (
                  <div
                    key={pay.id}
                    className={`glass-card p-4 rounded-xl border transition-all duration-150 ${
                      isSelected ? "border-saffron bg-saffron/5" : "border-onyx/5 bg-cream"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-onyx/5 pb-2 mb-2">
                      <div className="flex items-center space-x-2">
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
                        <span className="font-mono font-bold text-xs text-onyx/85">{pay.number}</span>
                      </div>
                      <span className="font-mono font-bold text-xs text-saffron-dark">
                        ₹{pay.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs text-onyx/70">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Supplier</span>
                        <span className="font-semibold text-onyx">{pay.vendorName}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Invoice Ref</span>
                          <span className="font-semibold text-onyx">{pay.invoiceNo || "On Account"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Payment Mode</span>
                          <span className="font-semibold text-onyx">{pay.mode || "Unspecified"}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Txn/Chq Ref</span>
                          <span className="font-mono">
                            {(() => {
                              const poMatch = pay.reference?.match(/\(PO:\s*([A-Za-z0-9-]+)\)/i) || pay.reference?.match(/PO:\s*([A-Za-z0-9-]+)/i);
                              const poNum = poMatch ? poMatch[1] : null;
                              if (poNum) {
                                const mainRef = pay.reference?.replace(/\s*\(?PO:\s*[A-Za-z0-9-]+\)?/i, "").trim() || "";
                                return (
                                  <div className="flex flex-col space-y-0.5">
                                    {isPending ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[9px] font-bold uppercase tracking-wider animate-pulse w-fit">
                                        {mainRef || "PENDING"}
                                      </span>
                                    ) : (
                                      <span className="text-onyx font-semibold">{mainRef || "-"}</span>
                                    )}
                                    <div className="flex items-center space-x-1 text-[10px] text-onyx/50 font-sans">
                                      <span>PO: {poNum}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const matchedPo = allPos.find((p) => p.number === poNum);
                                          if (matchedPo) {
                                            setSelectedPO(matchedPo);
                                            setIsPODetailOpen(true);
                                          }
                                        }}
                                        className="px-1 py-0.2 bg-saffron hover:bg-saffron-dark text-[8px] font-mono font-bold rounded text-onyx cursor-pointer"
                                      >
                                        PO
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              return isPending ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[9px] font-bold uppercase tracking-wider animate-pulse">
                                  {pay.reference}
                                </span>
                              ) : (
                                pay.reference || "-"
                              );
                            })()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Paid On</span>
                          <span className="font-semibold text-onyx" suppressHydrationWarning>
                            {new Date(pay.paidOn).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end space-x-2 pt-2 mt-3 border-t border-onyx/5">
                      <button
                        onClick={() => {
                          setSelectedPayment(pay);
                          setIsDetailOpen(true);
                        }}
                        title="View Details"
                        className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                      >
                        <Eye size={14} />
                      </button>
                      {isPending && (
                        <button
                          onClick={() => handleConfirmOpen({
                            type: "PENDING_VOUCHER",
                            id: pay.id,
                            amount: pay.amount,
                            vendorName: pay.vendorName
                          })}
                          title="Confirm Payment Details"
                          className="p-1.5 hover:bg-green-50 border border-transparent hover:border-green-100 rounded text-green-600 hover:text-green-800 cursor-pointer inline-flex"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEditOpen(pay)}
                        title="Edit Voucher"
                        className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedPayment(pay);
                          setIsPrintModalOpen(true);
                        }}
                        title="Print Voucher"
                        className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                      >
                        <Printer size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(pay.id)}
                        title="Delete Voucher"
                        className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-red-600 hover:text-red-800 cursor-pointer inline-flex"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ==================== REQUESTS TAB ==================== */}
      {activeTab === "REQUESTS" && (
        <>
          {/* Table (Desktop View) */}
          <div className="hidden md:block glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full dense-table text-left border-collapse">
                <thead>
                  <tr>
                    <th>Request No</th>
                    <th>Supplier Name</th>
                    <th>PO Ref</th>
                    <th>GRN Ref</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Remarks</th>
                    <th>Recorded By</th>
                    <th className="text-center w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-onyx/40 font-medium">
                        No payment requests logged.
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((req) => {
                      const isPending = req.status === "PENDING";
                      const isApproved = req.status === "APPROVED";
                      const isRejected = req.status === "REJECTED";
                      const isPaid = req.status === "PAID";
                      const canApprove = ["OWNER", "ADMIN", "ACCOUNTS", "PURCHASE_MANAGER"].includes(userRole);

                      return (
                        <tr key={req.id}>
                          <td className="font-mono font-bold text-xs text-onyx/85">{req.number}</td>
                          <td className="font-semibold text-onyx">{req.vendorName}</td>
                          <td className="font-mono text-xs">
                            {req.poNumber ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const matchedPo = allPos.find((p) => p.number === req.poNumber || p.id === req.poId);
                                  if (matchedPo) {
                                    setSelectedPO(matchedPo);
                                    setIsPODetailOpen(true);
                                  }
                                }}
                                className="hover:underline text-saffron-dark font-semibold text-xs cursor-pointer"
                              >
                                {req.poNumber}
                              </button>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="font-mono text-xs text-onyx/60">{req.grnNumber || "-"}</td>
                          <td className="text-xs font-semibold">
                            {req.type === "ADVANCE" ? "Advance" : req.type === "AGAINST_BILL" ? "Against GRN" : "Others"}
                          </td>
                          <td className="font-mono font-bold text-onyx">₹{req.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                          <td>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                              isPending ? "bg-amber-100 text-amber-800 animate-pulse border border-amber-200" :
                              isApproved ? "bg-green-100 text-green-800 border border-green-200" :
                              isRejected ? "bg-red-100 text-red-800 border border-red-200" :
                              "bg-blue-100 text-blue-800 border border-blue-200"
                            }`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="text-onyx/60 truncate max-w-xs" title={req.remarks || ""}>{req.remarks || "-"}</td>
                          <td>{req.recordedBy}</td>
                          <td className="text-center">
                            {!isPaid ? (
                              <div className="relative inline-block text-left dropdown-action">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveDropdownId(activeDropdownId === req.id ? null : req.id);
                                  }}
                                  className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                                  title="Actions"
                                >
                                  <MoreVertical size={14} />
                                </button>
                                {activeDropdownId === req.id && (
                                  <div className="absolute right-0 mt-1 w-44 bg-white border border-onyx/10 rounded-lg shadow-xl z-50 py-1 font-sans text-xs text-left">
                                    {/* 1. Status Update / Approval Actions */}
                                    {canApprove && (
                                      <>
                                        <button
                                          onClick={() => {
                                            handleEditStatusOpen(req);
                                            setActiveDropdownId(null);
                                          }}
                                          className="w-full text-left px-4 py-2 hover:bg-cream-dark text-onyx flex items-center space-x-2 transition-colors duration-150"
                                        >
                                          <Sliders size={13} className="text-onyx/60" />
                                          <span>Edit Status / Remarks</span>
                                        </button>
                                        {isPending && (
                                          <>
                                            <button
                                              onClick={() => {
                                                handleReviewRequest(req.id, "APPROVED");
                                                setActiveDropdownId(null);
                                              }}
                                              className="w-full text-left px-4 py-2 hover:bg-green-50 text-green-600 flex items-center space-x-2 transition-colors duration-150 font-semibold"
                                            >
                                              <CheckCircle size={13} />
                                              <span>Approve Request</span>
                                            </button>
                                            <button
                                              onClick={() => {
                                                handleReviewRequest(req.id, "REJECTED");
                                                setActiveDropdownId(null);
                                              }}
                                              className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-500 flex items-center space-x-2 transition-colors duration-150"
                                            >
                                              <X size={13} />
                                              <span>Reject Request</span>
                                            </button>
                                          </>
                                        )}
                                        <div className="border-t border-onyx/5 my-1" />
                                      </>
                                    )}

                                    {/* 2. Confirm Payment for Approved Request */}
                                    {isApproved && (
                                      <>
                                        <button
                                          onClick={() => {
                                            handleConfirmOpen({
                                              type: "REQUEST",
                                              id: req.id,
                                              amount: req.amount,
                                              vendorName: req.vendorName
                                            });
                                            setActiveDropdownId(null);
                                          }}
                                          className="w-full text-left px-4 py-2 hover:bg-green-50 text-green-600 flex items-center space-x-2 transition-colors duration-150 font-semibold"
                                        >
                                          <CreditCard size={13} />
                                          <span>Confirm Pay</span>
                                        </button>
                                        <div className="border-t border-onyx/5 my-1" />
                                      </>
                                    )}

                                    {/* 3. General Edit / Delete actions for any unpaid request */}
                                    <button
                                      onClick={() => {
                                        handleEditReqOpen(req);
                                        setActiveDropdownId(null);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-cream-dark text-onyx flex items-center space-x-2 transition-colors duration-150"
                                    >
                                      <Edit size={13} className="text-onyx/60" />
                                      <span>Edit Request</span>
                                    </button>
                                    <button
                                      onClick={() => {
                                        handleDeleteRequest(req.id);
                                        setActiveDropdownId(null);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-655 flex items-center space-x-2 transition-colors duration-150"
                                    >
                                      <Trash2 size={13} />
                                      <span>Delete Request</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-zinc-400 font-semibold italic">Disbursed</span>
                            )}
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
            {filteredRequests.length === 0 ? (
              <div className="glass-card p-6 text-center text-onyx/40 font-medium border border-onyx/5 rounded-xl">
                No payment requests logged.
              </div>
            ) : (
              filteredRequests.map((req) => {
                const isPending = req.status === "PENDING";
                const isApproved = req.status === "APPROVED";
                const isRejected = req.status === "REJECTED";
                const isPaid = req.status === "PAID";
                const canApprove = ["OWNER", "ADMIN", "ACCOUNTS", "PURCHASE_MANAGER"].includes(userRole);

                return (
                  <div
                    key={req.id}
                    className="glass-card p-4 rounded-xl border border-onyx/5 bg-cream space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-onyx/5 pb-2">
                      <span className="font-mono font-bold text-xs text-onyx/85">{req.number}</span>
                      <span className="font-mono font-bold text-xs text-saffron-dark">
                        ₹{req.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs text-onyx/70">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Vendor</span>
                        <span className="font-semibold text-onyx">{req.vendorName}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Type</span>
                          <span className="font-semibold text-onyx">
                            {req.type === "ADVANCE" ? "Advance" : req.type === "AGAINST_BILL" ? "Against GRN" : "Others"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Status</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            isPending ? "bg-amber-100 text-amber-800 animate-pulse border border-amber-200" :
                            isApproved ? "bg-green-100 text-green-800 border border-green-200" :
                            isRejected ? "bg-red-100 text-red-800 border border-red-200" :
                            "bg-blue-100 text-blue-800 border border-blue-200"
                          }`}>
                            {req.status}
                          </span>
                        </div>
                      </div>
                      {(req.poNumber || req.grnNumber) && (
                        <div className="grid grid-cols-2 gap-2">
                          {req.poNumber && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">PO Ref</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const matchedPo = allPos.find((p) => p.number === req.poNumber || p.id === req.poId);
                                  if (matchedPo) {
                                    setSelectedPO(matchedPo);
                                    setIsPODetailOpen(true);
                                  }
                                }}
                                className="hover:underline text-saffron-dark font-semibold font-mono text-xs cursor-pointer text-left"
                              >
                                {req.poNumber}
                              </button>
                            </div>
                          )}
                          {req.grnNumber && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">GRN Ref</span>
                              <span className="font-mono text-onyx">{req.grnNumber}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {req.remarks && (
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Remarks</span>
                          <p className="italic">{req.remarks}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-onyx/5">
                      <span className="text-[9px] text-onyx/40">By {req.recordedBy}</span>
                      <div className="flex items-center space-x-2">
                        {/* 1. Status Edit */}
                        {canApprove && !isPaid && (
                          <button
                            onClick={() => handleEditStatusOpen(req)}
                            title="Edit Status & Remarks"
                            className="p-1 hover:bg-cream-dark border border-transparent rounded text-saffron hover:text-saffron-dark cursor-pointer inline-flex"
                          >
                            <Sliders size={14} />
                          </button>
                        )}

                        {/* 2. Review actions (Approve/Reject) for Pending */}
                        {isPending && canApprove && (
                          <>
                            <button
                              onClick={() => handleReviewRequest(req.id, "APPROVED")}
                              className="p-1 hover:bg-green-50 rounded text-green-600 cursor-pointer"
                              title="Approve"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button
                              onClick={() => handleReviewRequest(req.id, "REJECTED")}
                              className="p-1 hover:bg-red-50 rounded text-red-500 cursor-pointer"
                              title="Reject"
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}

                        {/* 3. Confirm Payment for Approved Request */}
                        {isApproved && (
                          <button
                            onClick={() => handleConfirmOpen({
                              type: "REQUEST",
                              id: req.id,
                              amount: req.amount,
                              vendorName: req.vendorName
                            })}
                            className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-bold shadow-sm flex items-center space-x-1 cursor-pointer"
                          >
                            <CreditCard size={12} />
                            <span>Confirm Payment</span>
                          </button>
                        )}

                        {/* 4. Edit details & Delete request for any unpaid request */}
                        {!isPaid && (
                          <>
                            <button
                              onClick={() => handleEditReqOpen(req)}
                              className="p-1 hover:bg-cream-dark border border-transparent rounded text-onyx/65 cursor-pointer"
                              title="Edit Request"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteRequest(req.id)}
                              className="p-1 hover:bg-cream-dark border border-transparent rounded text-red-600 cursor-pointer"
                              title="Delete Request"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}

                        {isPaid && (
                          <span className="text-[10px] text-zinc-400 font-semibold italic">Disbursed</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ==================== DUE GRNS TAB ==================== */}
      {activeTab === "DUE_GRNS" && (
        <>
          {/* Table (Desktop View) */}
          <div className="hidden md:block glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full dense-table text-left border-collapse">
                <thead>
                  <tr>
                    <th>GRN No</th>
                    <th>Supplier Name</th>
                    <th>PO Number</th>
                    <th>Bill Value (INR)</th>
                    <th>Posted On</th>
                    <th>Due Date</th>
                    <th>Payment Status</th>
                    <th className="text-center w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGrns.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-onyx/40 font-medium">
                        No pending bills or approved GRNs.
                      </td>
                    </tr>
                  ) : (
                    filteredGrns.map((grn) => {
                      return (
                        <tr key={grn.id} className={grn.isOverdue ? "bg-red-50/20" : ""}>
                          <td className="font-mono font-bold text-xs text-onyx/85">{grn.number}</td>
                          <td className="font-semibold text-onyx">{grn.vendorName}</td>
                          <td className="font-mono text-xs">
                            {grn.poNumber ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const matchedPo = allPos.find((p) => p.number === grn.poNumber || p.id === grn.poId);
                                  if (matchedPo) {
                                    setSelectedPO(matchedPo);
                                    setIsPODetailOpen(true);
                                  }
                                }}
                                className="hover:underline text-saffron-dark font-semibold text-xs cursor-pointer"
                              >
                                {grn.poNumber}
                              </button>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="font-mono text-xs">
                            <span className="font-bold text-onyx">₹{grn.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            {grn.paidAmount > 0 && (
                              <span className="block text-[10px] text-onyx/50 font-normal">
                                Orig: ₹{grn.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} | Paid: ₹{grn.paidAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </span>
                            )}
                          </td>
                          <td suppressHydrationWarning>{new Date(grn.postedAt).toLocaleDateString()}</td>
                          <td suppressHydrationWarning className="font-semibold text-onyx">{new Date(grn.dueDate).toLocaleDateString()}</td>
                          <td>
                            {grn.isOverdue ? (
                              <span className="px-2 py-1.5 rounded-lg text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 uppercase tracking-wider animate-pulse inline-flex items-center space-x-1 shadow-sm">
                                <AlertCircle size={10} className="text-red-600 animate-bounce" />
                                <span>OVERDUE ({grn.daysOverdue} days)</span>
                              </span>
                            ) : (
                              <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-zinc-100 text-zinc-700 border border-zinc-200 uppercase tracking-wider inline-flex items-center">
                                Due in {grn.daysUntilDue} days
                              </span>
                            )}
                          </td>
                          <td className="text-center">
                            <div className="relative inline-block text-left dropdown-action">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdownId(activeDropdownId === grn.id ? null : grn.id);
                                }}
                                className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                                title="Actions"
                              >
                                <MoreVertical size={14} />
                              </button>
                              {activeDropdownId === grn.id && (
                                <div className="absolute right-0 mt-1 w-44 bg-white border border-onyx/10 rounded-lg shadow-xl z-50 py-1 font-sans text-xs text-left">
                                  <button
                                    onClick={() => {
                                      setErrorMsg(null);
                                      setNewRequest({
                                        vendorId: grn.vendorId,
                                        poId: grn.poId,
                                        grnId: grn.id,
                                        type: "AGAINST_BILL",
                                        amount: grn.amount,
                                        remarks: `Payment request against GRN ${grn.number}`
                                      });
                                      setIsReqOpen(true);
                                      setActiveDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-cream-dark text-onyx flex items-center space-x-2 transition-colors duration-150"
                                  >
                                    <Plus size={13} className="text-onyx/60" />
                                    <span>Raise Request</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleConfirmOpen({
                                        type: "GRN_DIRECT",
                                        id: grn.id,
                                        amount: grn.amount,
                                        vendorName: grn.vendorName
                                      });
                                      setActiveDropdownId(null);
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-green-50 text-green-600 flex items-center space-x-2 transition-colors duration-150 font-semibold"
                                  >
                                    <Check size={13} />
                                    <span>Confirm Pay</span>
                                  </button>
                                </div>
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
            {filteredGrns.length === 0 ? (
              <div className="glass-card p-6 text-center text-onyx/40 font-medium border border-onyx/5 rounded-xl">
                No pending bills or approved GRNs.
              </div>
            ) : (
              filteredGrns.map((grn) => {
                return (
                  <div
                    key={grn.id}
                    className={`glass-card p-4 rounded-xl border transition-all duration-150 ${
                      grn.isOverdue ? "border-red-200 bg-red-50/10" : "border-onyx/5 bg-cream"
                    } space-y-3`}
                  >
                    <div className="flex items-center justify-between border-b border-onyx/5 pb-2">
                      <span className="font-mono font-bold text-xs text-onyx/85">{grn.number}</span>
                      <div className="text-right">
                        <span className="font-mono font-bold text-xs text-saffron-dark block">
                          ₹{grn.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                        {grn.paidAmount > 0 && (
                          <span className="text-[9px] text-onyx/40 block">
                            Paid: ₹{grn.paidAmount.toLocaleString("en-IN")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-onyx/70">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Supplier</span>
                        <span className="font-semibold text-onyx">{grn.vendorName}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">PO Number</span>
                          <button
                            type="button"
                            onClick={() => {
                              const matchedPo = allPos.find((p) => p.number === grn.poNumber || p.id === grn.poId);
                              if (matchedPo) {
                                setSelectedPO(matchedPo);
                                setIsPODetailOpen(true);
                              }
                            }}
                            className="hover:underline text-saffron-dark font-semibold font-mono text-xs cursor-pointer text-left"
                          >
                            {grn.poNumber}
                          </button>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Posted On</span>
                          <span className="font-semibold text-onyx" suppressHydrationWarning>{new Date(grn.postedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Due Date</span>
                          <span className="font-semibold text-onyx" suppressHydrationWarning>{new Date(grn.dueDate).toLocaleDateString()}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Status</span>
                          {grn.isOverdue ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 text-[9px] font-bold uppercase tracking-wider animate-pulse">
                              OVERDUE ({grn.daysOverdue} d)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-200 text-[9px] font-bold uppercase tracking-wider">
                              Due in {grn.daysUntilDue} d
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end space-x-2 pt-2 border-t border-onyx/5">
                      <button
                        onClick={() => {
                          setErrorMsg(null);
                          setNewRequest({
                            vendorId: grn.vendorId,
                            poId: grn.poId,
                            grnId: grn.id,
                            type: "AGAINST_BILL",
                            amount: grn.amount,
                            remarks: `Payment request against GRN ${grn.number}`
                          });
                          setIsReqOpen(true);
                        }}
                        className="px-2.5 py-1.5 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded shadow-sm flex items-center space-x-1 cursor-pointer bg-white"
                      >
                        <Plus size={12} />
                        <span>Raise Request</span>
                      </button>
                      <button
                        onClick={() => handleConfirmOpen({
                          type: "GRN_DIRECT",
                          id: grn.id,
                          amount: grn.amount,
                          vendorName: grn.vendorName
                        })}
                        className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-bold shadow-sm flex items-center space-x-1 cursor-pointer"
                      >
                        <Check size={12} />
                        <span>Confirm Pay</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

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
                <SearchableSelect
                  options={vendors.map(v => ({ value: v.id, label: v.name }))}
                  value={newPayment.vendorId}
                  onChange={(val) => handleVendorChange(val)}
                  placeholder="Select Vendor"
                />
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
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNo} (Net: ₹{inv.netAmount.toLocaleString("en-IN")} | Bal: ₹{inv.balanceAmount.toLocaleString("en-IN")}{inv.paidAmount > 0 ? `, Paid: ₹${inv.paidAmount.toLocaleString("en-IN")}` : ""})
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
              onClick={() => handleExportExcel(selectedIds)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-onyx-light hover:bg-white/10 border border-onyx-light text-xs font-bold rounded-lg transition-all cursor-pointer"
            >
              <Download size={13} />
              <span>Export Excel</span>
            </button>
            <button
              onClick={() => handleExportPDF(selectedIds)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-onyx-light hover:bg-white/10 border border-onyx-light text-xs font-bold rounded-lg transition-all cursor-pointer"
            >
              <Download size={13} />
              <span>Export PDF</span>
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
                <SearchableSelect
                  options={vendors.map(v => ({ value: v.id, label: v.name }))}
                  value={editPayment.vendorId}
                  onChange={(val) => handleEditVendorChange(val)}
                  placeholder="Select Vendor"
                />
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
                        {currentPayment.invoiceNo} (Current Settle - Net: ₹{currentPayment.netAmount?.toLocaleString("en-IN")} | Paid: ₹{currentPayment.amount?.toLocaleString("en-IN")})
                      </option>
                    )}
                    {editFilteredInvoices.map(inv => {
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNo} (Net: ₹{inv.netAmount.toLocaleString("en-IN")} | Bal: ₹{inv.balanceAmount.toLocaleString("en-IN")}{inv.paidAmount > 0 ? `, Paid: ₹${inv.paidAmount.toLocaleString("en-IN")}` : ""})
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
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <span className="font-mono font-bold text-onyx">{selectedPayment.reference || "N/A"}</span>
                    {(() => {
                      const poMatch = selectedPayment.reference?.match(/PO:\s*([A-Za-z0-9-]+)/i);
                      const poNum = poMatch ? poMatch[1] : null;
                      if (poNum) {
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              const matchedPo = allPos.find((p) => p.number === poNum);
                              if (matchedPo) {
                                setSelectedPO(matchedPo);
                                setIsPODetailOpen(true);
                              }
                            }}
                            className="px-1.5 py-0.5 bg-saffron hover:bg-saffron-dark text-[9px] font-mono font-bold rounded text-onyx hover:underline cursor-pointer transition-colors inline-flex items-center space-x-0.5"
                          >
                            <Eye size={8} />
                            <span>View PO</span>
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
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

      {/* ==================== PO DETAIL SIDE DRAWER ==================== */}
      {isPODetailOpen && selectedPO && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-[60]">
          <div className="w-full max-w-xl bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsPODetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                  {selectedPO.number}
                </span>
                <span className="text-[10px] font-mono font-bold bg-cream-dark/50 px-2 py-0.5 rounded text-onyx">
                  Version {selectedPO.version}
                </span>
                <span className="text-[10px] font-mono font-bold bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 rounded uppercase">
                  {selectedPO.status}
                </span>
              </div>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                Purchase Order Details
              </h3>
              <p className="text-xs text-onyx/50">Supplier: {selectedPO.vendorName}</p>
            </div>

            {/* General Info */}
            <div className="py-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs border-b border-onyx/5 bg-cream-dark/20 p-3.5 rounded-lg mt-4">
              <div>
                <span className="font-semibold text-onyx/50">PO Type:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.type}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Payment Terms:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.paymentTerms || "N/A"}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Freight Terms:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.freightTerms || "N/A"}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Delivery Date:</span>
                <p className="font-bold text-onyx mt-0.5">
                  <span suppressHydrationWarning>{selectedPO.deliveryDate ? new Date(selectedPO.deliveryDate).toLocaleDateString() : "N/A"}</span>
                </p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Supplier GSTIN:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.vendorGstin || "N/A"}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Supplier PAN:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.vendorPan || "N/A"}</p>
              </div>
              <div className="col-span-2">
                <span className="font-semibold text-onyx/50">Supplier Address:</span>
                <p className="font-bold text-onyx mt-0.5 whitespace-pre-line">{selectedPO.vendorAddress || "N/A"}</p>
              </div>
              <div className="col-span-2">
                <span className="font-semibold text-onyx/50">Ship-To Address:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.shipTo || "N/A"}</p>
              </div>
            </div>

            {/* Audit Trace */}
            {(selectedPO.rfqNumbers?.length > 0 || selectedPO.prNumbers?.length > 0 || selectedPO.indentNumbers?.length > 0) && (
              <div className="py-3 px-3.5 bg-saffron/5 border-l-2 border-saffron rounded-r-lg text-xs mt-3 space-y-2 font-sans">
                <h5 className="font-bold text-onyx/75 uppercase tracking-wider text-[10px]">Reference Audit Trace</h5>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {selectedPO.indentNumbers?.length > 0 && (
                    <div className="col-span-2">
                      <span className="font-semibold text-onyx/50">Indent Number(s):</span>
                      <p className="font-mono font-bold text-onyx mt-0.5">{selectedPO.indentNumbers.join(", ")}</p>
                    </div>
                  )}
                  {selectedPO.prNumbers?.length > 0 && (
                    <div>
                      <span className="font-semibold text-onyx/50">PR Number(s):</span>
                      <p className="font-mono font-bold text-onyx mt-0.5">{selectedPO.prNumbers.join(", ")}</p>
                    </div>
                  )}
                  {selectedPO.rfqNumbers?.length > 0 && (
                    <div>
                      <span className="font-semibold text-onyx/50">RFQ Number(s):</span>
                      <p className="font-mono font-bold text-onyx mt-0.5">{selectedPO.rfqNumbers.join(", ")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Lines & T&C */}
            <div className="flex-1 overflow-y-auto py-6 space-y-6">
              {/* Lines */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                  Item Lines Registered
                </h4>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50 text-[10px] uppercase font-bold tracking-wider text-onyx/50">
                      <tr>
                        <th className="p-2.5">Item Description</th>
                        <th className="p-2.5 text-right">Rate</th>
                        <th className="p-2.5 text-right">Qty</th>
                        <th className="p-2.5 text-right">Landed Cost</th>
                        <th className="p-2.5 text-right">Recd Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.lines.map((line: any) => {
                        const totalTaxable = selectedPO.lines.reduce((sum: number, l: any) => {
                          return sum + l.qty * l.rate * (1 - l.discount / 100);
                        }, 0);
                        const landed = calculateLandedCost(
                          line.qty,
                          line.rate,
                          line.discount,
                          line.gstRate,
                          totalTaxable,
                          selectedPO.otherCharges
                        );
                        return (
                          <tr key={line.id} className="border-t border-onyx/5">
                            <td className="p-2.5 text-onyx font-medium">[{line.itemCode}] {line.itemName}</td>
                            <td className="p-2.5 text-right font-mono text-onyx">₹{line.rate.toFixed(2)}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-onyx">{line.qty}</td>
                            <td className="p-2.5 text-right font-mono text-onyx">₹{landed.toFixed(2)}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-blue-700">{line.receivedQty}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals Breakdown */}
                {(() => {
                  const totals = computePoTotals(selectedPO.lines, selectedPO.otherCharges);
                  return (
                    <div className="p-3 bg-cream-dark/30 border border-onyx/5 rounded-lg space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-onyx/60 font-semibold">Basic Total Value:</span>
                        <span className="font-mono text-onyx">₹{totals.basicTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </div>
                      {totals.discountTotal > 0 && (
                        <div className="flex justify-between">
                          <span className="text-onyx/60 font-semibold">Total Discount (-):</span>
                          <span className="font-mono text-red-600 font-bold">-₹{totals.discountTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {selectedPO.otherCharges > 0 && (
                        <div className="flex justify-between">
                          <span className="text-onyx/60 font-semibold">Other Charges (+):</span>
                          <span className="font-mono text-onyx">₹{selectedPO.otherCharges.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-onyx/60 font-semibold">Total GST (+):</span>
                        <span className="font-mono text-onyx">₹{totals.gstTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="border-t border-onyx/10 pt-1.5 flex justify-between font-bold">
                        <span className="text-onyx">Net Landed Total:</span>
                        <span className="font-mono text-saffron-dark text-sm">₹{totals.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Terms & Conditions Block */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                    Terms & Conditions
                  </h4>
                  {(() => {
                    const resolved = selectedPO.resolvedTermsText || selectedPO.termsConditions;
                    if (resolved) {
                      return (
                        <div 
                          className="p-4 bg-white border border-onyx/5 rounded-lg text-xs text-onyx/85 prose prose-sm max-w-none leading-relaxed overflow-y-auto max-h-[20vh]"
                          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(resolved) }}
                        />
                      );
                    }
                    return (
                      <div className="p-3 bg-white border border-onyx/5 rounded-lg text-xs text-onyx/85 whitespace-pre-wrap leading-relaxed font-mono">
                        No specific terms & conditions defined for this Purchase Order.
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Version/Amendment History */}
              {selectedPO.amendments && selectedPO.amendments.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                    PO Amendment History
                  </h4>
                  <div className="space-y-3">
                    {selectedPO.amendments.map((am: any) => (
                      <div key={am.id} className="p-3 bg-cream-dark/25 border border-onyx/5 rounded-lg text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-onyx">Amendment v{am.version}</span>
                          <span suppressHydrationWarning className="text-[10px] text-onyx/40">{new Date(am.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-onyx/70 italic">"{am.reason || "No reason given"}"</p>
                        <p className="text-[10px] text-onyx/40 font-mono">Amended by: {am.createdBy}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsPODetailOpen(false)}
                className="w-full py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ADD PAYMENT REQUEST MODAL ==================== */}
      {isReqOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Coins size={18} className="text-saffron" />
                <h3 className="font-heading text-base font-bold">New Payment Request</h3>
              </div>
              <button onClick={() => setIsReqOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateRequest} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded text-red-800 font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Vendor Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Select Supplier *</label>
                <SearchableSelect
                  options={vendors.map(v => ({ value: v.id, label: `${v.name} (${v.code})` }))}
                  value={newRequest.vendorId}
                  onChange={(val) => {
                    setNewRequest(prev => ({
                      ...prev,
                      vendorId: val,
                      poId: "",
                      grnId: "",
                      amount: 0
                    }));
                  }}
                  placeholder="-- Choose Supplier --"
                />
              </div>

              {/* Payment Type */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Payment Type *</label>
                <select
                  value={newRequest.type}
                  onChange={(e) => {
                    setNewRequest(prev => ({
                      ...prev,
                      type: e.target.value as any,
                      poId: "",
                      grnId: "",
                      amount: 0
                    }));
                  }}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                >
                  <option value="ADVANCE">Advance (PO Pre-payment)</option>
                  <option value="AGAINST_BILL">Against Due Bill (GRN Receipt)</option>
                  <option value="OTHERS">Others / Misc</option>
                </select>
              </div>

              {/* Dynamic PO or GRN selector */}
              {newRequest.type === "ADVANCE" && newRequest.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Select Purchase Order</label>
                  <select
                    value={newRequest.poId}
                    onChange={(e) => setNewRequest(prev => ({ ...prev, poId: e.target.value }))}
                    className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  >
                    <option value="">-- Choose PO (Optional) --</option>
                    {approvedPos
                      .filter(p => p.vendorId === newRequest.vendorId)
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.number}</option>
                      ))}
                  </select>
                </div>
              )}

              {newRequest.type === "AGAINST_BILL" && newRequest.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Select Pending GRN *</label>
                  <select
                    value={newRequest.grnId}
                    onChange={(e) => {
                      const grnId = e.target.value;
                      const selectedGrn = pendingGrns.find(g => g.id === grnId);
                      setNewRequest(prev => ({
                        ...prev,
                        grnId,
                        poId: selectedGrn ? selectedGrn.poId : "",
                        amount: selectedGrn ? selectedGrn.amount : 0
                      }));
                    }}
                    className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  >
                    <option value="">-- Choose GRN --</option>
                    {pendingGrns
                      .filter(g => g.vendorId === newRequest.vendorId)
                      .map(g => (
                        <option key={g.id} value={g.id}>
                          {g.number} (Val: ₹{g.amount.toLocaleString("en-IN")}, Due: {g.dueDate})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Amount */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Amount (INR) *</label>
                <input
                  type="number"
                  step="any"
                  value={newRequest.amount || ""}
                  onChange={(e) => setNewRequest(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  placeholder="0.00"
                  required
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Remarks / Description</label>
                <textarea
                  value={newRequest.remarks}
                  onChange={(e) => setNewRequest(prev => ({ ...prev, remarks: e.target.value }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[60px]"
                  placeholder="Enter details like banking reference or urgency details..."
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsReqOpen(false)}
                  className="px-4 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== EDIT PAYMENT REQUEST MODAL ==================== */}
      {isEditReqOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Edit size={18} className="text-saffron" />
                <h3 className="font-heading text-base font-bold">Edit Payment Request</h3>
              </div>
              <button onClick={() => setIsEditReqOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleUpdateRequestSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded text-red-800 font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Vendor Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Supplier *</label>
                <SearchableSelect
                  options={vendors.map(v => ({ value: v.id, label: `${v.name} (${v.code})` }))}
                  value={editRequest.vendorId}
                  onChange={(val) => {
                    setEditRequest(prev => ({
                      ...prev,
                      vendorId: val,
                      poId: "",
                      grnId: "",
                      amount: 0
                    }));
                  }}
                  placeholder="-- Choose Supplier --"
                />
              </div>

              {/* Payment Type */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Payment Type *</label>
                <select
                  value={editRequest.type}
                  onChange={(e) => {
                    setEditRequest(prev => ({
                      ...prev,
                      type: e.target.value as any,
                      poId: "",
                      grnId: "",
                      amount: 0
                    }));
                  }}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                >
                  <option value="ADVANCE">Advance (PO Pre-payment)</option>
                  <option value="AGAINST_BILL">Against Due Bill (GRN Receipt)</option>
                  <option value="OTHERS">Others / Misc</option>
                </select>
              </div>

              {/* Dynamic PO or GRN selector */}
              {editRequest.type === "ADVANCE" && editRequest.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Select Purchase Order</label>
                  <select
                    value={editRequest.poId}
                    onChange={(e) => setEditRequest(prev => ({ ...prev, poId: e.target.value }))}
                    className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  >
                    <option value="">-- Choose PO (Optional) --</option>
                    {approvedPos
                      .filter(p => p.vendorId === editRequest.vendorId)
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.number}</option>
                      ))}
                  </select>
                </div>
              )}

              {editRequest.type === "AGAINST_BILL" && editRequest.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Select Pending GRN *</label>
                  <select
                    value={editRequest.grnId}
                    onChange={(e) => {
                      const grnId = e.target.value;
                      const selectedGrn = pendingGrns.find(g => g.id === grnId);
                      setEditRequest(prev => ({
                        ...prev,
                        grnId,
                        poId: selectedGrn ? selectedGrn.poId : "",
                        amount: selectedGrn ? selectedGrn.amount : 0
                      }));
                    }}
                    className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  >
                    <option value="">-- Choose GRN --</option>
                    {pendingGrns
                      .filter(g => g.vendorId === editRequest.vendorId)
                      .map(g => (
                        <option key={g.id} value={g.id}>
                          {g.number} (Val: ₹{g.amount.toLocaleString("en-IN")}, Due: {g.dueDate})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Amount */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Amount (INR) *</label>
                <input
                  type="number"
                  step="any"
                  value={editRequest.amount || ""}
                  onChange={(e) => setEditRequest(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  placeholder="0.00"
                  required
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Remarks / Description</label>
                <textarea
                  value={editRequest.remarks}
                  onChange={(e) => setEditRequest(prev => ({ ...prev, remarks: e.target.value }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[60px]"
                  placeholder="Enter details like banking reference or urgency details..."
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsEditReqOpen(false)}
                  className="px-4 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== EDIT PAYMENT REQUEST STATUS MODAL ==================== */}
      {isEditStatusOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-md w-full flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sliders size={18} className="text-saffron" />
                <h3 className="font-heading text-base font-bold">Update Request Status & Remarks</h3>
              </div>
              <button onClick={() => setIsEditStatusOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleUpdateStatusSubmit} className="p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded text-red-800 font-semibold">
                  {errorMsg}
                </div>
              )}

              <div className="bg-saffron/10 border border-saffron/20 rounded-lg p-3 text-[11px] text-onyx/80">
                <span className="font-bold">Request:</span> {editStatusReq.number}
              </div>

              {/* Status Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Status *</label>
                <select
                  value={editStatusReq.status}
                  onChange={(e) => setEditStatusReq(prev => ({ ...prev, status: e.target.value as any }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx"
                  required
                >
                  <option value="PENDING">Pending Approval</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Remarks *</label>
                <textarea
                  value={editStatusReq.remarks}
                  onChange={(e) => setEditStatusReq(prev => ({ ...prev, remarks: e.target.value }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[80px]"
                  placeholder="Enter approval/rejection notes or updates..."
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsEditStatusOpen(false)}
                  className="px-4 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  Update Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== CONFIRM PAYMENT MODAL ==================== */}
      {isConfirmOpen && confirmTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-md w-full flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CreditCard size={18} className="text-saffron" />
                <h3 className="font-heading text-base font-bold">Confirm Transaction Details</h3>
              </div>
              <button onClick={() => setIsConfirmOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleConfirmSubmit} className="p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded text-red-800 font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Readonly details */}
              <div className="bg-cream-dark/20 p-3 rounded-lg space-y-1.5 font-semibold text-onyx/80">
                <div className="flex justify-between">
                  <span>Vendor/Supplier:</span>
                  <span className="font-bold text-onyx">{confirmTarget.vendorName}</span>
                </div>
                <div className="flex justify-between border-t border-onyx/5 pt-1.5">
                  <span>Payment Amount:</span>
                  <span className="font-mono font-bold text-saffron-dark">
                    ₹{confirmTarget.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between border-t border-onyx/5 pt-1.5">
                  <span>Type:</span>
                  <span className="font-bold text-onyx text-[10px] uppercase">
                    {confirmTarget.type === "REQUEST" ? "Approved Request" : "Pending Advance Voucher"}
                  </span>
                </div>
              </div>

              {/* Paid On */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Payment Date *</label>
                <input
                  type="date"
                  value={confirmForm.paidOn}
                  onChange={(e) => setConfirmForm(prev => ({ ...prev, paidOn: limitYearTo4Digits(e.target.value) }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  required
                />
              </div>

              {/* Payment Mode */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Payment Mode *</label>
                <select
                  value={confirmForm.mode}
                  onChange={(e) => setConfirmForm(prev => ({ ...prev, mode: e.target.value }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                >
                  <option value="NEFT">NEFT / RTGS</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="UPI">UPI / GPay / PhonePe</option>
                  <option value="IMPS">IMPS Bank Transfer</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>

              {/* Reference */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Transaction Ref / Cheque No *</label>
                <input
                  type="text"
                  value={confirmForm.reference}
                  onChange={(e) => setConfirmForm(prev => ({ ...prev, reference: e.target.value }))}
                  placeholder="e.g. UTR1023847059 or CHQ-00123"
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsConfirmOpen(false)}
                  className="px-4 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
