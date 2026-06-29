"use client";

import { useState, useEffect } from "react";
import { 
  createPR, 
  approvePR, 
  rejectPR,
  createRFQ, 
  submitQuotation, 
  awardQuotation,
  updateQuotation,
  deleteQuotation
} from "@/app/actions/requisitions";
import { limitYearTo4Digits } from "@/lib/date";
import { SearchableItemSelect } from "@/components/SearchableItemSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { 
  Search, 
  Plus, 
  X, 
  Trash2, 
  Check, 
  RefreshCw, 
  Eye, 
  DollarSign, 
  ClipboardList, 
  FileText,
  Building2,
  AlertCircle,
  Award,
  ArrowRight,
  TrendingDown,
  Percent,
  ShieldCheck,
  Info,
  Edit
} from "lucide-react";
import { useRouter } from "next/navigation";

interface PRLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  requiredBy: string | null;
  orderedQty?: number;
  shortClosedQty?: number;
  status?: string;
}

interface PRRecord {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  remarks: string | null;
  lines: PRLine[];
  indentNumbers?: string[];
}

interface RFQLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  awardedQuotationLineId?: string | null;
  awardedQty?: number;
  status?: string;
}

interface QuotationLine {
  id: string;
  itemId: string;
  rate: number;
  discount: number;
  gstRate: number;
  rfqLineId?: string | null;
  canSupply?: boolean;
  quotedQty?: number | null;
  leadDays?: number | null;
  landedUnit?: number | null;
  rank?: number | null;
}

interface QuotationRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  leadDays: number | null;
  terms: string | null;
  paymentTerms: string | null;
  freight: number;
  packingCharges: number;
  awarded: boolean;
  lines: QuotationLine[];
}

interface RFQRecord {
  id: string;
  number: string;
  prId: string | null;
  prNumber: string | null;
  status: string;
  createdAt: string;
  lines: RFQLine[];
  quotations: QuotationRecord[];
}

interface Item {
  id: string;
  code: string;
  name: string;
  baseUom: string;
  moq?: number;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
  minOrderValue?: number;
}

interface ShipToLocationRecord {
  id: string;
  code: string;
  name: string;
  address: string;
  gstin: string | null;
}

import { can, SessionUser } from "@/lib/rbac";

interface RequisitionsListProps {
  prs: PRRecord[];
  rfqs: RFQRecord[];
  items: Item[];
  vendors: Vendor[];
  userRole: string;
  user: SessionUser;
  shipToLocations: ShipToLocationRecord[];
  presets?: any[];
}

