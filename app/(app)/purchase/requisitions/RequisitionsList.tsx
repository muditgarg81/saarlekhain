"use client";

import { useState, useEffect } from "react";
import { 
  createPR, 
  approvePR, 
  rejectPR,
  createRFQ, 
  submitQuotation, 
  awardQuotation 
} from "@/app/actions/requisitions";
import { awardRfq, raisePoFromAward } from "@/app/actions/purchaseFlow";
import { limitYearTo4Digits } from "@/lib/date";
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
  Info
} from "lucide-react";
import { useRouter } from "next/navigation";

interface PRLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  requiredBy: string | null;
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
}

interface RFQLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  awardedQuotationLineId?: string | null;
}

interface QuotationLine {
  id: string;
  itemId: string;
  rate: number;
  discount: number;
  gstRate: number;
  rfqLineId?: string | null;
}

interface QuotationRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  leadDays: number | null;
  terms: string | null;
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
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface ShipToLocationRecord {
  id: string;
  code: string;
  name: string;
  address: string;
  gstin: string | null;
}

interface RequisitionsListProps {
  prs: PRRecord[];
  rfqs: RFQRecord[];
  items: Item[];
  vendors: Vendor[];
  userRole: string;
  shipToLocations: ShipToLocationRecord[];
  presets?: any[];
}

