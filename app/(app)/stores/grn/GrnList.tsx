"use client";

import { useState, useRef } from "react";
import { 
  createGrn, 
  postGrn,
  updateGrn,
  deleteGrn,
  bulkDeleteGrns
} from "@/app/actions/grns";
import { limitYearTo4Digits } from "@/lib/date";
import { SearchableItemSelect } from "@/components/SearchableItemSelect";
import { 
  Search, 
  Plus, 
  X, 
  FileText, 
  UploadCloud, 
  Building2, 
  Check, 
  Eye, 
  History,
  AlertTriangle,
  FolderOpen,
  Trash2,
  Edit,
  Printer,
  Download,
  CheckSquare,
  Square
} from "lucide-react";

interface GrnLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  binCode: string | null;
  binId?: string | null;
  poLineId?: string | null;
  lotNo: string | null;
  batchMfgDate?: string | null;
  batchExpiryDate?: string | null;
}

interface Grn {
  id: string;
  number: string;
  source: string;
  vendorId?: string | null;
  poId?: string | null;
  storeId?: string | null;
  vendorName: string | null;
  poNumber: string | null;
  storeName: string;
  dcNo: string | null;
  dcDate: string | null;
  invoiceNo: string | null;
  status: string;
  createdAt: string;
  lines: GrnLine[];
  rfqNumbers?: string[];
  prNumbers?: string[];
  indentNumbers?: string[];
}

interface POItem {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  status: string;
  lines: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    qty: number;
    receivedQty: number;
    rate: number;
  }>;
}

interface Item {
  id: string;
  code: string;
  name: string;
}

interface Store {
  id: string;
  name: string;
  code: string;
  bins: Array<{ id: string; code: string }>;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface GrnListProps {
  initialGrns: Grn[];
  purchaseOrders: POItem[];
  items: Item[];
  stores: Store[];
  vendors: Vendor[];
}

export default function GrnList({
  initialGrns,
  purchaseOrders,
  items,
  stores,
  vendors
}: GrnListProps) {
  const [grns, setGrns] = useState<Grn[]>(initialGrns);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modals & Panels
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedGrn, setSelectedGrn] = useState<Grn | null>(null);
  