export default function RequisitionsList({
  prs,
  rfqs,
  items,
  vendors,
  userRole,
  user,
  shipToLocations,
  presets = []
}: RequisitionsListProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"pr" | "rfq">("pr");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const savedTab = sessionStorage.getItem("requisitions_active_tab");
    if (savedTab === "pr" || savedTab === "rfq") {
      setActiveTab(savedTab);
    }
  }, []);

  const handleTabChange = (tab: "pr" | "rfq") => {
    setActiveTab(tab);
    setSearch("");
    sessionStorage.setItem("requisitions_active_tab", tab);
  };

  // Modals/Drawers
  const [isPrOpen, setIsPrOpen] = useState(false);
  const [isRfqOpen, setIsRfqOpen] = useState(false);
  const [isQuoteOpen, setIsQuoteOpen] = useState(false);
  const [isCompOpen, setIsCompOpen] = useState(false);
  const [lineAwards, setLineAwards] = useState<{ [rfqLineId: string]: string }>({});
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [isRejectPrOpen, setIsRejectPrOpen] = useState(false);
  const [rejectPrId, setRejectPrId] = useState<string | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState("");

  const [isPoDetailsModalOpen, setIsPoDetailsModalOpen] = useState(false);
  const [poPreflightDetails, setPoPreflightDetails] = useState(() => {
    const defaultPreset = presets?.find(p => p.isDefault && p.appliesTo.includes("REGULAR"));
    return {
      paymentTerms: "Net 30",
      freightTerms: "FOB Destination",
      shipTo: shipToLocations.length > 0 ? `${shipToLocations[0].name} (${shipToLocations[0].address})` : "Main Warehouse Gate 1",
      termsConditions: "1. Deliveries must be made within the specified timeframe.\n2. QC inspection approval is mandatory prior to store receipt.\n3. Defective items will be rejected and returned at vendor expense.",
      termsPresetId: defaultPreset ? defaultPreset.id : ""
    };
  });

  const [selectedPr, setSelectedPr] = useState<PRRecord | null>(null);
  const [selectedRfq, setSelectedRfq] = useState<RFQRecord | null>(null);

  // Form states
  const [newPr, setNewPr] = useState({
    lines: [] as { itemId: string; qty: number; requiredBy: string }[]
  });
  const [newPrLine, setNewPrLine] = useState({ itemId: "", qty: 1, requiredBy: "" });

  const [newRfq, setNewRfq] = useState({
    prId: "",
    lines: [] as { itemId: string; qty: number }[]
  });

  const [newQuote, setNewQuote] = useState({
    vendorId: "",
    leadDays: 5,
    terms: "FOB Destination",
    paymentTerms: "",
    freight: 0,
    packingCharges: 0,
    lines: [] as {
      id?: string;
      rfqLineId?: string | null;
      itemId: string;
      rate: number;
      discount: number;
      gstRate: number;
      canSupply: boolean;
      quotedQty: number | null;
      leadDays: number | null;
      brand?: string | null;
    }[]
  });

  // Comparison & Split Award Allocation State
  const [compData, setCompData] = useState<{
    rfq: any;
    allocations: any[];
    proposedAllocations: any[];
  } | null>(null);

  const [allocState, setAllocState] = useState<{
    [rfqLineId: string]: {
      quotationLineId: string;
      qty: number;
      reason: string;
      note: string;
      vendorId: string;
      vendorName: string;
    }[];
  }>({});

  // Short-close states
  const [isShortCloseOpen, setIsShortCloseOpen] = useState(false);
  const [shortCloseLineId, setShortCloseLineId] = useState<string | null>(null);
  const [shortCloseLineName, setShortCloseLineName] = useState("");
  const [shortCloseMaxQty, setShortCloseMaxQty] = useState(0);
  const [shortCloseQty, setShortCloseQty] = useState(0);
  const [shortCloseReason, setShortCloseReason] = useState("SUPPLIER_UNAVAILABLE");
  const [shortCloseNote, setShortCloseNote] = useState("");

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canApprove = ["PURCHASE_MANAGER", "ADMIN", "OWNER"].includes(userRole);
  const isPurchase = ["PURCHASE_OFFICER", "PURCHASE_MANAGER", "ADMIN", "OWNER"].includes(userRole);
  const canManageRfq = can(user, "rfq.manage");
  const canAwardRfq = can(user, "rfq.award");

  const filteredPrs = prs.filter(p => 
    p.number.toLowerCase().includes(search.toLowerCase()) ||
    (p.approvedBy?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const filteredRfqs = rfqs.filter(r => 
    r.number.toLowerCase().includes(search.toLowerCase()) ||
    (r.prNumber?.toLowerCase() || "").includes(search.toLowerCase())
  );

  // Landed Cost Formula: Rate * (1 - Discount%) * (1 + GST%)
  const calculateLandedCost = (rate: number, discount: number, gstRate: number) => {
    const discounted = rate * (1 - discount / 100);
    return discounted * (1 + gstRate / 100);
  };

  // Find lowest quotation per item/line
  const getLowestQuotation = (rfq: RFQRecord, rfqLineId: string, itemId: string) => {
    let lowestCost = Infinity;
    let lowestQuote: QuotationRecord | null = null;
    let lowestLine: QuotationLine | null = null;

    for (const q of rfq.quotations) {
      const line = q.lines.find(l => l.rfqLineId === rfqLineId || (!l.rfqLineId && l.itemId === itemId));
      if (line) {
        const cost = calculateLandedCost(line.rate, line.discount, line.gstRate);
        if (cost < lowestCost) {
          lowestCost = cost;
          lowestQuote = q;
          lowestLine = line;
        }
      }
    }

    return { cost: lowestCost === Infinity ? null : lowestCost, quote: lowestQuote, line: lowestLine };
  };

  const handleAddPrLine = () => {
    if (!newPrLine.itemId) return;
    setNewPr(prev => ({
      ...prev,
      lines: [...prev.lines, { itemId: newPrLine.itemId, qty: newPrLine.qty, requiredBy: newPrLine.requiredBy }]
    }));
    setNewPrLine({ itemId: "", qty: 1, requiredBy: "" });
  };

  const handleCreatePr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPr.lines.length === 0) {
      alert("Please add at least one item");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    const res = await createPR(newPr);
    setActionLoading(false);

    if (res.success) {
      setIsPrOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to create PR");
    }
  };

  const handleApprovePr = async (id: string) => {
    setActionLoading(true);
    const res = await approvePR(id);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert("Failed to approve: " + res.error);
    }
  };

  const handleRejectPrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectPrId || !rejectRemarks.trim()) return;

    setActionLoading(true);
    setErrorMsg(null);
    const res = await rejectPR(rejectPrId, rejectRemarks);
    setActionLoading(false);

    if (res.success) {
      setIsRejectPrOpen(false);
      setRejectPrId(null);
      setRejectRemarks("");
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to reject PR");
    }
  };

  const handleOpenRfq = (pr: PRRecord) => {
    setSelectedPr(pr);
    const eligibleLines = pr.lines.filter(l => {
      const openQty = l.qty - (l.orderedQty || 0) - (l.shortClosedQty || 0);
      return openQty > 0;
    });
    setNewRfq({
      prId: pr.id,
      lines: eligibleLines.map(l => ({
        itemId: l.itemId,
        qty: l.qty - (l.orderedQty || 0) - (l.shortClosedQty || 0)
      }))
    });
    setIsRfqOpen(true);
  };

  const handleCreateRfq = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);
    const res = await createRFQ(newRfq);
    setActionLoading(false);

    if (res.success) {
      setIsRfqOpen(false);
      sessionStorage.setItem("requisitions_active_tab", "rfq");
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to create RFQ");
    }
  };

  const handleOpenQuote = (rfq: RFQRecord) => {
    setSelectedRfq(rfq);
    setEditingQuotationId(null);
    setNewQuote({
      vendorId: "",
      leadDays: 5,
      terms: "FOB Destination",
      paymentTerms: "",
      freight: 0,
      packingCharges: 0,
      lines: rfq.lines.map(l => ({
        id: undefined,
        rfqLineId: l.id,
        itemId: l.itemId,
        rate: 0,
        discount: 0,
        gstRate: 18,
        canSupply: true,
        quotedQty: l.qty,
        leadDays: 5,
        brand: "",
      }))
    });
    setIsQuoteOpen(true);
  };

  const handleEditQuoteClick = (rfq: RFQRecord, quote: any) => {
    setSelectedRfq(rfq);
    setEditingQuotationId(quote.id);
    setNewQuote({
      vendorId: quote.vendorId,
      leadDays: quote.leadDays ?? 5,
      terms: quote.terms ?? "FOB Destination",
      paymentTerms: quote.paymentTerms ?? "",
      freight: quote.freight ?? 0,
      packingCharges: quote.packingCharges ?? 0,
      lines: rfq.lines.map(l => {
        const qLine = quote.lines.find((ql: any) => ql.rfqLineId === l.id);
        return {
          id: qLine?.id,
          rfqLineId: l.id,
          itemId: l.itemId,
          rate: qLine ? qLine.rate : 0,
          discount: qLine ? qLine.discount : 0,
          gstRate: qLine ? qLine.gstRate : 18,
          canSupply: qLine ? qLine.canSupply : false,
          quotedQty: qLine ? (qLine.quotedQty ?? l.qty) : l.qty,
          leadDays: qLine ? (qLine.leadDays ?? 5) : 5,
          brand: qLine ? (qLine.brand ?? "") : "",
        };
      })
    });
    setIsQuoteOpen(true);
  };

  const handleDeleteQuote = async (id: string) => {
    if (!confirm("Are you sure you want to delete this quotation? This action cannot be undone.")) {
      return;
    }
    setActionLoading(true);
    const res = await deleteQuotation(id);
    setActionLoading(false);
    if (res.success) {
      setIsCompOpen(false);
      setIsDetailOpen(false);
      sessionStorage.setItem("requisitions_active_tab", "rfq");
      window.location.reload();
    } else {
      alert("Failed to delete quotation: " + res.error);
    }
  };

  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuote.vendorId) {
      alert("Please select a vendor");
      return;
    }
 
    setActionLoading(true);
    setErrorMsg(null);
 
    // Calculate maximum lead days from item lines
    const activeLines = newQuote.lines.filter(l => l.canSupply !== false);
    const maxLineLeadDays = activeLines.length > 0
      ? Math.max(...activeLines.map(l => l.leadDays || 0))
      : 5;
 
    if (editingQuotationId) {
      const res = await updateQuotation({
        id: editingQuotationId,
        leadDays: maxLineLeadDays,
        terms: newQuote.terms,
        paymentTerms: newQuote.paymentTerms,
        freight: newQuote.freight,
        packingCharges: newQuote.packingCharges,
        lines: newQuote.lines.map(l => ({
          id: l.id!,
          rate: l.rate,
          discount: l.discount,
          gstRate: l.gstRate,
          canSupply: l.canSupply,
          quotedQty: l.quotedQty,
          leadDays: l.leadDays,
          brand: l.brand || null
        }))
      });
      setActionLoading(false);
 
      if (res.success) {
        setIsQuoteOpen(false);
        setEditingQuotationId(null);
        sessionStorage.setItem("requisitions_active_tab", "rfq");
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Failed to update quotation");
      }
    } else {
      const res = await submitQuotation({
        rfqId: selectedRfq!.id,
        vendorId: newQuote.vendorId,
        leadDays: maxLineLeadDays,
        terms: newQuote.terms,
        paymentTerms: newQuote.paymentTerms,
        freight: newQuote.freight,
        packingCharges: newQuote.packingCharges,
        lines: newQuote.lines.map(l => ({
          rfqLineId: l.rfqLineId,
          itemId: l.itemId,
          rate: l.rate,
          discount: l.discount,
          gstRate: l.gstRate,
          canSupply: l.canSupply,
          quotedQty: l.quotedQty,
          leadDays: l.leadDays,
          brand: l.brand || null
        }))
      });
      setActionLoading(false);
 
      if (res.success) {
        setIsQuoteOpen(false);
        sessionStorage.setItem("requisitions_active_tab", "rfq");
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Failed to log quotation");
      }
    }
  };

  const handleOpenCompare = async (rfq: RFQRecord) => {
    setSelectedRfq(rfq);
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rfqs/${rfq.id}/comparison`);
      if (!res.ok) throw new Error("Failed to fetch comparison details");
      const data = await res.json();
      setCompData(data);
      
      const initialAllocations = data.allocations.length > 0 ? data.allocations : data.proposedAllocations;
      const grouped: { [rfqLineId: string]: any[] } = {};
      
      data.rfq.lines.forEach((l: any) => {
        grouped[l.id] = [];
      });
      
      initialAllocations.forEach((alloc: any) => {
        if (!grouped[alloc.rfqLineId]) {
          grouped[alloc.rfqLineId] = [];
        }
        grouped[alloc.rfqLineId].push({
          quotationLineId: alloc.quotationLineId,
          qty: alloc.qty,
          reason: alloc.reason || "L1",
          note: alloc.note || "",
          vendorId: alloc.vendorId,
          vendorName: alloc.vendorName || data.rfq.quotations.find((q: any) => q.vendorId === alloc.vendorId)?.vendorName || "Unknown"
        });
      });
      
      setAllocState(grouped);
      setIsCompOpen(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const toggleAllocation = (rfqLineId: string, qLineId: string, vendorId: string, vendorName: string, isChecked: boolean, defaultQty: number, rank: number) => {
    setAllocState(prev => {
      const current = prev[rfqLineId] || [];
      if (isChecked) {
        return {
          ...prev,
          [rfqLineId]: [
            ...current,
            {
              quotationLineId: qLineId,
              qty: defaultQty,
              reason: rank === 1 ? "L1" : "LEAD_TIME",
              note: "",
              vendorId,
              vendorName
            }
          ]
        };
      } else {
        return {
          ...prev,
          [rfqLineId]: current.filter(x => x.quotationLineId !== qLineId)
        };
      }
    });
  };

  const updateAllocQty = (rfqLineId: string, qLineId: string, qty: number) => {
    setAllocState(prev => {
      const current = prev[rfqLineId] || [];
      return {
        ...prev,
        [rfqLineId]: current.map(x => x.quotationLineId === qLineId ? { ...x, qty } : x)
      };
    });
  };

  const updateAllocReason = (rfqLineId: string, qLineId: string, reason: string) => {
    setAllocState(prev => {
      const current = prev[rfqLineId] || [];
      return {
        ...prev,
        [rfqLineId]: current.map(x => x.quotationLineId === qLineId ? { ...x, reason } : x)
      };
    });
  };

  const updateAllocNote = (rfqLineId: string, qLineId: string, note: string) => {
    setAllocState(prev => {
      const current = prev[rfqLineId] || [];
      return {
        ...prev,
        [rfqLineId]: current.map(x => x.quotationLineId === qLineId ? { ...x, note } : x)
      };
    });
  };

  const handleResetToL1 = async () => {
    if (!confirm("Are you sure you want to reset all awards to L1 default allocations?")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rfqs/${selectedRfq!.id}/propose-award`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Failed to reset allocations");
      const data = await res.json();
      
      const grouped: { [rfqLineId: string]: any[] } = {};
      compData!.rfq.lines.forEach((l: any) => {
        grouped[l.id] = [];
      });
      data.forEach((alloc: any) => {
        if (!grouped[alloc.rfqLineId]) {
          grouped[alloc.rfqLineId] = [];
        }
        grouped[alloc.rfqLineId].push({
          quotationLineId: alloc.quotationLineId,
          qty: alloc.qty,
          reason: alloc.reason || "L1",
          note: alloc.note || "",
          vendorId: alloc.vendorId,
          vendorName: alloc.vendorName || compData!.rfq.quotations.find((q: any) => q.vendorId === alloc.vendorId)?.vendorName || "Unknown"
        });
      });
      setAllocState(grouped);
      alert("Reset to L1 defaults successfully!");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleShortCloseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shortCloseLineId || shortCloseQty <= 0 || shortCloseQty > shortCloseMaxQty) {
      alert("Invalid short-close quantity");
      return;
    }
    setActionLoading(true);
    try {
      const response = await fetch(`/api/pr/lines/${shortCloseLineId}/short-close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qty: shortCloseQty,
          reason: shortCloseReason,
          note: shortCloseNote
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to short-close line");
      }
      alert("Line short-closed successfully!");
      setIsShortCloseOpen(false);
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAwardQuote = async (rfqId: string, quoteId: string) => {
    if (!confirm("Are you sure you want to award the quote to this supplier? This will lock negotiations and set the award status.")) return;
    setActionLoading(true);
    const res = await awardQuotation(rfqId, quoteId);
    setActionLoading(false);
    if (res.success) {
      sessionStorage.setItem("requisitions_active_tab", "rfq");
      window.location.reload();
    } else {
      alert("Failed to award quote: " + res.error);
    }
  };

  const navigateToCreatePO = (rfq: RFQRecord, quote: QuotationRecord) => {
    // We can serialise quote details in query params or localStorage
    const poDetails = {
      vendorId: quote.vendorId,
      rfqId: rfq.id,
      otherCharges: (quote.freight || 0) + (quote.packingCharges || 0),
      lines: quote.lines.map(ql => {
        const rfqLine = rfq.lines.find(rl => rl.itemId === ql.itemId);
        return {
          itemId: ql.itemId,
          qty: rfqLine?.qty || 0,
          rate: ql.rate,
          discount: ql.discount,
          gstRate: ql.gstRate
        };
      })
    };
    sessionStorage.setItem("draft_po_prefill", JSON.stringify(poDetails));
    router.push("/purchase/po");
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">PR & RFQ Comparison</h2>
          <p className="text-xs text-onyx/50 mt-1">Raise purchase requisitions, send out RFQs, map vendor quotes, and perform side-by-side cost analyses.</p>
        </div>
        <div className="flex items-center space-x-3">
          {activeTab === "pr" ? (
            <button
              onClick={() => setIsPrOpen(true)}
              className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
            >
              <Plus size={15} />
              <span>New Requisition</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-onyx/10">
        <button
          onClick={() => handleTabChange("pr")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-200 cursor-pointer ${
            activeTab === "pr" 
              ? "border-saffron text-saffron-dark" 
              : "border-transparent text-onyx/50 hover:text-onyx"
          }`}
        >
          Purchase Requisitions (PR)
        </button>
        <button
          onClick={() => handleTabChange("rfq")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-200 cursor-pointer ${
            activeTab === "rfq" 
              ? "border-saffron text-saffron-dark" 
              : "border-transparent text-onyx/50 hover:text-onyx"
          }`}
        >
          Requests for Quotations (RFQ)
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder={activeTab === "pr" ? "Search by PR number..." : "Search by RFQ number, PR ref..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>
      </div>

      {/* Tables */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        {activeTab === "pr" ? (
          <>
            {/* Desktop Table View */}
            <div className="overflow-x-auto hidden md:block">
               <table className="w-full dense-table text-left border-collapse">
                <thead>
                  <tr>
                    <th>PR Number</th>
                    <th>Source Indent</th>
                    <th className="text-center font-bold">Items Count</th>
                    <th>Date Raised</th>
                    <th>Approved By</th>
                    <th>Approved Date</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPrs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-onyx/40 font-medium">
                        No purchase requisitions found.
                      </td>
                    </tr>
                  ) : (
                    filteredPrs.map((pr) => (
                      <tr key={pr.id}>
                        <td className="font-mono font-bold text-xs text-onyx/85">{pr.number}</td>
                        <td className="font-mono text-xs text-onyx/70">
                          {pr.indentNumbers && pr.indentNumbers.length > 0 ? pr.indentNumbers.join(", ") : "-"}
                        </td>
                        <td className="text-center font-semibold">{pr.lines.length} items</td>
                        <td suppressHydrationWarning>{new Date(pr.createdAt).toLocaleDateString()}</td>
                        <td>{pr.approvedBy || "-"}</td>
                        <td suppressHydrationWarning>{pr.approvedAt ? new Date(pr.approvedAt).toLocaleDateString() : "-"}</td>
                        <td className="text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            pr.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                            pr.status === "SUBMITTED" ? "bg-yellow-100 text-yellow-800" :
                            pr.status === "APPROVED" ? "bg-green-100 text-green-800" :
                            pr.status === "RFQ_ISSUED" ? "bg-blue-100 text-blue-800" :
                            pr.status === "PO_RAISED" ? "bg-purple-100 text-purple-800" :
                            pr.status === "REJECTED" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"
                          }`}>
                            {pr.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              onClick={() => {
                                setSelectedPr(pr);
                                setSelectedRfq(null);
                                setIsDetailOpen(true);
                              }}
                              className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                            >
                              <Eye size={13} />
                            </button>
                            {(pr.status === "DRAFT" || pr.status === "SUBMITTED") && canApprove && (
                              <>
                                <button
                                  onClick={() => handleApprovePr(pr.id)}
                                  title="Approve PR"
                                  className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectPrId(pr.id);
                                    setRejectRemarks("");
                                    setIsRejectPrOpen(true);
                                  }}
                                  title="Reject PR"
                                  className="p-1 hover:bg-red-50 text-red-600 hover:text-red-700 rounded border border-transparent hover:border-red-200 cursor-pointer"
                                >
                                  <X size={13} />
                                </button>
                              </>
                            )}
                            {pr.status === "APPROVED" && canManageRfq && (
                              <button
                                onClick={() => handleOpenRfq(pr)}
                                title="Create RFQ"
                                className="p-1 hover:bg-blue-50 text-blue-600 hover:text-blue-700 rounded border border-transparent hover:border-blue-200 cursor-pointer"
                              >
                                <ArrowRight size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="md:hidden divide-y divide-onyx/5">
              {filteredPrs.length === 0 ? (
                <div className="text-center py-8 text-onyx/40 font-medium">
                  No purchase requisitions found.
                </div>
              ) : (
                filteredPrs.map((pr) => (
                  <div key={pr.id} className="p-4 space-y-3 bg-white">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-onyx/85">{pr.number}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        pr.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                        pr.status === "SUBMITTED" ? "bg-yellow-100 text-yellow-800" :
                        pr.status === "APPROVED" ? "bg-green-100 text-green-800" :
                        pr.status === "RFQ_ISSUED" ? "bg-blue-100 text-blue-800" :
                        pr.status === "PO_RAISED" ? "bg-purple-100 text-purple-800" :
                        pr.status === "REJECTED" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"
                      }`}>
                        {pr.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 text-xs text-onyx/60">
                      <div className="col-span-2">
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Source Indent</span>
                        <span className="font-mono font-semibold text-onyx/85">
                          {pr.indentNumbers && pr.indentNumbers.length > 0 ? pr.indentNumbers.join(", ") : "-"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Items Count</span>
                        <span className="font-semibold text-onyx/85">{pr.lines.length} items</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Date Raised</span>
                        <span className="font-semibold text-onyx/85" suppressHydrationWarning>{new Date(pr.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Approved By</span>
                        <span className="font-semibold text-onyx/85">{pr.approvedBy || "-"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Approved Date</span>
                        <span className="font-semibold text-onyx/85" suppressHydrationWarning>{pr.approvedAt ? new Date(pr.approvedAt).toLocaleDateString() : "-"}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-end space-x-2 pt-2 border-t border-onyx/5">
                      <button
                        onClick={() => {
                          setSelectedPr(pr);
                          setSelectedRfq(null);
                          setIsDetailOpen(true);
                        }}
                        className="flex items-center space-x-1 px-2.5 py-1.5 hover:bg-cream-dark border border-onyx/10 rounded text-xs text-onyx/75 cursor-pointer"
                      >
                        <Eye size={13} />
                        <span>View Details</span>
                      </button>
                      {(pr.status === "DRAFT" || pr.status === "SUBMITTED") && canApprove && (
                        <>
                          <button
                            onClick={() => handleApprovePr(pr.id)}
                            className="flex items-center space-x-1 px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded text-xs cursor-pointer font-bold"
                          >
                            <Check size={13} />
                            <span>Approve</span>
                          </button>
                          <button
                            onClick={() => {
                              setRejectPrId(pr.id);
                              setRejectRemarks("");
                              setIsRejectPrOpen(true);
                            }}
                            className="flex items-center space-x-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-xs cursor-pointer font-bold"
                          >
                            <X size={13} />
                            <span>Reject</span>
                          </button>
                        </>
                      )}
                      {pr.status === "APPROVED" && canManageRfq && (
                        <button
                          onClick={() => handleOpenRfq(pr)}
                          className="flex items-center space-x-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-xs cursor-pointer font-bold"
                        >
                          <ArrowRight size={13} />
                          <span>Create RFQ</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full dense-table text-left border-collapse">
                <thead>
                  <tr>
                    <th>RFQ Number</th>
                    <th>Source PR</th>
                    <th className="text-center font-bold">Items</th>
                    <th className="text-center font-bold">Quotes Logged</th>
                    <th>Date Issued</th>
                    <th className="text-center">Status</th>
                    <th className="text-center font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRfqs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-onyx/40 font-medium">
                        No RFQs issued.
                      </td>
                    </tr>
                  ) : (
                    filteredRfqs.map((rfq) => (
                      <tr key={rfq.id}>
                        <td className="font-mono font-bold text-xs text-onyx/85">{rfq.number}</td>
                        <td className="font-mono text-xs text-onyx/60">{rfq.prNumber || "Manual"}</td>
                        <td className="text-center font-semibold">{rfq.lines.length} items</td>
                        <td className="text-center font-bold text-saffron-dark">{rfq.quotations.length} quote(s)</td>
                        <td suppressHydrationWarning>{new Date(rfq.createdAt).toLocaleDateString()}</td>
                        <td className="text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            rfq.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                            rfq.status === "QUOTES_RECEIVED" ? "bg-blue-100 text-blue-800" :
                            rfq.status === "AWARDED" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                          }`}>
                            {rfq.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              onClick={() => {
                                setSelectedRfq(rfq);
                                setSelectedPr(null);
                                setIsDetailOpen(true);
                              }}
                              className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                            >
                              <Eye size={13} />
                            </button>
                            {rfq.status !== "AWARDED" && canManageRfq && (
                              <button
                                onClick={() => handleOpenQuote(rfq)}
                                title="Log Vendor Quote"
                                className="p-1 hover:bg-saffron-light text-saffron-dark rounded border border-transparent hover:border-saffron-dark/20 cursor-pointer"
                              >
                                <DollarSign size={13} />
                              </button>
                            )}
                            {rfq.quotations.length > 0 && (
                              <button
                                onClick={() => handleOpenCompare(rfq)}
                                title="Comparative Cost Statement"
                                className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer font-bold flex items-center space-x-0.5"
                              >
                                <TrendingDown size={13} />
                                <span className="text-[10px]">Compare</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="md:hidden divide-y divide-onyx/5">
              {filteredRfqs.length === 0 ? (
                <div className="text-center py-8 text-onyx/40 font-medium">
                  No RFQs issued.
                </div>
              ) : (
                filteredRfqs.map((rfq) => (
                  <div key={rfq.id} className="p-4 space-y-3 bg-white">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-onyx/85">{rfq.number}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        rfq.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                        rfq.status === "QUOTES_RECEIVED" ? "bg-blue-100 text-blue-800" :
                        rfq.status === "AWARDED" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                      }`}>
                        {rfq.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 text-xs text-onyx/60">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Source PR</span>
                        <span className="font-mono font-semibold text-onyx/85">{rfq.prNumber || "Manual"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Items Count</span>
                        <span className="font-semibold text-onyx/85">{rfq.lines.length} items</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Quotes Logged</span>
                        <span className="font-bold text-saffron-dark">{rfq.quotations.length} quote(s)</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-onyx/40">Date Issued</span>
                        <span className="font-semibold text-onyx/85" suppressHydrationWarning>{new Date(rfq.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-onyx/5">
                      <button
                        onClick={() => {
                          setSelectedRfq(rfq);
                          setSelectedPr(null);
                          setIsDetailOpen(true);
                        }}
                        className="flex items-center space-x-1 px-2.5 py-1.5 hover:bg-cream-dark border border-onyx/10 rounded text-xs text-onyx/75 cursor-pointer"
                      >
                        <Eye size={12} />
                        <span>Details</span>
                      </button>
                      {rfq.status !== "AWARDED" && canManageRfq && (
                        <button
                          onClick={() => handleOpenQuote(rfq)}
                          className="flex items-center space-x-1 px-2.5 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded text-xs cursor-pointer"
                        >
                          <DollarSign size={12} />
                          <span>Log Quote</span>
                        </button>
                      )}
                      {rfq.quotations.length > 0 && (
                        <button
                          onClick={() => handleOpenCompare(rfq)}
                          className="flex items-center space-x-1 px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded text-xs cursor-pointer font-bold"
                        >
                          <TrendingDown size={12} />
                          <span>Compare</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Manual PR Modal */}
      {isPrOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Raise Purchase Requisition (PR)</h3>
              <button onClick={() => setIsPrOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreatePr} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Add items panel */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Requisition Item</h4>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-6">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                    <SearchableItemSelect
                      items={items}
                      value={newPrLine.itemId}
                      onChange={(val) => setNewPrLine(prev => ({ ...prev, itemId: val }))}
                      placeholder="Select Item"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Qty *</label>
                    <input
                      type="number"
                      value={newPrLine.qty}
                      onChange={(e) => setNewPrLine(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Needed By</label>
                    <input
                      type="date"
                      value={newPrLine.requiredBy}
                      onChange={(e) => setNewPrLine(prev => ({ ...prev, requiredBy: limitYearTo4Digits(e.target.value) }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={handleAddPrLine}
                      className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer border border-transparent shadow-sm"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Items List ({newPr.lines.length})
                </label>
                {newPr.lines.length === 0 ? (
                  <p className="text-center py-4 bg-white border border-dashed border-onyx/10 text-xs text-onyx/40 font-medium rounded-lg">
                    No items added yet.
                  </p>
                ) : (
                  <div className="border border-onyx/5 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse bg-white">
                      <thead className="bg-cream-dark/50">
                        <tr>
                          <th className="p-2 font-bold uppercase">Item</th>
                          <th className="p-2 font-bold uppercase text-right">Qty</th>
                          <th className="p-2 font-bold uppercase">Needed By</th>
                          <th className="p-2 font-bold text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newPr.lines.map((line, idx) => {
                          const item = items.find(i => i.id === line.itemId);
                          return (
                            <tr key={idx} className="border-t border-onyx/5">
                              <td className="p-2">[{item?.code}] {item?.name}</td>
                              <td className="p-2 text-right font-mono font-bold">{line.qty} {item?.baseUom}</td>
                              <td className="p-2">{line.requiredBy || "Immediate"}</td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setNewPr(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))}
                                  className="text-red-600 hover:text-red-800 cursor-pointer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsPrOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || newPr.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving..." : "Save Draft PR"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RFQ from PR Modal */}
      {isRfqOpen && selectedPr && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Generate RFQ from {selectedPr.number}</h3>
              <button onClick={() => setIsRfqOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateRfq} className="p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded text-xs text-red-800 font-semibold">
                  <span>{errorMsg}</span>
                </div>
              )}

              <p className="text-xs text-onyx/60">This RFQ will inherit all item requirements from the approved purchase requisition.</p>

              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50">
                    <tr>
                      <th className="p-2.5 font-bold">Item</th>
                      <th className="p-2.5 font-bold text-right">RFQ Target Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPr.lines.map((line) => (
                      <tr key={line.id} className="border-t border-onyx/5">
                        <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                        <td className="p-2.5 text-right font-mono font-bold">{line.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsRfqOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer"
                >
                  {actionLoading ? "Generating..." : "Generate RFQ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Quote Modal */}
      {isQuoteOpen && selectedRfq && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">{editingQuotationId ? "Edit Supplier Quotation" : "Log Supplier Quotation"} ({selectedRfq.number})</h3>
              <button onClick={() => setIsQuoteOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateQuote} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded text-xs text-red-800 font-semibold">
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Vendor, Terms, Freight & Packing Charges */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-6">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Select Supplier *
                  </label>
                  <SearchableSelect
                    options={vendors.map(v => ({ value: v.id, label: `[${v.code}] ${v.name}` }))}
                    value={newQuote.vendorId}
                    onChange={(val) => setNewQuote(prev => ({ ...prev, vendorId: val }))}
                    placeholder="Select Vendor"
                    disabled={!!editingQuotationId || actionLoading}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Delivery Terms
                  </label>
                  <input
                    type="text"
                    value={newQuote.terms || ""}
                    onChange={(e) => setNewQuote(prev => ({ ...prev, terms: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Payment Terms
                  </label>
                  <input
                    type="text"
                    value={newQuote.paymentTerms || ""}
                    onChange={(e) => setNewQuote(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                    placeholder="e.g. Net 30, Advance"
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Common Freight (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newQuote.freight || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setNewQuote(prev => ({ ...prev, freight: val }));
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    placeholder="0.00"
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Common Packing Charges (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newQuote.packingCharges || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setNewQuote(prev => ({ ...prev, packingCharges: val }));
                    }}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Line rates */}
              <div className="space-y-4">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Item Rates & Taxes
                </label>
                <div className="space-y-3">
                  {newQuote.lines.map((line, idx) => {
                    const rfqLine = selectedRfq.lines.find(rl => rl.id === line.rfqLineId);
                    const canSupply = line.canSupply !== false;
                    return (
                      <div key={line.rfqLineId || idx} className="p-4 bg-white border border-onyx/5 rounded-xl shadow-sm space-y-3 sm:space-y-0 sm:flex sm:gap-6 sm:items-start">
                        {/* Left Column */}
                        <div className="sm:w-1/3 space-y-3">
                          <div>
                            <p className="font-bold text-xs text-onyx">[{rfqLine?.itemCode}] {rfqLine?.itemName}</p>
                            <p className="text-[10px] text-onyx/50 mt-0.5">Target Quantity: <span className="font-mono font-bold text-onyx">{rfqLine?.qty}</span></p>
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={canSupply}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].canSupply = checked;
                                  if (!checked) {
                                    updated[idx].rate = 0;
                                  }
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="rounded text-saffron focus:ring-saffron cursor-pointer"
                            />
                            <span className="text-xs font-bold text-onyx/75">Can Supply this Item</span>
                          </label>
                        </div>

                        {/* Right Column */}
                        <div className={`flex-1 grid grid-cols-2 sm:grid-cols-6 gap-3 p-3 bg-cream-dark/15 border border-onyx/5 rounded-lg transition-opacity duration-200 ${
                          !canSupply ? "opacity-40 pointer-events-none" : ""
                        }`}>
                          <div>
                            <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Basic Rate (₹) *</label>
                            <input
                              type="number"
                              step="any"
                              required={canSupply}
                              value={line.rate || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].rate = val;
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="w-full text-xs p-2 bg-white border border-onyx/10 rounded focus:outline-none text-right font-mono"
                              placeholder="0.00"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Quoted Qty</label>
                            <input
                              type="number"
                              step="any"
                              required={canSupply}
                              value={line.quotedQty ?? ""}
                              onChange={(e) => {
                                const val = e.target.value === "" ? null : parseFloat(e.target.value) || 0;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].quotedQty = val;
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="w-full text-xs p-2 bg-white border border-onyx/10 rounded focus:outline-none text-right font-mono"
                              placeholder={rfqLine?.qty.toString()}
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Discount %</label>
                            <input
                              type="number"
                              step="any"
                              value={line.discount}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].discount = val;
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="w-full text-xs p-2 bg-white border border-onyx/10 rounded focus:outline-none text-right font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">GST %</label>
                            <input
                              type="number"
                              step="any"
                              value={line.gstRate}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].gstRate = val;
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="w-full text-xs p-2 bg-white border border-onyx/10 rounded focus:outline-none text-right font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Brand / Make</label>
                            <input
                              type="text"
                              value={line.brand || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].brand = val;
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="w-full text-xs p-2 bg-white border border-onyx/10 rounded focus:outline-none"
                              placeholder="e.g. Tata, SKF"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Lead Time (Days)</label>
                            <input
                              type="number"
                              step="1"
                              value={line.leadDays ?? ""}
                              onChange={(e) => {
                                const val = e.target.value === "" ? null : parseInt(e.target.value) || 0;
                                setNewQuote(prev => {
                                  const updated = [...prev.lines];
                                  updated[idx].leadDays = val;
                                  return { ...prev, lines: updated };
                                });
                              }}
                              className="w-full text-xs p-2 bg-white border border-onyx/10 rounded focus:outline-none text-right font-mono"
                              placeholder="5"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsQuoteOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer"
                >
                  {actionLoading ? (editingQuotationId ? "Saving..." : "Logging...") : (editingQuotationId ? "Save Changes" : "Submit Quote")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Comparative statement modal */}
      {isCompOpen && compData && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-5xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Comparative Quote Cost Analysis ({compData.rfq.number})</h3>
              <button onClick={() => setIsCompOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-onyx/60">Below is a comparison of all supplier quotations received. Cells display landed unit cost. Toggle checkbox to award items, or customize quantity splits.</p>
              </div>

              {/* Comparative Matrix Table */}
              <div className="border border-onyx/5 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse bg-white min-w-[650px]">
                  <thead className="bg-cream-dark/50 text-[10px] uppercase font-bold tracking-wider">
                    <tr>
                      <th className="p-3 border-r border-onyx/10 w-64">Item Details</th>
                      {compData.rfq.quotations.map((q: any) => (
                        <th key={q.id} className="p-3 text-center border-r border-onyx/10 w-72">
                          <div className="flex flex-col items-center justify-center space-y-1">
                            <p className="font-bold text-onyx">{q.vendorName}</p>
                            <p className="text-[9px] text-onyx/50 font-normal">Lead: {q.leadDays || "N/A"} days{q.paymentTerms ? ` | Pay: ${q.paymentTerms}` : ""}</p>
                            {compData.rfq.status !== "CLOSED" && canManageRfq && (
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditQuoteClick(compData.rfq, q)}
                                  className="p-1 text-blue-600 hover:bg-blue-50 rounded transition"
                                  title="Edit Quotation"
                                >
                                  <Edit size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteQuote(q.id)}
                                  className="p-1 text-red-600 hover:bg-red-50 rounded transition"
                                  title="Delete Quotation"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compData.rfq.lines.map((item: any) => {
                      const allocatedQty = (allocState[item.id] || []).reduce((sum, x) => sum + x.qty, 0);
                      const diff = item.qty - allocatedQty;
                      let coverStatus = "";
                      let badgeClass = "";
                      if (allocatedQty === 0) {
                        coverStatus = "UNCOVERED";
                        badgeClass = "bg-red-105 text-red-800 border-red-200";
                      } else if (diff > 0.0001) {
                        coverStatus = "SHORT";
                        badgeClass = "bg-orange-105 text-orange-800 border-orange-200";
                      } else if (allocatedQty > item.qty + 0.0001) {
                        coverStatus = "OVER ALLOCATED";
                        badgeClass = "bg-purple-105 text-purple-800 border-purple-200";
                      } else {
                        coverStatus = "COVERED";
                        badgeClass = "bg-green-105 text-green-800 border-green-200";
                      }

                      return (
                        <tr key={item.id} className="border-t border-onyx/10">
                          <td className="p-3 border-r border-onyx/10">
                            <p className="font-bold text-onyx">[{item.itemCode}] {item.itemName}</p>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <span className="text-[10px] text-onyx/60 font-medium">Target: <span className="font-mono font-bold text-onyx">{item.qty}</span></span>
                              <span className="text-[10px] text-onyx/60 font-medium">Allocated: <span className="font-mono font-bold text-onyx">{allocatedQty}</span></span>
                            </div>
                            <div className="mt-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${badgeClass}`}>
                                {coverStatus}
                              </span>
                            </div>
                          </td>
                          {compData.rfq.quotations.map((q: any) => {
                            const line = q.lines.find((l: any) => l.rfqLineId === item.id);
                            if (!line) {
                              return <td key={q.id} className="p-3 text-center text-onyx/30 border-r border-onyx/10 bg-cream-dark/10">No quote</td>;
                            }
                            const cost = line.landedUnit ?? calculateLandedCost(line.rate, line.discount, line.gstRate);
                            const rank = line.rank || 999;
                            const isL1 = rank === 1;
                            const allocs = allocState[item.id] || [];
                            const allocEntry = allocs.find((x) => x.quotationLineId === line.id);
                            const isSelected = !!allocEntry;

                            return (
                              <td 
                                key={q.id} 
                                className={`p-3 border-r border-onyx/10 transition-colors text-center ${
                                  isL1 ? "bg-saffron/20" : ""
                                } ${isSelected ? "bg-saffron/5" : ""}`}
                              >
                                <div className="space-y-1">
                                  <p className="font-mono text-xs">Basic: ₹{line.rate.toFixed(2)}</p>
                                  <p className="text-[9px] text-onyx/50 font-mono">Disc: {line.discount}% | GST: {line.gstRate}%</p>
                                  <p className={`text-xs font-mono font-bold ${isL1 ? "text-saffron-dark" : "text-onyx"}`}>
                                    Landed: ₹{cost.toFixed(2)}
                                  </p>
                                  {line.quotedQty !== null && (
                                    <p className="text-[9px] text-onyx/50">Capacity: {line.quotedQty}</p>
                                  )}
                                  <span className={`inline-flex items-center px-1 rounded text-[8px] font-bold ${
                                    isL1 ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                                  }`}>
                                    Rank {rank}
                                  </span>
                                  {line.brand && (
                                    <div className="mt-1">
                                      <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                                        Brand: {line.brand}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {compData.rfq.status !== "CLOSED" && canAwardRfq && (
                                  <div className="mt-3">
                                    <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => toggleAllocation(item.id, line.id, q.vendorId, q.vendorName, e.target.checked, line.quotedQty !== null ? Math.min(item.qty, line.quotedQty) : item.qty, rank)}
                                        className="rounded text-saffron focus:ring-saffron cursor-pointer"
                                      />
                                      <span className="text-[10px] font-bold text-onyx/75">Select</span>
                                    </label>
                                  </div>
                                )}

                                {isSelected && (
                                  <div className="mt-3 p-2 bg-cream-dark/15 border border-onyx/10 rounded-lg space-y-2 text-left">
                                    <div>
                                      <label className="block text-[8px] uppercase font-bold text-onyx/50 mb-0.5">Alloc Qty</label>
                                      <input
                                        type="number"
                                        step="any"
                                        value={allocEntry.qty}
                                        onChange={(e) => updateAllocQty(item.id, line.id, parseFloat(e.target.value) || 0)}
                                        className="w-full text-xs p-1 bg-white border border-onyx/10 rounded font-mono text-right"
                                      />
                                    </div>
                                    
                                    {!isL1 && (
                                      <>
                                        <div>
                                          <label className="block text-[8px] uppercase font-bold text-onyx/50 mb-0.5">Award Reason *</label>
                                          <SearchableSelect
                                            options={[
                                              { value: "LEAD_TIME", label: "Lead Time" },
                                              { value: "APPROVED_VENDOR", label: "Approved Vendor" },
                                              { value: "CAPACITY_SPLIT", label: "Capacity Split" },
                                              { value: "SOLE_SUPPLIER", label: "Sole Supplier" },
                                              { value: "PARTIAL_AVAILABILITY", label: "Partial Availability" },
                                              { value: "OTHER", label: "Other" }
                                            ]}
                                            value={allocEntry.reason}
                                            onChange={(val) => updateAllocReason(item.id, line.id, val)}
                                            placeholder="Select Reason"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[8px] uppercase font-bold text-onyx/50 mb-0.5">Note *</label>
                                          <input
                                            type="text"
                                            value={allocEntry.note}
                                            onChange={(e) => updateAllocNote(item.id, line.id, e.target.value)}
                                            placeholder="Justification note"
                                            className="w-full text-[10px] p-1 bg-white border border-onyx/10 rounded"
                                            required
                                          />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Live Award Split Summary Panel */}
              <div className="p-4 bg-cream-dark/25 border border-onyx/10 rounded-xl space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Award Split & Real-time Warning Panel</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {compData.rfq.quotations.map((q: any) => {
                    const vendor = vendors.find((v) => v.id === q.vendorId);
                    
                    let vendorTotal = 0;
                    const vendorAllocs: any[] = [];
                    
                    compData.rfq.lines.forEach((line: any) => {
                      const allocs = allocState[line.id] || [];
                      const match = allocs.find((a) => a.quotationLineId === q.lines.find((ql: any) => ql.rfqLineId === line.id)?.id);
                      if (match) {
                        const qLine = q.lines.find((ql: any) => ql.rfqLineId === line.id);
                        if (qLine) {
                          const landedUnit = qLine.landedUnit ?? calculateLandedCost(qLine.rate, qLine.discount, qLine.gstRate);
                          const totalLineCost = landedUnit * match.qty;
                          vendorTotal += totalLineCost;
                          vendorAllocs.push({
                            line,
                            qty: match.qty,
                            moq: line.moq || 1,
                            totalLineCost
                          });
                        }
                      }
                    });

                    if (vendorAllocs.length === 0) return null;

                    const isBelowMinOrder = vendor && vendorTotal < (vendor.minOrderValue || 0);
                    const hasMoqIssues = vendorAllocs.some(x => x.qty < x.moq);

                    return (
                      <div key={q.id} className="p-3 bg-white border border-onyx/5 rounded-lg shadow-xs space-y-2 text-left">
                        <div className="flex justify-between items-center border-b border-onyx/5 pb-1.5">
                          <span className="font-bold text-xs text-onyx">{q.vendorName}</span>
                          <span className="font-mono font-bold text-xs text-saffron-dark">₹{vendorTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        
                        <div className="text-[10px] text-onyx/60 space-y-1">
                          <p>Items Allocated: <span className="font-bold text-onyx">{vendorAllocs.length}</span></p>
                          {isBelowMinOrder && (
                            <p className="flex items-center gap-1 text-red-600 bg-red-50 border border-red-100 p-1.5 rounded font-medium">
                              <AlertCircle size={10} className="shrink-0" />
                              <span>PO value is below Vendor's Min Order Value (₹{(vendor.minOrderValue || 0).toFixed(0)})</span>
                            </p>
                          )}
                          {hasMoqIssues && (
                            <div className="text-orange-600 bg-orange-50 border border-orange-100 p-1.5 rounded space-y-0.5 font-medium">
                              <p className="flex items-center gap-1 font-bold">
                                <AlertCircle size={10} className="shrink-0" />
                                <span>MOQ Violations:</span>
                              </p>
                              <ul className="list-disc list-inside pl-1 text-[9px] space-y-0.5">
                                {vendorAllocs.filter(x => x.qty < x.moq).map((x, i) => (
                                  <li key={i}>
                                    [{x.line.itemCode}] {x.qty} &lt; MOQ {x.moq}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {Object.values(allocState).flat().length === 0 && (
                    <p className="col-span-2 text-center py-4 text-xs text-onyx/40 italic">
                      No allocations selected. Select vendors in the matrix above.
                    </p>
                  )}
                </div>
              </div>

              {compData.rfq.status === "CLOSED" && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center space-x-2 text-xs text-green-800 font-semibold">
                  <ShieldCheck size={16} className="text-green-600" />
                  <span>Purchase Orders have been raised and RFQ is CLOSED.</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-onyx/10 bg-cream-dark/30 flex items-center justify-between">
              <div>
                {compData.rfq.status !== "CLOSED" && canAwardRfq && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleResetToL1}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-cream hover:bg-cream-dark border border-onyx/20 text-onyx text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer"
                    >
                      Reset to L1 Defaults
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const payloadLines: any[] = [];
                        let isValid = true;
                        let validationError = "";
                        
                        Object.entries(allocState).forEach(([rfqLineId, allocs]) => {
                          allocs.forEach((alloc) => {
                            const line = compData.rfq.lines.find((l: any) => l.id === rfqLineId);
                            const q = compData.rfq.quotations.find((qt: any) => qt.vendorId === alloc.vendorId);
                            const qLine = q?.lines.find((ql: any) => ql.rfqLineId === rfqLineId);
                            const rank = qLine?.rank || 999;
                            
                            if (rank !== 1 && (!alloc.note || alloc.note.trim().length === 0)) {
                              isValid = false;
                              validationError = `Justification note is strictly required for selecting non-L1 supplier (${alloc.vendorName}) on item [${line?.itemCode}] ${line?.itemName}.`;
                            }
                            payloadLines.push({
                              rfqLineId,
                              quotationLineId: alloc.quotationLineId,
                              qty: alloc.qty,
                              reason: alloc.reason,
                              note: alloc.note
                            });
                          });
                        });
                        
                        if (!isValid) {
                          alert(validationError);
                          return;
                        }

                        if (payloadLines.length === 0) {
                          alert("Please select at least one allocation.");
                          return;
                        }

                        setIsPoDetailsModalOpen(true);
                      }}
                      disabled={actionLoading || Object.values(allocState).flat().length === 0}
                      className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg transition-colors shadow cursor-pointer disabled:opacity-50"
                    >
                      Post Awards & Generate POs
                    </button>
                  </div>
                )}
              </div>
              <button 
                onClick={() => setIsCompOpen(false)}
                className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
              >
                Close Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {isDetailOpen && (selectedPr || selectedRfq) && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedPr ? selectedPr.number : selectedRfq!.number}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                {selectedPr ? "Purchase Requisition Details" : "Request for Quote Details"}
              </h3>
              <p className="text-xs text-onyx/50 flex flex-col space-y-1">
                <span>{selectedPr ? `Status: ${selectedPr.status}` : `Linked PR: ${selectedRfq!.prNumber || "None"}`}</span>
                {selectedPr?.indentNumbers && selectedPr.indentNumbers.length > 0 && (
                  <span className="font-mono text-onyx/70">
                    Source Indent(s): {selectedPr.indentNumbers.join(", ")}
                  </span>
                )}
              </p>
              {selectedPr && selectedPr.status === "REJECTED" && selectedPr.remarks && (
                <div className="mt-2 p-2.5 bg-red-50 border-l-4 border-red-500 rounded text-xs text-red-800 font-semibold">
                  <span className="block text-[9px] uppercase font-bold text-red-700 mb-0.5">Rejection Remarks</span>
                  <span>{selectedPr.remarks}</span>
                </div>
              )}
            </div>

            {/* Items table */}
            <div className="flex-1 overflow-y-auto py-6 space-y-4">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                Line Items
              </h4>

              <div className="border border-onyx/5 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse bg-white min-w-[500px]">
                  <thead className="bg-cream-dark/50">
                    <tr className="font-bold uppercase tracking-wider text-[10px]">
                      <th className="p-2.5">Item Description</th>
                      {selectedPr ? (
                        <>
                          <th className="p-2.5 text-right">Qty</th>
                          <th className="p-2.5 text-right text-green-700">Ordered</th>
                          <th className="p-2.5 text-right text-red-600">Short</th>
                          <th className="p-2.5 text-right">Open</th>
                          <th className="p-2.5 text-center">Status</th>
                          {canApprove && <th className="p-2.5 text-center">Action</th>}
                        </>
                      ) : (
                        <th className="p-2.5 text-right">Qty</th>
                      )}
                      {selectedPr && <th className="p-2.5 text-left">Needed By</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPr ? (
                      selectedPr.lines.map((line) => {
                        const openQty = line.qty - (line.orderedQty || 0) - (line.shortClosedQty || 0);
                        const isTerminal = openQty <= 0;
                        return (
                          <tr key={line.id} className="border-t border-onyx/5 text-[11px]">
                            <td className="p-2.5">
                              <p className="font-bold text-onyx">[{line.itemCode}] {line.itemName}</p>
                            </td>
                            <td className="p-2.5 text-right font-mono">{line.qty}</td>
                            <td className="p-2.5 text-right font-mono text-green-700 font-semibold">{line.orderedQty || 0}</td>
                            <td className="p-2.5 text-right font-mono text-red-600">{line.shortClosedQty || 0}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-onyx">{openQty}</td>
                            <td className="p-2.5 text-center">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                line.status === "OPEN" ? "bg-gray-100 text-gray-800" :
                                line.status === "PARTIALLY_ORDERED" ? "bg-yellow-100 text-yellow-800" :
                                line.status === "ORDERED" ? "bg-green-100 text-green-800" :
                                line.status === "SHORT_CLOSED" ? "bg-red-100 text-red-800 border border-red-200" : "bg-gray-100 text-gray-800"
                              }`}>
                                {(line.status || "OPEN").replace("_", " ")}
                              </span>
                            </td>
                            {canApprove && (
                              <td className="p-2.5 text-center">
                                {!isTerminal ? (
                                  <button
                                    onClick={() => {
                                      setShortCloseLineId(line.id);
                                      setShortCloseLineName(`[${line.itemCode}] ${line.itemName}`);
                                      setShortCloseMaxQty(openQty);
                                      setShortCloseQty(openQty);
                                      setShortCloseReason("SUPPLIER_UNAVAILABLE");
                                      setShortCloseNote("");
                                      setIsShortCloseOpen(true);
                                    }}
                                    className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 font-bold border border-red-200 rounded text-[9px] cursor-pointer"
                                  >
                                    Short-Close
                                  </button>
                                ) : (
                                  <span className="text-onyx/30 text-[9px]">-</span>
                                )}
                              </td>
                            )}
                            <td suppressHydrationWarning className="p-2.5">
                              {line.requiredBy ? new Date(line.requiredBy).toLocaleDateString() : "Immediate"}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      selectedRfq!.lines.map((line) => {
                        return (
                          <tr key={line.id} className="border-t border-onyx/5 text-[11px]">
                            <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                            <td className="p-2.5 text-right font-mono font-bold">{line.qty}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {!selectedPr && selectedRfq && (
                <div className="mt-6 pt-6 border-t border-onyx/5">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40 mb-3">
                    Logged Supplier Quotations
                  </h4>
                  
                  {selectedRfq.quotations && selectedRfq.quotations.length > 0 ? (
                    <div className="space-y-3">
                      {selectedRfq.quotations.map((q) => (
                        <div 
                          key={q.id} 
                          className="p-3 bg-white border border-onyx/5 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
                        >
                          <div className="space-y-1">
                            <p className="font-heading text-xs font-bold text-onyx">{q.vendorName}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-[10px] text-onyx/60 font-mono">
                              <div><span className="text-onyx/40">Lead:</span> {q.leadDays ?? "N/A"} days</div>
                              <div><span className="text-onyx/40 font-heading">Del. Terms:</span> {q.terms || "N/A"}</div>
                              <div><span className="text-onyx/40 font-heading">Pay. Terms:</span> {q.paymentTerms || "N/A"}</div>
                              <div><span className="text-onyx/40 font-heading">Freight:</span> ₹{q.freight}</div>
                              <div><span className="text-onyx/40 font-heading">Packing:</span> ₹{q.packingCharges}</div>
                            </div>
                          </div>
                          
                          {selectedRfq.status !== "CLOSED" && canManageRfq && (
                            <div className="flex items-center gap-1.5 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleEditQuoteClick(selectedRfq, q)}
                                className="flex items-center justify-center p-1.5 text-blue-600 hover:bg-blue-50 border border-blue-100 rounded transition cursor-pointer"
                                title="Edit Quotation"
                              >
                                <Edit size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteQuote(q.id)}
                                className="flex items-center justify-center p-1.5 text-red-600 hover:bg-red-50 border border-red-100 rounded transition cursor-pointer"
                                title="Delete Quotation"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-white border border-dashed border-onyx/15 rounded-lg text-center text-xs text-onyx/40">
                      No quotations logged yet for this RFQ.
                    </div>
                  )}
                </div>
              )}
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

      {/* Reject PR Modal */}
      {isRejectPrOpen && rejectPrId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-md w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Reject Purchase Requisition</h3>
              <button 
                onClick={() => {
                  setIsRejectPrOpen(false);
                  setRejectPrId(null);
                  setRejectRemarks("");
                }} 
                className="hover:text-saffron cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRejectPrSubmit} className="p-6 space-y-4">
              <div className="flex items-start space-x-2 text-xs bg-red-50 text-red-800 p-2.5 rounded border border-red-150">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-600" />
                <span>Provide remarks explaining why this requisition is being rejected. This action will change the status to REJECTED.</span>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">Rejection Remarks *</label>
                <textarea
                  value={rejectRemarks}
                  onChange={(e) => setRejectRemarks(e.target.value)}
                  placeholder="e.g. Budget exceeded or incorrect item specifications"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[80px]"
                  required
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsRejectPrOpen(false);
                    setRejectPrId(null);
                    setRejectRemarks("");
                  }}
                  className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !rejectRemarks.trim()}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Rejecting..." : "Confirm Reject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Pre-flight Details Modal */}
      {isPoDetailsModalOpen && selectedRfq && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-lg w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Generate PO - Terms & Destination</h3>
              <button 
                onClick={() => setIsPoDetailsModalOpen(false)} 
                className="hover:text-saffron cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              setIsPoDetailsModalOpen(false);
              setActionLoading(true);
              setErrorMsg(null);
              try {
                // 1. Commit custom allocations first
                const payloadLines = Object.entries(allocState).flatMap(([rfqLineId, allocs]) =>
                  allocs.map((alloc) => ({
                    rfqLineId,
                    quotationLineId: alloc.quotationLineId,
                    qty: alloc.qty,
                    reason: alloc.reason,
                    note: alloc.note
                  }))
                );

                const awardRes = await fetch(`/api/rfqs/${selectedRfq!.id}/award`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ lines: payloadLines })
                });
                
                if (!awardRes.ok) {
                  const errData = await awardRes.json();
                  throw new Error(errData.error || "Failed to commit award allocations");
                }

                // 2. Raise POs
                const poRes = await fetch(`/api/rfqs/${selectedRfq!.id}/raise-po`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(poPreflightDetails)
                });

                const poData = await poRes.json();
                if (!poRes.ok) {
                  throw new Error(poData.error || "Failed to generate Purchase Orders");
                }

                if (poData.warnings && poData.warnings.length > 0) {
                  alert("POs generated with the following warnings:\n\n" + poData.warnings.join("\n"));
                } else {
                  alert("RFQ Awarded and POs generated successfully!");
                }

                setIsCompOpen(false);
                window.location.reload();
              } catch (err: any) {
                alert("Error: " + err.message);
              } finally {
                setActionLoading(false);
              }
            }} className="p-6 space-y-4 text-xs">
              <div className="flex items-start space-x-2 text-xs bg-amber-50 text-amber-800 p-2.5 rounded border border-amber-150">
                <Info size={14} className="shrink-0 mt-0.5 text-amber-600" />
                <span>Specify the contract details to populate on the generated Purchase Orders.</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Payment Terms</label>
                  <input
                    type="text"
                    value={poPreflightDetails.paymentTerms}
                    onChange={(e) => setPoPreflightDetails(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Delivery / Freight Terms</label>
                  <input
                    type="text"
                    value={poPreflightDetails.freightTerms}
                    onChange={(e) => setPoPreflightDetails(prev => ({ ...prev, freightTerms: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Select Ship-To Location Master</label>
                <SearchableSelect
                  options={shipToLocations.map(loc => ({
                    value: `${loc.name} (${loc.address})`,
                    label: `[${loc.code}] ${loc.name} (${loc.address.slice(0, 30)}...)`
                  }))}
                  value={poPreflightDetails.shipTo}
                  onChange={(val) => setPoPreflightDetails(prev => ({ ...prev, shipTo: val }))}
                  placeholder="Select ship-to location"
                />
                <div className="mt-2"></div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Custom Delivery Address (Editable)</label>
                <textarea
                  value={poPreflightDetails.shipTo}
                  onChange={(e) => setPoPreflightDetails(prev => ({ ...prev, shipTo: e.target.value }))}
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none min-h-[50px] font-mono leading-relaxed"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-2">
                    Terms & Conditions Presets (Select one or more)
                  </label>
                  <div className="space-y-2 max-h-[120px] overflow-y-auto p-3 bg-cream-dark/30 border border-onyx/10 rounded-lg">
                    {presets.length > 0 ? (
                      presets.map((p: any) => {
                        const selectedIds = poPreflightDetails.termsPresetId ? poPreflightDetails.termsPresetId.split(",").map((id: string) => id.trim()) : [];
                        const isChecked = selectedIds.includes(p.id);
                        return (
                          <label key={p.id} className="flex items-start gap-2.5 cursor-pointer text-xs text-onyx/80 hover:text-onyx font-medium">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                let newIds = [...selectedIds];
                                if (e.target.checked) {
                                  newIds.push(p.id);
                                } else {
                                  newIds = newIds.filter((id: string) => id !== p.id);
                                }
                                setPoPreflightDetails(prev => ({ ...prev, termsPresetId: newIds.filter(Boolean).join(",") }));
                              }}
                              className="mt-0.5 accent-saffron"
                            />
                            <span>{p.name}</span>
                          </label>
                        );
                      })
                    ) : (
                      <span className="text-xs text-onyx/50 italic">No presets available</span>
                    )}
                  </div>
                </div>
                
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-2">
                    Custom / Additional Terms & Conditions {(!poPreflightDetails.termsPresetId) && "*"}
                  </label>
                  <textarea
                    value={poPreflightDetails.termsConditions}
                    onChange={(e) => setPoPreflightDetails(prev => ({ ...prev, termsConditions: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none min-h-[120px] leading-relaxed"
                    placeholder="Enter custom terms..."
                    required={!poPreflightDetails.termsPresetId}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsPoDetailsModalOpen(false)}
                  className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-3.5 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Generating POs..." : "Generate POs"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Short-Close PR Line Modal */}
      {isShortCloseOpen && shortCloseLineId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-md w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Short-Close PR Line</h3>
              <button 
                onClick={() => setIsShortCloseOpen(false)} 
                className="hover:text-saffron cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleShortCloseSubmit} className="p-6 space-y-4 text-xs">
              <div className="bg-amber-50 text-amber-900 border-l-4 border-amber-500 p-3.5 rounded text-xs leading-relaxed">
                <span className="font-bold">Item:</span> {shortCloseLineName}
                <br />
                <span className="font-bold">Max open quantity:</span> {shortCloseMaxQty}
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Quantity to Short-Close *</label>
                <input
                  type="number"
                  step="any"
                  max={shortCloseMaxQty}
                  min={0.0001}
                  required
                  value={shortCloseQty}
                  onChange={(e) => setShortCloseQty(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Reason *</label>
                <SearchableSelect
                  options={[
                    { value: "SUPPLIER_UNAVAILABLE", label: "Supplier Unavailable / No Quotes" },
                    { value: "DELIVERY_DELAYED", label: "Excessive Delivery Lead Time" },
                    { value: "NOT_REQUIRED", label: "Requirement Cancelled / Changed" },
                    { value: "BUDGET_EXCEEDED", label: "Budget Limitations" },
                    { value: "OTHER", label: "Other Reason" }
                  ]}
                  value={shortCloseReason}
                  onChange={(val) => setShortCloseReason(val)}
                  placeholder="Select reason"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Notes / Justification *</label>
                <textarea
                  value={shortCloseNote}
                  onChange={(e) => setShortCloseNote(e.target.value)}
                  placeholder="Provide justification notes for audit log..."
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[80px] leading-relaxed"
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsShortCloseOpen(false)}
                  className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || shortCloseQty <= 0 || shortCloseQty > shortCloseMaxQty}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Processing..." : "Confirm Short-Close"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