export default function RequisitionsList({
  prs,
  rfqs,
  items,
  vendors,
  userRole,
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
    lines: [] as { rfqLineId?: string | null; itemId: string; rate: number; discount: number; gstRate: number }[]
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canApprove = ["PURCHASE_MANAGER", "ADMIN", "OWNER"].includes(userRole);
  const isPurchase = ["PURCHASE_OFFICER", "PURCHASE_MANAGER", "ADMIN", "OWNER"].includes(userRole);

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
    setNewRfq({
      prId: pr.id,
      lines: pr.lines.map(l => ({ itemId: l.itemId, qty: l.qty }))
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
    setNewQuote({
      vendorId: "",
      leadDays: 5,
      terms: "FOB Destination",
      lines: rfq.lines.map(l => ({ rfqLineId: l.id, itemId: l.itemId, rate: 0, discount: 0, gstRate: 18 }))
    });
    setIsQuoteOpen(true);
  };

  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuote.vendorId) {
      alert("Please select a vendor");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    const res = await submitQuotation({
      rfqId: selectedRfq!.id,
      vendorId: newQuote.vendorId,
      leadDays: newQuote.leadDays,
      terms: newQuote.terms,
      lines: newQuote.lines
    });
    setActionLoading(false);

    if (res.success) {
      setIsQuoteOpen(false);
      sessionStorage.setItem("requisitions_active_tab", "rfq");
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to log quotation");
    }
  };

  const handleOpenCompare = (rfq: RFQRecord) => {
    setSelectedRfq(rfq);
    const initialAwards: { [rfqLineId: string]: string } = {};
    rfq.lines.forEach(rfqLine => {
      const lowest = getLowestQuotation(rfq, rfqLine.id, rfqLine.itemId);
      if (lowest.line) {
        initialAwards[rfqLine.id] = lowest.line.id;
      }
    });
    setLineAwards(initialAwards);
    setIsCompOpen(true);
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
        <div className="overflow-x-auto">
          {activeTab === "pr" ? (
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th>PR Number</th>
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
                    <td colSpan={7} className="text-center py-8 text-onyx/40 font-medium">
                      No purchase requisitions found.
                    </td>
                  </tr>
                ) : (
                  filteredPrs.map((pr) => (
                    <tr key={pr.id}>
                      <td className="font-mono font-bold text-xs text-onyx/85">{pr.number}</td>
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
                          {pr.status === "APPROVED" && isPurchase && (
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
          ) : (
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
                          {rfq.status !== "AWARDED" && isPurchase && (
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
          )}
        </div>
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
                    <select
                      value={newPrLine.itemId}
                      onChange={(e) => setNewPrLine(prev => ({ ...prev, itemId: e.target.value }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                    >
                      <option value="">Select Item</option>
                      {items.map(item => (
                        <option key={item.id} value={item.id}>[{item.code}] {item.name}</option>
                      ))}
                    </select>
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
              <h3 className="font-heading text-lg font-bold">Log Supplier Quotation ({selectedRfq.number})</h3>
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

              {/* Vendor, Lead Days, Terms */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Select Supplier *
                  </label>
                  <select
                    value={newQuote.vendorId}
                    onChange={(e) => setNewQuote(prev => ({ ...prev, vendorId: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
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
                    Lead Time (Days)
                  </label>
                  <input
                    type="number"
                    value={newQuote.leadDays}
                    onChange={(e) => setNewQuote(prev => ({ ...prev, leadDays: parseInt(e.target.value) || 0 }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Delivery Terms
                  </label>
                  <input
                    type="text"
                    value={newQuote.terms}
                    onChange={(e) => setNewQuote(prev => ({ ...prev, terms: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              {/* Line rates */}
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Item Rates & Taxes
                </label>
                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-2.5 font-bold">Item</th>
                        <th className="p-2.5 font-bold text-right w-24">Basic Rate</th>
                        <th className="p-2.5 font-bold text-right w-20">Discount %</th>
                        <th className="p-2.5 font-bold text-right w-20">GST %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newQuote.lines.map((line, idx) => {
                        const rfqLine = selectedRfq.lines.find(rl => rl.id === line.rfqLineId);
                        return (
                          <tr key={line.rfqLineId || idx} className="border-t border-onyx/5">
                            <td className="p-2.5">
                              <p className="font-semibold">[{rfqLine?.itemCode}] {rfqLine?.itemName}</p>
                              <p className="text-[10px] text-onyx/40">Target Qty: {rfqLine?.qty}</p>
                            </td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                step="any"
                                required
                                value={line.rate || ""}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setNewQuote(prev => {
                                    const updated = [...prev.lines];
                                    updated[idx].rate = val;
                                    return { ...prev, lines: updated };
                                  });
                                }}
                                className="w-full text-xs p-1.5 border border-onyx/15 rounded text-right font-mono"
                              />
                            </td>
                            <td className="p-2.5">
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
                                className="w-full text-xs p-1.5 border border-onyx/15 rounded text-right font-mono"
                              />
                            </td>
                            <td className="p-2.5">
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
                                className="w-full text-xs p-1.5 border border-onyx/15 rounded text-right font-mono"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                  {actionLoading ? "Logging..." : "Submit Quote"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Comparative statement modal */}
      {isCompOpen && selectedRfq && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-4xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Comparative Quote Cost Analysis ({selectedRfq.number})</h3>
              <button onClick={() => setIsCompOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-onyx/60">Below is a comparison of all supplier quotations received. Saffron highlighted cells represent the lowest landed unit cost for each item.</p>
              </div>

              {/* Comparative Matrix Table */}
              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50 text-[10px] uppercase font-bold tracking-wider">
                    <tr>
                      <th className="p-3 border-r border-onyx/10 w-48">Item Details</th>
                      {selectedRfq.quotations.map(q => (
                        <th key={q.id} className="p-3 text-center border-r border-onyx/10">
                          <p className="font-bold text-onyx">{q.vendorName}</p>
                          <p className="text-[9px] text-onyx/50 font-normal">Lead: {q.leadDays || "N/A"} days</p>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRfq.lines.map(item => {
                      const lowest = getLowestQuotation(selectedRfq, item.id, item.itemId);
                      return (
                        <tr key={item.id} className="border-t border-onyx/10">
                          <td className="p-3 border-r border-onyx/10">
                            <p className="font-bold">[{item.itemCode}] {item.itemName}</p>
                            <p className="text-[10px] text-onyx/40">Target Qty: {item.qty}</p>
                          </td>
                          {selectedRfq.quotations.map(q => {
                            const line = q.lines.find(l => l.rfqLineId === item.id || (!l.rfqLineId && l.itemId === item.itemId));
                            if (!line) {
                              return <td key={q.id} className="p-3 text-center text-onyx/30 border-r border-onyx/10 bg-cream-dark/10">No quote</td>;
                            }
                            const cost = calculateLandedCost(line.rate, line.discount, line.gstRate);
                            const isLowest = lowest.cost !== null && Math.abs(cost - lowest.cost) < 0.01;
                            const isSelected = lineAwards[item.id] === line.id;
                            const isAwarded = item.awardedQuotationLineId === line.id;

                            return (
                              <td 
                                key={q.id} 
                                className={`p-3 text-center border-r border-onyx/10 transition-colors ${
                                  isLowest ? "bg-saffron/20" : ""
                                } ${isSelected ? "bg-saffron/10 font-semibold" : ""}`}
                              >
                                <p className="font-mono">Basic: ₹{line.rate.toFixed(2)}</p>
                                <p className="text-[10px] text-onyx/50 font-mono">Disc: {line.discount}% | GST: {line.gstRate}%</p>
                                <p className={`text-xs mt-1 font-mono font-bold ${isLowest ? "text-saffron-dark" : "text-onyx"}`}>
                                  Landed: ₹{cost.toFixed(2)}
                                </p>
                                
                                {isAwarded && (
                                  <span className="mt-1.5 inline-flex items-center space-x-0.5 text-green-700 font-bold bg-green-50 border border-green-200 px-1 py-0.5 rounded text-[8px] uppercase">
                                    <Award size={9} />
                                    <span>Awarded Line</span>
                                  </span>
                                )}

                                {selectedRfq.status !== "CLOSED" && selectedRfq.status !== "AWARDED" && isPurchase && (
                                  <label className="mt-2.5 flex items-center justify-center space-x-1.5 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`award-${item.id}`}
                                      checked={isSelected}
                                      onChange={() => setLineAwards(prev => ({ ...prev, [item.id]: line.id }))}
                                      className="rounded-full text-saffron focus:ring-saffron cursor-pointer"
                                    />
                                    <span className="text-[9px] font-bold text-onyx/65">Award Line</span>
                                  </label>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                    {/* Award status row */}
                    <tr className="border-t border-onyx-dark/25 bg-cream-dark/15 font-semibold">
                      <td className="p-3 border-r border-onyx/10">Supplier Summary</td>
                      {selectedRfq.quotations.map(q => {
                        const awardedCount = selectedRfq.lines.filter(l => l.awardedQuotationLineId && q.lines.some(ql => ql.id === l.awardedQuotationLineId)).length;
                        return (
                          <td key={q.id} className="p-3 text-center border-r border-onyx/10 text-[10px]">
                            {awardedCount > 0 ? (
                              <span className="inline-flex items-center space-x-1 text-green-700 font-bold bg-green-50 border border-green-200 px-2 py-1 rounded">
                                <Award size={11} />
                                <span>{awardedCount} Line(s) Awarded</span>
                              </span>
                            ) : (
                              <span className="text-onyx/40">No Lines Awarded</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Award actions (PO Navigation) */}
              {selectedRfq.status === "AWARDED" && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between text-xs text-green-800">
                  <div className="flex items-center space-x-2 font-semibold">
                    <ShieldCheck size={16} className="text-green-600" />
                    <span>Quote contract has been awarded. Ready to create Purchase Order.</span>
                  </div>
                  {selectedRfq.quotations.filter(q => q.awarded).map(q => (
                    <button
                      key={q.id}
                      onClick={() => navigateToCreatePO(selectedRfq, q)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded font-bold cursor-pointer transition-all"
                    >
                      <span>Create PO</span>
                      <ArrowRight size={13} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-onyx/10 bg-cream-dark/30 flex items-center justify-between">
              <div>
                {selectedRfq.status !== "CLOSED" && selectedRfq.status !== "AWARDED" && isPurchase && (
                  <button
                    type="button"
                    onClick={() => {
                      if (Object.keys(lineAwards).length === 0) {
                        alert("Please select at least one line award.");
                        return;
                      }
                      setIsPoDetailsModalOpen(true);
                    }}
                    disabled={actionLoading || Object.keys(lineAwards).length === 0}
                    className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx text-xs font-bold rounded-lg transition-colors shadow cursor-pointer disabled:opacity-50 animate-pulse-slow"
                  >
                    Post Awards & Generate POs
                  </button>
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

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedPr ? selectedPr.number : selectedRfq!.number}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                {selectedPr ? "Purchase Requisition Details" : "Request for Quote Details"}
              </h3>
              <p className="text-xs text-onyx/50">
                {selectedPr ? `Status: ${selectedPr.status}` : `Linked PR: ${selectedRfq!.prNumber || "None"}`}
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

              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50">
                    <tr>
                      <th className="p-2.5 font-bold">Item Description</th>
                      <th className="p-2.5 font-bold text-right">Qty</th>
                      {selectedPr && <th className="p-2.5 font-bold">Needed By</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPr ? selectedPr.lines : selectedRfq!.lines).map((line) => (
                      <tr key={line.id} className="border-t border-onyx/5">
                        <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                        <td className="p-2.5 text-right font-mono font-bold">{line.qty}</td>
                        {selectedPr && <td suppressHydrationWarning className="p-2.5">{(line as any).requiredBy ? new Date((line as any).requiredBy).toLocaleDateString() : "Immediate"}</td>}
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
                const awardsArray = Object.entries(lineAwards).map(([rfqLineId, quotationLineId]) => ({
                  rfqLineId,
                  quotationLineId
                }));
                
                const awardRes = await awardRfq(selectedRfq.id, awardsArray);
                if (awardRes.success) {
                  const poRes = await raisePoFromAward(selectedRfq.id, poPreflightDetails);
                  if (poRes.success) {
                    alert("RFQ Awarded and POs raised successfully!");
                    setIsCompOpen(false);
                    sessionStorage.setItem("requisitions_active_tab", "rfq");
                    window.location.reload();
                  } else {
                    alert("RFQ Awarded, but failed to raise POs: " + poRes.error);
                  }
                } else {
                  alert("Failed to award RFQ: " + awardRes.error);
                }
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
                <select
                  onChange={(e) => setPoPreflightDetails(prev => ({ ...prev, shipTo: e.target.value }))}
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none mb-2 font-semibold text-onyx"
                >
                  {shipToLocations.length > 0 ? (
                    shipToLocations.map(loc => (
                      <option key={loc.id} value={`${loc.name} (${loc.address})`}>
                        [{loc.code}] {loc.name} ({loc.address.slice(0, 30)}...)
                      </option>
                    ))
                  ) : (
                    <option value="">No predefined ship-to locations found</option>
                  )}
                </select>
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
    </div>
  );
}