  // Audit trail states
  const [selectedAuditGrn, setSelectedAuditGrn] = useState<Grn | null>(null);
  const [isAuditTrailOpen, setIsAuditTrailOpen] = useState(false);
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editGrnForm, setEditGrnForm] = useState<{
    id: string;
    number: string;
    source: string;
    poId: string;
    poNumber?: string | null;
    vendorId: string;
    storeId: string;
    dcNo: string;
    dcDate: string;
    invoiceNo: string;
    status: string;
    lines: Array<{
      id?: string;
      itemId: string;
      itemCode: string;
      itemName: string;
      poLineId?: string | null;
      receivedQty: number;
      binId?: string | null;
      batchLotNo?: string | null;
      batchMfgDate?: string | null;
      batchExpiryDate?: string | null;
    }>;
  } | null>(null);

  // Form States
  const [sourceType, setSourceType] = useState<"AGAINST_PO" | "WITHOUT_PO" | "FREE_SAMPLE">("AGAINST_PO");
  const [selectedPoId, setSelectedPoId] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState(stores[0]?.id || "");
  const [dcNo, setDcNo] = useState("");
  const [dcDate, setDcDate] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [manualSelectedItemId, setManualSelectedItemId] = useState("");

  const [formLines, setFormLines] = useState<Array<{
    itemId: string;
    poLineId?: string | null;
    receivedQty: number;
    binId?: string | null;
    batchLotNo?: string | null;
    batchMfgDate?: string | null;
    batchExpiryDate?: string | null;
    itemName: string;
    itemCode: string;
  }>>([]);

  // OCR Upload States
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrFeedback, setOcrFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [actionLoading, setActionLoading] = useState(false);

  const filteredGrns = grns.filter(g => {
    const matchesSearch = g.number.toLowerCase().includes(search.toLowerCase()) ||
                          (g.invoiceNo?.toLowerCase() || "").includes(search.toLowerCase()) ||
                          (g.vendorName?.toLowerCase() || "").includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || g.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Handle PO selection: load its lines automatically
  const handlePoChange = (poId: string) => {
    setSelectedPoId(poId);
    if (!poId) {
      setFormLines([]);
      return;
    }

    const po = purchaseOrders.find(p => p.id === poId);
    if (po) {
      setSelectedVendorId(po.vendorId);
      // Auto pre-populate form lines from PO line items
      const lines = po.lines.map(l => ({
        itemId: l.itemId,
        poLineId: l.id,
        receivedQty: Math.max(0, l.qty - l.receivedQty),
        binId: stores.find(s => s.id === selectedStoreId)?.bins[0]?.id || null,
        batchLotNo: "",
        batchMfgDate: "",
        batchExpiryDate: "",
        itemName: l.itemName,
        itemCode: l.itemCode,
      }));
      setFormLines(lines);
    }
  };

  // OCR image pre-fill logic
  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setOcrFeedback("Analyzing challan with Gemini vision pass...");
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/ocr/grn", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success && result.data) {
          const data = result.data;
          
          setOcrFeedback("OCR Pre-fill applied successfully! Please review fields below.");
          if (data.invoiceNo) setInvoiceNo(data.invoiceNo);
          if (data.invoiceDate) setDcDate(data.invoiceDate);
          
          // Match vendor by name
          if (data.supplierName) {
            const matchedVendor = vendors.find(v => 
              v.name.toLowerCase().includes(data.supplierName.toLowerCase())
            );
            if (matchedVendor) {
              setSelectedVendorId(matchedVendor.id);
            }
          }

          // Match PO by number
          if (data.poNo) {
            const matchedPo = purchaseOrders.find(p => 
              p.poNumber.toLowerCase().includes(data.poNo.toLowerCase())
            );
            if (matchedPo) {
              handlePoChange(matchedPo.id);
            }
          }

          // If lines are returned, update quantities
          if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
            setFormLines(prev => {
              return prev.map(line => {
                const ocrItem = data.lineItems.find((o: any) => 
                  o.itemCode === line.itemCode || 
                  (o.description && line.itemName.toLowerCase().includes(o.description.toLowerCase()))
                );
                if (ocrItem) {
                  return { ...line, receivedQty: ocrItem.quantity };
                }
                return line;
              });
            });
          }
        }
      } else {
        setOcrFeedback("OCR extraction failed. You can still fill the form manually.");
      }
    } catch (err) {
      console.error(err);
      setOcrFeedback("Error communicating with OCR service.");
    } finally {
      setOcrLoading(false);
    }
  };



  const handleCreateGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formLines.length === 0) {
      alert("No line items configured");
      return;
    }

    setActionLoading(true);
    const res = await createGrn({
      source: sourceType,
      poId: sourceType === "AGAINST_PO" ? selectedPoId : null,
      vendorId: selectedVendorId || null,
      storeId: selectedStoreId,
      dcNo: dcNo || null,
      dcDate: dcDate || null,
      invoiceNo: invoiceNo || null,
      lines: formLines,
    });
    setActionLoading(false);

    if (res.success) {
      window.location.reload();
    } else {
      alert("Failed to create GRN: " + res.error);
    }
  };

  // Selection helpers
  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    const allSelected = filteredGrns.every(g => selectedIds.includes(g.id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !filteredGrns.some(g => g.id === id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...filteredGrns.map(g => g.id)])));
    }
  };

  // Delete Individual GRN
  const handleDeleteGrn = async (id: string) => {
    const g = grns.find(item => item.id === id);
    if (!g) return;
    const warningMsg = g.status === "POSTED"
      ? "WARNING: This GRN is POSTED. Deleting it will revert stock ledger quantities, decrement linked PO received quantities, and delete any associated QC inspections or rejected material records. Are you sure you want to proceed?"
      : "Are you sure you want to delete this GRN? This will also delete any associated QC inspections.";
    
    if (!confirm(warningMsg)) return;

    setActionLoading(true);
    const res = await deleteGrn(id);
    setActionLoading(false);

    if (res.success) {
      window.location.reload();
    } else {
      alert("Failed to delete GRN: " + res.error);
    }
  };

  // Bulk Delete GRNs
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const hasPosted = grns.some(g => selectedIds.includes(g.id) && g.status === "POSTED");
    const warningMsg = hasPosted
      ? `You have selected ${selectedIds.length} GRNs, including some POSTED records. Deleting them will revert stock ledger entries, linked PO received quantities, and inspections. Are you sure you want to delete them?`
      : `Are you sure you want to delete the ${selectedIds.length} selected GRNs?`;

    if (!confirm(warningMsg)) return;

    setActionLoading(true);
    const res = await bulkDeleteGrns(selectedIds);
    setActionLoading(false);

    if (res.success) {
      setSelectedIds([]);
      window.location.reload();
    } else {
      alert("Bulk delete failed: " + res.error);
    }
  };

  // Bulk Export CSV
  const handleBulkExportCSV = () => {
    if (selectedIds.length === 0) return;
    const headers = [
      "GRN Number", 
      "Supplier", 
      "Source PO", 
      "Store", 
      "Invoice/Challan", 
      "DC No", 
      "DC Date", 
      "Invoice No", 
      "Items Count", 
      "Date Received", 
      "Status", 
      "Items Details"
    ];

    const selectedGrns = grns.filter(g => selectedIds.includes(g.id));
    const rows = selectedGrns.map(g => [
      g.number,
      g.vendorName || "Free Sample",
      g.poNumber || "-",
      g.storeName,
      g.invoiceNo ? `Inv: ${g.invoiceNo}` : `DC: ${g.dcNo || "-"}`,
      g.dcNo || "-",
      g.dcDate || "-",
      g.invoiceNo || "-",
      g.lines.length.toString(),
      new Date(g.createdAt).toLocaleDateString(),
      g.status,
      g.lines.map(l => `[${l.itemCode}] ${l.itemName}: Received=${l.receivedQty}, Accepted=${l.acceptedQty}, Bin=${l.binCode || "-"}, Lot=${l.lotNo || "-"}`).join(" | ")
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => `"${val.replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `GoodsReceiptNotes_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print GRN Voucher
  const handlePrintGrn = (grn: Grn) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker prevented printing. Please allow popups for this site.");
      return;
    }

    const printContent = `
      <div style="border: 4px double #131313; padding: 20px; font-family: sans-serif; box-sizing: border-box; width: 100%; height: 100%;">
        <div style="text-align: center; border-bottom: 2px solid #131313; padding-bottom: 10px; margin-bottom: 20px;">
          <h2 style="margin: 0; font-family: serif; text-transform: uppercase; letter-spacing: 1px;">Saarlekha Stores & Purchase</h2>
          <p style="margin: 5px 0 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #555;">Goods Receipt Note (GRN)</p>
        </div>
        
        <table style="width: 100%; margin-bottom: 20px; font-size: 12px; border-collapse: collapse;">
          <tr>
            <td style="width: 50%; padding: 4px 0;"><strong>GRN No:</strong> ${grn.number}</td>
            <td style="width: 50%; padding: 4px 0; text-align: right;"><strong>Date Received:</strong> ${new Date(grn.createdAt).toLocaleDateString()}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0;"><strong>Supplier / Vendor:</strong> ${grn.vendorName || "Free / Trial Sample"}</td>
            <td style="padding: 4px 0; text-align: right;"><strong>Source PO Ref:</strong> ${grn.poNumber || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0;"><strong>Store Warehouse:</strong> ${grn.storeName}</td>
            <td style="padding: 4px 0; text-align: right;"><strong>Status:</strong> ${grn.status}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0;"><strong>Challan (DC) No:</strong> ${grn.dcNo || "-"} (Date: ${grn.dcDate || "-"})</td>
            <td style="padding: 4px 0; text-align: right;"><strong>Supplier Invoice No:</strong> ${grn.invoiceNo || "-"}</td>
          </tr>
        </table>

        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 40px;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="border: 1px solid #131313; padding: 8px; text-align: left;">S.No</th>
              <th style="border: 1px solid #131313; padding: 8px; text-align: left;">Item Code</th>
              <th style="border: 1px solid #131313; padding: 8px; text-align: left;">Item Description</th>
              <th style="border: 1px solid #131313; padding: 8px; text-align: right;">Received Qty</th>
              <th style="border: 1px solid #131313; padding: 8px; text-align: right;">Accepted Qty</th>
              <th style="border: 1px solid #131313; padding: 8px; text-align: center;">Bin</th>
              <th style="border: 1px solid #131313; padding: 8px; text-align: center;">Batch/Lot</th>
            </tr>
          </thead>
          <tbody>
            ${grn.lines.map((l, index) => `
              <tr>
                <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${index + 1}</td>
                <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${l.itemCode}</td>
                <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${l.itemName}</td>
                <td style="border: 1px solid #131313; padding: 8px; text-align: right; font-weight: bold;">${l.receivedQty}</td>
                <td style="border: 1px solid #131313; padding: 8px; text-align: right; font-weight: bold; color: green;">${l.acceptedQty}</td>
                <td style="border: 1px solid #131313; padding: 8px; text-align: center;">${l.binCode || "-"}</td>
                <td style="border: 1px solid #131313; padding: 8px; text-align: center;">${l.lotNo || "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div style="margin-top: 60px; font-size: 12px; display: flex; justify-content: space-between;">
          <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Prepared By</div>
          <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">QC Checked By</div>
          <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Authorized Signatory</div>
        </div>
      </div>
    `;

    printWindow.document.write(`
      <html>
        <head>
          <title>GRN Voucher - ${grn.number}</title>
          <style>
            @page { size: A4; margin: 10mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: white; }
          </style>
        </head>
        <body>
          <div style="width: 170mm; height: 250mm; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; margin: auto; padding: 20px;">
            ${printContent}
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Open Edit Form
  const handleOpenEditGrn = (grn: Grn) => {
    setEditGrnForm({
      id: grn.id,
      number: grn.number,
      source: grn.source,
      poId: grn.poId || "",
      poNumber: grn.poNumber,
      vendorId: grn.vendorId || "",
      storeId: grn.storeId || "",
      dcNo: grn.dcNo || "",
      dcDate: grn.dcDate || "",
      invoiceNo: grn.invoiceNo || "",
      status: grn.status,
      lines: grn.lines.map(l => ({
        id: l.id,
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        poLineId: l.poLineId || null,
        receivedQty: l.receivedQty,
        binId: l.binId || null,
        batchLotNo: l.lotNo || "",
        batchMfgDate: l.batchMfgDate || "",
        batchExpiryDate: l.batchExpiryDate || "",
      }))
    });
    setIsEditOpen(true);
  };

  // Submit Edit Form
  const handleUpdateGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGrnForm) return;
    if (editGrnForm.lines.length === 0) {
      alert("GRN must contain at least one line item");
      return;
    }

    const warningMsg = editGrnForm.status === "POSTED"
      ? "WARNING: This GRN is POSTED. Updating it will temporarily revert and re-apply stock ledger entries and PO received quantities. Are you sure you want to proceed?"
      : "Are you sure you want to update this GRN?";

    if (!confirm(warningMsg)) return;

    setActionLoading(true);
    const res = await updateGrn(editGrnForm.id, {
      storeId: editGrnForm.storeId,
      dcNo: editGrnForm.dcNo || null,
      dcDate: editGrnForm.dcDate || null,
      invoiceNo: editGrnForm.invoiceNo || null,
      lines: editGrnForm.lines.map(l => ({
        itemId: l.itemId,
        poLineId: l.poLineId || null,
        receivedQty: l.receivedQty,
        binId: l.binId || null,
        batchLotNo: l.batchLotNo || null,
        batchMfgDate: l.batchMfgDate || null,
        batchExpiryDate: l.batchExpiryDate || null,
      }))
    });
    setActionLoading(false);

    if (res.success) {
      setIsEditOpen(false);
      window.location.reload();
    } else {
      alert("Failed to update GRN: " + res.error);
    }
  };

  const handlePostGrn = async (id: string) => {
    if (confirm("Are you sure you want to post this GRN? This updates the append-only stock ledger for accepted quantities.")) {
      setActionLoading(true);
      const res = await postGrn(id);
      setActionLoading(false);

      if (res.success) {
        window.location.reload();
      } else {
        alert("Failed to post: " + res.error);
      }
    }
  };

  const activeBins = stores.find(s => s.id === selectedStoreId)?.bins || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Goods Receipt Notes (GRN)</h2>
          <p className="text-xs text-onyx/50 mt-1">Receive inwards materials against PO, run QC routing, and post to ledger.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setFormLines([]);
              setSelectedPoId("");
              setSelectedVendorId("");
              setDcNo("");
              setInvoiceNo("");
              setOcrFeedback(null);
              setIsCreateOpen(true);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Create Inwards GRN</span>
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
            placeholder="Search by GRN number, invoice no, supplier..."
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
          <option value="DRAFT">Draft Only</option>
          <option value="QC_PENDING">QC Pending</option>
          <option value="QC_DONE">QC Done (Awaiting Post)</option>
          <option value="POSTED">Posted (Committed to Stock)</option>
        </select>
      </div>

      {/* GRN Register */}
      {/* GRN Register (Desktop View) */}
      <div className="hidden md:block glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="p-1 hover:bg-cream-dark rounded text-onyx/65 hover:text-onyx cursor-pointer"
                  >
                    {filteredGrns.length > 0 && filteredGrns.every(g => selectedIds.includes(g.id)) ? (
                      <CheckSquare size={14} className="text-saffron-dark" />
                    ) : (
                      <Square size={14} />
                    )}
                  </button>
                </th>
                <th>GRN Number</th>
                <th>Supplier</th>
                <th>Source PO</th>
                <th>Store</th>
                <th>Invoice/Challan</th>
                <th className="text-center font-bold">Items</th>
                <th>Date Received</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGrns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-onyx/40 font-medium">
                    No Goods Receipt Notes found.
                  </td>
                </tr>
              ) : (
                filteredGrns.map((g) => {
                  const isSelected = selectedIds.includes(g.id);
                  return (
                    <tr key={g.id} className={isSelected ? "bg-saffron/5" : ""}>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleSelect(g.id)}
                          className="p-1 hover:bg-cream-dark rounded text-onyx/65 hover:text-onyx cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare size={14} className="text-saffron-dark" />
                          ) : (
                            <Square size={14} />
                          )}
                        </button>
                      </td>
                      <td className="font-mono font-bold text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAuditGrn(g);
                            setIsAuditTrailOpen(true);
                          }}
                          className="hover:underline text-saffron-dark font-bold text-xs cursor-pointer text-left"
                        >
                          {g.number}
                        </button>
                      </td>
                      <td className="font-semibold">{g.vendorName || "Free Sample"}</td>
                      <td className="font-mono text-[11px] text-onyx/75">{g.poNumber || "-"}</td>
                      <td>{g.storeName}</td>
                      <td>
                        <div>
                          {g.invoiceNo && <p className="font-semibold text-xs">Inv: {g.invoiceNo}</p>}
                          {g.dcNo && <p className="text-[10px] text-onyx/50 mt-0.5">DC: {g.dcNo}</p>}
                        </div>
                      </td>
                      <td className="text-center font-semibold">{g.lines.length} items</td>
                      <td suppressHydrationWarning>{new Date(g.createdAt).toLocaleDateString()}</td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          g.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                          g.status === "QC_PENDING" ? "bg-amber-100 text-amber-800 animate-pulse" :
                          g.status === "QC_DONE" ? "bg-yellow-100 text-yellow-800" :
                          g.status === "POSTED" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        }`}>
                          {g.status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedGrn(g);
                              setIsDetailOpen(true);
                            }}
                            title="View Detail"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                          >
                            <Eye size={13} />
                          </button>

                          <button
                            onClick={() => handleOpenEditGrn(g)}
                            title="Edit GRN"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                          >
                            <Edit size={13} />
                          </button>

                          <button
                            onClick={() => handleDeleteGrn(g.id)}
                            disabled={actionLoading}
                            title="Delete GRN"
                            className="p-1 hover:bg-red-50 border border-transparent hover:border-red-200 rounded text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 size={13} />
                          </button>

                          <button
                            onClick={() => handlePrintGrn(g)}
                            title="Print GRN Voucher"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                          >
                            <Printer size={13} />
                          </button>

                          {["DRAFT", "QC_DONE"].includes(g.status) && (
                            <button
                              onClick={() => handlePostGrn(g.id)}
                              disabled={actionLoading}
                              title="Commit & Post Stock"
                              className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer disabled:opacity-50"
                            >
                              <Check size={13} />
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

      {/* Mobile Card List View */}
      <div className="md:hidden space-y-4">
        {filteredGrns.length === 0 ? (
          <div className="glass-card p-6 text-center text-onyx/40 font-medium border border-onyx/5 rounded-xl">
            No Goods Receipt Notes found.
          </div>
        ) : (
          filteredGrns.map((g) => {
            const isSelected = selectedIds.includes(g.id);
            return (
              <div
                key={g.id}
                className={`glass-card p-4 rounded-xl border transition-all duration-150 ${
                  isSelected ? "border-saffron bg-saffron/5" : "border-onyx/5 bg-cream"
                }`}
              >
                <div className="flex items-center justify-between border-b border-onyx/5 pb-2">
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(g.id)}
                      className="p-1 hover:bg-cream-dark rounded text-onyx/65 hover:text-onyx cursor-pointer"
                    >
                      {isSelected ? (
                        <CheckSquare size={14} className="text-saffron-dark" />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>
                    <span className="font-mono font-bold text-xs text-onyx/85">{g.number}</span>
                  </div>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                    g.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                    g.status === "QC_PENDING" ? "bg-amber-100 text-amber-800 animate-pulse" :
                    g.status === "QC_DONE" ? "bg-yellow-100 text-yellow-800" :
                    g.status === "POSTED" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                  }`}>
                    {g.status}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-onyx/70">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Supplier</span>
                    <span className="font-semibold text-onyx">{g.vendorName || "Free Sample"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Source PO</span>
                      <span className="font-mono text-onyx">{g.poNumber || "-"}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Store</span>
                      <span className="font-semibold text-onyx">{g.storeName}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Invoice/Challan</span>
                      <div>
                        {g.invoiceNo && <p className="font-semibold text-xs">Inv: {g.invoiceNo}</p>}
                        {g.dcNo && <p className="text-[9px] text-onyx/50 mt-0.5">DC: {g.dcNo}</p>}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Items</span>
                      <span className="font-semibold text-onyx">{g.lines.length} items</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Date Received</span>
                    <span className="font-semibold text-onyx" suppressHydrationWarning>
                      {new Date(g.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-onyx/5">
                  <button
                    onClick={() => {
                      setSelectedGrn(g);
                      setIsDetailOpen(true);
                    }}
                    title="View Detail"
                    className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => handleOpenEditGrn(g)}
                    title="Edit GRN"
                    className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteGrn(g.id)}
                    disabled={actionLoading}
                    title="Delete GRN"
                    className="p-1.5 hover:bg-red-50 border border-transparent hover:border-red-200 rounded text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50 inline-flex"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    onClick={() => handlePrintGrn(g)}
                    title="Print GRN Voucher"
                    className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                  >
                    <Printer size={14} />
                  </button>
                  {["DRAFT", "QC_DONE"].includes(g.status) && (
                    <button
                      onClick={() => handlePostGrn(g.id)}
                      disabled={actionLoading}
                      title="Commit & Post Stock"
                      className="p-1.5 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer disabled:opacity-50 inline-flex font-bold"
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create GRN Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-4xl w-full max-h-[95vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">New Goods Receipt Inwards (GRN)</h3>
              <button onClick={() => setIsCreateOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateGrn} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Scan-First OCR Zone */}
              <div className="border border-dashed border-onyx/10 p-5 rounded-xl bg-cream-dark/15 flex flex-col items-center justify-center text-center space-y-2 transition-all duration-200 hover:bg-saffron/5">
                <UploadCloud size={32} className="text-saffron-dark" />
                <div>
                  <p className="text-xs font-bold text-onyx">Scan-First OCR Challan Import</p>
                  <p className="text-[10px] text-onyx/40 mt-0.5">Upload delivery challan or supplier invoice. Gemini extracts details instantly.</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleOcrUpload} 
                  accept="image/*,application/pdf" 
                  className="hidden" 
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="px-3.5 py-1.5 bg-white border border-onyx/10 rounded-lg text-[10px] font-bold text-onyx shadow-sm hover:bg-cream-dark cursor-pointer disabled:opacity-50"
                >
                  {ocrLoading ? "Analyzing file..." : "Choose File or Scan"}
                </button>
                {ocrFeedback && (
                  <p className="text-[10px] font-semibold text-saffron-dark">{ocrFeedback}</p>
                )}
              </div>

              {/* Source parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Inwards Source *
                  </label>
                  <select
                    value={sourceType}
                    onChange={(e) => {
                      const val = e.target.value as any;
                      setSourceType(val);
                      setFormLines([]);
                      setSelectedPoId("");
                      setSelectedVendorId("");
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  >
                    <option value="AGAINST_PO">Against Purchase Order</option>
                    <option value="WITHOUT_PO">Without Purchase Order</option>
                    <option value="FREE_SAMPLE">Free Sample / Trial</option>
                  </select>
                </div>

                {sourceType === "AGAINST_PO" ? (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                      Purchase Order *
                    </label>
                    <select
                      value={selectedPoId}
                      onChange={(e) => handlePoChange(e.target.value)}
                      className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                      required
                    >
                      <option value="">Select Active PO</option>
                      {purchaseOrders
                        .filter(po => ["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(po.status))
                        .map(po => (
                          <option key={po.id} value={po.id}>{po.poNumber} — {po.vendorName}</option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                      Supplier *
                    </label>
                    <select
                      value={selectedVendorId}
                      onChange={(e) => setSelectedVendorId(e.target.value)}
                      className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                      required
                    >
                      <option value="">Select Supplier</option>
                      {vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Store Warehouse *
                  </label>
                  <select
                    value={selectedStoreId}
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                    required
                  >
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DC / Invoice numbers */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Challan (DC) No
                  </label>
                  <input
                    type="text"
                    value={dcNo}
                    onChange={(e) => setDcNo(e.target.value)}
                    placeholder="e.g. DC-10294"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Receipt Date *
                  </label>
                  <input
                    type="date"
                    value={dcDate}
                    onChange={(e) => setDcDate(limitYearTo4Digits(e.target.value))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Supplier Invoice No
                  </label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="e.g. GST-90184"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
              </div>

              {/* GRN Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                    Receipt Line Items
                  </label>
                </div>

                {sourceType !== "AGAINST_PO" && (
                  <div className="flex items-end gap-3 p-3 bg-cream-dark/15 rounded-lg border border-onyx/5">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                        Select Item to Add *
                      </label>
                      <SearchableItemSelect
                        items={items}
                        value={manualSelectedItemId}
                        onChange={(val) => setManualSelectedItemId(val)}
                        placeholder="Search and select item..."
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!manualSelectedItemId) return;
                        const item = items.find(i => i.id === manualSelectedItemId);
                        if (!item) return;
                        if (formLines.some(l => l.itemId === item.id)) {
                          alert("Item already added to receipt lines.");
                          return;
                        }
                        const firstBin = stores.find(s => s.id === selectedStoreId)?.bins[0]?.id || null;
                        setFormLines(prev => [
                          ...prev,
                          {
                            itemId: item.id,
                            poLineId: null,
                            receivedQty: 1,
                            binId: firstBin,
                            batchLotNo: "",
                            batchMfgDate: "",
                            batchExpiryDate: "",
                            itemName: item.name,
                            itemCode: item.code,
                          }
                        ]);
                        setManualSelectedItemId("");
                      }}
                      className="px-4 py-2 bg-onyx text-cream-light hover:bg-onyx-light rounded-lg text-xs font-bold shadow-md cursor-pointer transition-colors duration-150 shrink-0 h-[34px] flex items-center justify-center"
                    >
                      Add Item
                    </button>
                  </div>
                )}

                {formLines.length === 0 ? (
                  <p className="text-center py-6 bg-white border border-dashed border-onyx/10 text-xs text-onyx/40 font-medium rounded-lg">
                    {sourceType === "AGAINST_PO" 
                      ? "Select a purchase order to populate lines." 
                      : "Add items manually using the selector above."}
                  </p>
                ) : (
                  <div className="border border-onyx/5 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse bg-white min-w-[700px]">
                      <thead className="bg-cream-dark/50">
                        <tr>
                          <th className="p-2.5 font-bold">Item Description</th>
                          <th className="p-2.5 font-bold text-center w-28">Received Qty</th>
                          <th className="p-2.5 font-bold w-28">Bin</th>
                          <th className="p-2.5 font-bold w-32">Lot Number</th>
                          <th className="p-2.5 font-bold w-32">Mfg Date</th>
                          <th className="p-2.5 font-bold w-32">Expiry Date</th>
                          {sourceType !== "AGAINST_PO" && <th className="p-2.5 font-bold w-12 text-center"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {formLines.map((line, idx) => (
                          <tr key={idx} className="border-t border-onyx/5">
                            <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                step="any"
                                value={line.receivedQty}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, receivedQty: val } : l));
                                }}
                                className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono font-bold"
                              />
                            </td>
                            <td className="p-2.5">
                              <select
                                value={line.binId || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, binId: val || null } : l));
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded"
                              >
                                <option value="">No Bin</option>
                                {activeBins.map(b => (
                                  <option key={b.id} value={b.id}>{b.code}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2.5">
                              <input
                                type="text"
                                value={line.batchLotNo || ""}
                                placeholder="Lot/Batch"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, batchLotNo: val || null } : l));
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded font-mono"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="date"
                                value={line.batchMfgDate || ""}
                                onChange={(e) => {
                                  const val = limitYearTo4Digits(e.target.value);
                                  setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, batchMfgDate: val || null } : l));
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="date"
                                value={line.batchExpiryDate || ""}
                                onChange={(e) => {
                                  const val = limitYearTo4Digits(e.target.value);
                                  setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, batchExpiryDate: val || null } : l));
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded"
                              />
                            </td>
                            {sourceType !== "AGAINST_PO" && (
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFormLines(prev => prev.filter((_, i) => i !== idx));
                                  }}
                                  className="text-red-500 hover:text-red-700 cursor-pointer p-1 rounded hover:bg-red-50 border border-transparent hover:border-red-200"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || formLines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving GRN..." : "Save GRN Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details Side Drawer */}
      {isDetailOpen && selectedGrn && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedGrn.number}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                Goods Receipt Inwards Detail
              </h3>
              <p className="text-xs text-onyx/50">Warehouse: {selectedGrn.storeName}</p>
            </div>

            {/* Inwards Metadata */}
            <div className="py-4 grid grid-cols-2 gap-4 text-xs border-b border-onyx/5 bg-cream-dark/20 p-3 rounded-lg mt-4">
              <div>
                <span className="font-semibold text-onyx/50">Supplier / Vendor:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedGrn.vendorName || "Free / Trial Sample"}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">PO Reference:</span>
                <p className="font-mono font-bold text-onyx mt-0.5">{selectedGrn.poNumber || "N/A"}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Challan / Invoice No:</span>
                <p className="font-bold text-onyx mt-0.5">
                  {selectedGrn.invoiceNo ? `Inv: ${selectedGrn.invoiceNo}` : `DC: ${selectedGrn.dcNo || "N/A"}`}
                </p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Inwards Status:</span>
                <p className="font-bold text-onyx mt-0.5 uppercase">{selectedGrn.status}</p>
              </div>
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto py-6 space-y-4">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                Received Line Items
              </h4>

              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50">
                    <tr>
                      <th className="p-2 font-bold">Item Description</th>
                      <th className="p-2 font-bold text-right">Received</th>
                      <th className="p-2 font-bold text-right">Accepted</th>
                      <th className="p-2 font-bold text-center">Batch/Lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGrn.lines.map((line) => (
                      <tr key={line.id} className="border-t border-onyx/5">
                        <td className="p-2">[{line.itemCode}] {line.itemName}</td>
                        <td className="p-2 text-right font-mono font-bold text-onyx/70">{line.receivedQty}</td>
                        <td className="p-2 text-right font-mono font-bold text-green-700">{line.acceptedQty}</td>
                        <td className="p-2 text-center font-mono text-[10px]">{line.lotNo || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

      {/* Edit GRN Modal */}
      {isEditOpen && editGrnForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-4xl w-full max-h-[95vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div>
                <h3 className="font-heading text-lg font-bold">Edit Goods Receipt Note</h3>
                <p className="text-[11px] text-cream-light/60 mt-0.5">Editing {editGrnForm.number} ({editGrnForm.status})</p>
              </div>
              <button onClick={() => setIsEditOpen(false)} className="hover:text-saffron cursor-pointer text-cream-light">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpdateGrn} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Warnings for POSTED status */}
              {editGrnForm.status === "POSTED" && (
                <div className="p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-lg flex items-start space-x-2.5 text-xs">
                  <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={16} />
                  <div>
                    <span className="font-bold">Important Notice:</span>
                    <p className="mt-0.5 text-[11px] opacity-90">
                      This GRN has been committed to the stock ledger. Editing it will revert the previous stock ledger receipt logs, recalculate received counts on linked PO lines, and re-commit the new quantities.
                    </p>
                  </div>
                </div>
              )}

              {/* Source parameters (Read-only reference) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Inwards Source
                  </label>
                  <input
                    type="text"
                    disabled
                    value={
                      editGrnForm.source === "AGAINST_PO" ? "Against Purchase Order" :
                      editGrnForm.source === "WITHOUT_PO" ? "Without Purchase Order" :
                      "Free Sample / Trial"
                    }
                    className="w-full text-xs p-2 bg-cream-dark/20 border border-onyx/10 rounded-lg text-onyx/50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    {editGrnForm.source === "AGAINST_PO" ? "Purchase Order" : "Supplier"}
                  </label>
                  <input
                    type="text"
                    disabled
                    value={
                      editGrnForm.source === "AGAINST_PO"
                        ? editGrnForm.poNumber || purchaseOrders.find(p => p.id === editGrnForm.poId)?.poNumber || editGrnForm.poId
                        : vendors.find(v => v.id === editGrnForm.vendorId)?.name || editGrnForm.vendorId
                    }
                    className="w-full text-xs p-2 bg-cream-dark/20 border border-onyx/10 rounded-lg text-onyx/50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Store Warehouse *
                  </label>
                  <select
                    value={editGrnForm.storeId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditGrnForm(prev => {
                        if (!prev) return null;
                        const newStore = stores.find(s => s.id === val);
                        const defaultBin = newStore?.bins[0]?.id || null;
                        return {
                          ...prev,
                          storeId: val,
                          lines: prev.lines.map(l => ({ ...l, binId: defaultBin }))
                        };
                      });
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  >
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DC / Invoice numbers */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Challan (DC) No
                  </label>
                  <input
                    type="text"
                    value={editGrnForm.dcNo}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditGrnForm(prev => prev ? { ...prev, dcNo: val } : null);
                    }}
                    placeholder="e.g. DC-10294"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Receipt Date *
                  </label>
                  <input
                    type="date"
                    value={editGrnForm.dcDate}
                    onChange={(e) => {
                      const val = limitYearTo4Digits(e.target.value);
                      setEditGrnForm(prev => prev ? { ...prev, dcDate: val } : null);
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Supplier Invoice No
                  </label>
                  <input
                    type="text"
                    value={editGrnForm.invoiceNo}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditGrnForm(prev => prev ? { ...prev, invoiceNo: val } : null);
                    }}
                    placeholder="e.g. GST-90184"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
              </div>

              {/* GRN Line Items */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Receipt Line Items
                </label>

                <div className="border border-onyx/5 rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse bg-white min-w-[700px]">
                    <thead className="bg-cream-dark/50 font-bold">
                      <tr>
                        <th className="p-2.5">Item Description</th>
                        <th className="p-2.5 text-center w-28">Received Qty</th>
                        <th className="p-2.5 w-28">Bin</th>
                        <th className="p-2.5 w-32">Lot Number</th>
                        <th className="p-2.5 w-32">Mfg Date</th>
                        <th className="p-2.5 w-32">Expiry Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editGrnForm.lines.map((line, idx) => {
                        const editActiveBins = stores.find(s => s.id === editGrnForm.storeId)?.bins || [];
                        return (
                          <tr key={idx} className="border-t border-onyx/5">
                            <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                step="any"
                                value={line.receivedQty}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditGrnForm(prev => {
                                    if (!prev) return null;
                                    const updatedLines = [...prev.lines];
                                    updatedLines[idx] = { ...updatedLines[idx], receivedQty: val };
                                    return { ...prev, lines: updatedLines };
                                  });
                                }}
                                className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono font-bold focus:outline-none focus:border-saffron"
                              />
                            </td>
                            <td className="p-2.5">
                              <select
                                value={line.binId || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditGrnForm(prev => {
                                    if (!prev) return null;
                                    const updatedLines = [...prev.lines];
                                    updatedLines[idx] = { ...updatedLines[idx], binId: val || null };
                                    return { ...prev, lines: updatedLines };
                                  });
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded focus:outline-none focus:border-saffron"
                              >
                                <option value="">No Bin</option>
                                {editActiveBins.map(b => (
                                  <option key={b.id} value={b.id}>{b.code}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2.5">
                              <input
                                type="text"
                                value={line.batchLotNo || ""}
                                placeholder="Lot/Batch"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditGrnForm(prev => {
                                    if (!prev) return null;
                                    const updatedLines = [...prev.lines];
                                    updatedLines[idx] = { ...updatedLines[idx], batchLotNo: val || null };
                                    return { ...prev, lines: updatedLines };
                                  });
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded font-mono focus:outline-none focus:border-saffron"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="date"
                                value={line.batchMfgDate || ""}
                                onChange={(e) => {
                                  const val = limitYearTo4Digits(e.target.value);
                                  setEditGrnForm(prev => {
                                    if (!prev) return null;
                                    const updatedLines = [...prev.lines];
                                    updatedLines[idx] = { ...updatedLines[idx], batchMfgDate: val || null };
                                    return { ...prev, lines: updatedLines };
                                  });
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded focus:outline-none focus:border-saffron"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="date"
                                value={line.batchExpiryDate || ""}
                                onChange={(e) => {
                                  const val = limitYearTo4Digits(e.target.value);
                                  setEditGrnForm(prev => {
                                    if (!prev) return null;
                                    const updatedLines = [...prev.lines];
                                    updatedLines[idx] = { ...updatedLines[idx], batchExpiryDate: val || null };
                                    return { ...prev, lines: updatedLines };
                                  });
                                }}
                                className="w-full text-[11px] p-1 border border-onyx/15 rounded focus:outline-none focus:border-saffron"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Footer */}
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
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Updating GRN..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-onyx/90 text-cream backdrop-blur-md px-6 py-3.5 rounded-full shadow-2xl border border-white/10 flex items-center space-x-6 z-40 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <span className="text-xs font-bold tracking-wider">
            {selectedIds.length} GRN{selectedIds.length > 1 ? "s" : ""} selected
          </span>
          <div className="h-4 w-px bg-white/20" />
          <div className="flex items-center space-x-2.5">
            <button
              onClick={handleBulkExportCSV}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-full text-[11px] font-bold transition duration-150 cursor-pointer animate-none"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={actionLoading}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full text-[11px] font-bold transition duration-150 cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={13} />
              <span>Bulk Delete</span>
            </button>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <button
            onClick={() => setSelectedIds([])}
            className="p-1 hover:bg-white/10 rounded-full transition duration-150 cursor-pointer"
            title="Clear Selection"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ==================== AUDIT TRAIL MODAL ==================== */}
      {isAuditTrailOpen && selectedAuditGrn && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-md w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-sm font-bold uppercase tracking-wider">Document Audit Trail ({selectedAuditGrn.number})</h3>
              <button onClick={() => {
                setIsAuditTrailOpen(false);
                setSelectedAuditGrn(null);
              }} className="hover:text-saffron cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <p className="text-xs text-onyx/60">
                Below is the upstream procurement and sourcing document history linked to this Goods Receipt Note.
              </p>

              {/* Timeline layout */}
              <div className="relative pl-6 space-y-6 before:absolute before:bottom-2 before:top-2 before:left-2.5 before:w-0.5 before:bg-onyx/10">
                
                {/* 1. Indents */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-cream border-2 border-onyx/20 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-onyx/40" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-onyx/50 uppercase tracking-wider text-[10px]">1. Purchase Indent(s)</h4>
                    {selectedAuditGrn.indentNumbers && selectedAuditGrn.indentNumbers.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {selectedAuditGrn.indentNumbers.map((num) => (
                          <span key={num} className="font-mono text-xs font-bold bg-cream-dark px-2 py-0.5 rounded text-onyx">
                            {num}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-onyx/40 mt-0.5 italic">No Indents linked (Direct PR/PO)</p>
                    )}
                  </div>
                </div>

                {/* 2. PRs */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-cream border-2 border-onyx/20 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-onyx/40" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-onyx/50 uppercase tracking-wider text-[10px]">2. Purchase Requisition(s)</h4>
                    {selectedAuditGrn.prNumbers && selectedAuditGrn.prNumbers.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {selectedAuditGrn.prNumbers.map((num) => (
                          <span key={num} className="font-mono text-xs font-bold bg-cream-dark px-2 py-0.5 rounded text-onyx">
                            {num}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-onyx/40 mt-0.5 italic">No PRs linked (Direct PO)</p>
                    )}
                  </div>
                </div>

                {/* 3. RFQs */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-cream border-2 border-onyx/20 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-onyx/40" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-onyx/50 uppercase tracking-wider text-[10px]">3. Request For Quote(s)</h4>
                    {selectedAuditGrn.rfqNumbers && selectedAuditGrn.rfqNumbers.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {selectedAuditGrn.rfqNumbers.map((num) => (
                          <span key={num} className="font-mono text-xs font-bold bg-cream-dark px-2 py-0.5 rounded text-onyx">
                            {num}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-onyx/40 mt-0.5 italic">No RFQs linked (Direct PO without bidding)</p>
                    )}
                  </div>
                </div>

                {/* 4. PO */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-cream border-2 border-onyx/20 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-onyx/40" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-onyx/50 uppercase tracking-wider text-[10px]">4. Purchase Order</h4>
                    {selectedAuditGrn.poNumber ? (
                      <div className="mt-1">
                        <span className="font-mono text-xs font-bold bg-saffron/20 border border-saffron/30 px-2 py-0.5 rounded text-onyx">
                          {selectedAuditGrn.poNumber}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-onyx/40 mt-0.5 italic">Direct Receipt without PO</p>
                    )}
                  </div>
                </div>

                {/* 5. GRN */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-saffron border-2 border-saffron-dark flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-onyx" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-saffron-dark uppercase tracking-wider text-[10px]">5. Goods Receipt Note (GRN)</h4>
                    <div className="mt-1">
                      <span className="font-mono text-xs font-bold bg-saffron px-2.5 py-1 rounded text-onyx shadow-sm">
                        {selectedAuditGrn.number}
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <div className="px-6 py-4 bg-cream-dark/30 border-t border-onyx/10 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsAuditTrailOpen(false);
                  setSelectedAuditGrn(null);
                }}
                className="px-4 py-2 bg-onyx hover:bg-onyx-light text-cream-light font-bold rounded-lg text-xs cursor-pointer"
              >
                Close Audit Trail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
