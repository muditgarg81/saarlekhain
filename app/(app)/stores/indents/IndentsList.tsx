"use client";

import { useState } from "react";
import { 
  createIndent, 
  updateIndent,
  submitIndent, 
  approveIndent, 
  rejectIndent, 
  issueMaterialAgainstIndent,
  convertShortageToPr,
  convertMultipleIndentsToPR
} from "@/app/actions/indents";
import { limitYearTo4Digits } from "@/lib/date";
import { SearchableItemSelect } from "@/components/SearchableItemSelect";
import { 
  Search, 
  Plus, 
  X, 
  Trash2, 
  ClipboardList, 
  Check, 
  XCircle, 
  Truck, 
  RefreshCw, 
  ArrowRight,
  Eye,
  Building2,
  AlertTriangle,
  Edit3
} from "lucide-react";

interface IndentLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  issuedQty: number;
  stockQty: number;
  requiredBy: string | null;
  remarks: string | null;
}

interface Indent {
  id: string;
  number: string;
  priority: string;
  purpose: string | null;
  status: string;
  requestedBy: string;
  department: string | null;
  deptId?: string | null;
  createdAt: string;
  lines: IndentLine[];
}

interface Item {
  id: string;
  code: string;
  name: string;
  baseUom: string;
}

interface Store {
  id: string;
  name: string;
  code: string;
}

interface Department {
  id: string;
  name: string;
}

interface IndentsListProps {
  initialIndents: Indent[];
  items: Item[];
  stores: Store[];
  departments: Department[];
  userRole: string;
}

export default function IndentsList({ initialIndents, items, stores, departments, userRole }: IndentsListProps) {
  const [indents, setIndents] = useState<Indent[]>(initialIndents);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIndentIds, setSelectedIndentIds] = useState<string[]>([]);
  const [isBulkAddOpen, setIsBulkAddOpen] = useState(false);
  const [bulkSearch, setBulkSearch] = useState("");
  const [selectedBulkItemIds, setSelectedBulkItemIds] = useState<string[]>([]);

  // Detail & Action States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [selectedIndent, setSelectedIndent] = useState<Indent | null>(null);
  const [editingIndentId, setEditingIndentId] = useState<string | null>(null);

  // New Indent Form State
  const [newIndent, setNewIndent] = useState({
    priority: "NORMAL",
    purpose: "",
    deptId: "",
    lines: [] as { itemId: string; qty: number; remarks: string; requiredBy: string }[],
  });

  const handleOpenEdit = (indent: Indent) => {
    setErrorMsg(null);
    setEditingIndentId(indent.id);
    setNewIndent({
      priority: indent.priority,
      purpose: indent.purpose || "",
      deptId: indent.deptId || "",
      lines: indent.lines.map(line => ({
        itemId: line.itemId,
        qty: line.qty,
        remarks: line.remarks || "",
        requiredBy: line.requiredBy ? new Date(line.requiredBy).toISOString().split("T")[0] : ""
      }))
    });
    setIsCreateOpen(true);
  };

  const handleOpenCreate = () => {
    setErrorMsg(null);
    setEditingIndentId(null);
    setNewIndent({
      priority: "NORMAL",
      purpose: "",
      deptId: "",
      lines: []
    });
    setNewLineItem({ itemId: "", qty: 1, remarks: "", requiredBy: "" });
    setIsCreateOpen(true);
  };

  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    setEditingIndentId(null);
    setNewIndent({
      priority: "NORMAL",
      purpose: "",
      deptId: "",
      lines: []
    });
    setNewLineItem({ itemId: "", qty: 1, remarks: "", requiredBy: "" });
  };

  const [newLineItem, setNewLineItem] = useState({ itemId: "", qty: 1, remarks: "", requiredBy: "" });

  // Issue Form State
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [deptId, setDeptId] = useState("");
  const [lineIssues, setLineIssues] = useState<{ [lineId: string]: number }>({});
  
  // Loading/Error states
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = ["ADMIN", "OWNER"].includes(userRole);
  const isStore = ["STORE_MANAGER", "STORE_KEEPER", "ADMIN", "OWNER"].includes(userRole);
  const isApprover = ["ADMIN", "OWNER", "STORE_MANAGER", "APPROVER"].includes(userRole);

  const filteredIndents = indents.filter(ind => {
    const matchesSearch = ind.number.toLowerCase().includes(search.toLowerCase()) || 
                          (ind.purpose?.toLowerCase() || "").includes(search.toLowerCase()) ||
                          ind.requestedBy.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || ind.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // New Indent Handlers
  const addLineItem = () => {
    if (!newLineItem.itemId) return;
    const selectedItem = items.find(i => i.id === newLineItem.itemId);
    if (!selectedItem) return;

    // Check if item already exists
    const alreadyExists = newIndent.lines.some(l => l.itemId === newLineItem.itemId);
    if (alreadyExists) {
      alert("Item is already added. You can edit its quantity inline in the table.");
      return;
    }

    setNewIndent(prev => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          itemId: newLineItem.itemId,
          qty: newLineItem.qty,
          remarks: newLineItem.remarks,
          requiredBy: newLineItem.requiredBy || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        }
      ]
    }));
    setNewLineItem({ itemId: "", qty: 1, remarks: "", requiredBy: "" });
  };

  const removeLineItem = (index: number) => {
    setNewIndent(prev => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== index)
    }));
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    setNewIndent(prev => {
      const updatedLines = [...prev.lines];
      updatedLines[index] = {
        ...updatedLines[index],
        [field]: value
      };
      return { ...prev, lines: updatedLines };
    });
  };

  const toggleSelectIndent = (id: string) => {
    setSelectedIndentIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllIndents = () => {
    const convertibleIndents = filteredIndents.filter(ind => 
      ["APPROVED", "PARTIALLY_ISSUED"].includes(ind.status)
    );
    if (selectedIndentIds.length === convertibleIndents.length) {
      setSelectedIndentIds([]);
    } else {
      setSelectedIndentIds(convertibleIndents.map(ind => ind.id));
    }
  };

  const handleBulkConvertToPR = async () => {
    if (selectedIndentIds.length === 0) return;
    setActionLoading(true);
    const res = await convertMultipleIndentsToPR(selectedIndentIds);
    setActionLoading(false);

    if (res.success) {
      setSelectedIndentIds([]);
      window.location.reload();
    } else {
      alert(`Action failed: ${res.error}`);
    }
  };

  const handleCreateIndent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newIndent.lines.length === 0) {
      alert("Please add at least one line item");
      return;
    }
    setActionLoading(true);
    let res;
    if (editingIndentId) {
      res = await updateIndent(editingIndentId, {
        priority: newIndent.priority,
        purpose: newIndent.purpose,
        deptId: newIndent.deptId,
        lines: newIndent.lines,
      });
    } else {
      res = await createIndent({
        priority: newIndent.priority,
        purpose: newIndent.purpose,
        deptId: newIndent.deptId,
        lines: newIndent.lines,
      });
    }
    setActionLoading(false);

    if (res.success) {
      setIsCreateOpen(false);
      setEditingIndentId(null);
      window.location.reload();
    } else {
      alert("Failed to " + (editingIndentId ? "update" : "create") + ": " + res.error);
    }
  };

  // State workflow mutations
  const handleWorkflowAction = async (action: "submit" | "approve" | "reject" | "convert_pr", indent: Indent) => {
    setActionLoading(true);
    let res: any;
    if (action === "submit") res = await submitIndent(indent.id);
    else if (action === "approve") res = await approveIndent(indent.id);
    else if (action === "reject") res = await rejectIndent(indent.id);
    else if (action === "convert_pr") res = await convertShortageToPr(indent.id);
    setActionLoading(false);

    if (res.success) {
      window.location.reload();
    } else {
      alert(`Action failed: ${res.error}`);
    }
  };

  const handleOpenIssue = (indent: Indent) => {
    setSelectedIndent(indent);
    setSelectedStoreId(stores[0]?.id || "");
    setIssuedTo("");
    setDeptId(indent.deptId || "");
    const initialIssues: { [lineId: string]: number } = {};
    indent.lines.forEach(l => {
      initialIssues[l.id] = l.qty - l.issuedQty;
    });
    setLineIssues(initialIssues);
    setIsIssueOpen(true);
  };

  const handlePostIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIndent) return;

    const issuesPayload = Object.keys(lineIssues).map(lineId => {
      const line = selectedIndent.lines.find(l => l.id === lineId);
      return {
        lineId,
        itemId: line?.itemId || "",
        qtyToIssue: lineIssues[lineId] || 0
      };
    });

    setActionLoading(true);
    setErrorMsg(null);
    const res = await issueMaterialAgainstIndent(selectedIndent.id, selectedStoreId, issuesPayload, issuedTo, deptId || null);
    setActionLoading(false);

    if (res.success) {
      setIsIssueOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to post material issue");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Internal Material Indents</h2>
          <p className="text-xs text-onyx/50 mt-1">Raise internally approved indents, issue stock, or trigger purchase orders.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleOpenCreate}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Raise Material Indent</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Search by indent no, purpose, requested by..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        {/* Status filters */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
        >
          <option value="all">All Statuses</option>
          <option value="DRAFT">Draft Only</option>
          <option value="SUBMITTED">Submitted / Pending Approval</option>
          <option value="APPROVED">Approved / Ready to Issue</option>
          <option value="REJECTED">Rejected</option>
          <option value="PARTIALLY_ISSUED">Partially Issued</option>
          <option value="ISSUED">Fully Issued</option>
          <option value="CONVERTED_TO_PR">Converted to Purchase (PR)</option>
        </select>

        {/* Bulk convert to PR button */}
        {selectedIndentIds.length > 0 && (
          <button
            type="button"
            onClick={handleBulkConvertToPR}
            disabled={actionLoading}
            className="w-full md:w-auto px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer animate-in fade-in duration-200"
          >
            <ArrowRight size={14} />
            <span>Convert to Single PR ({selectedIndentIds.length})</span>
          </button>
        )}
      </div>

      {/* Indents Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredIndents.length > 0 && selectedIndentIds.length === filteredIndents.filter(ind => ["APPROVED", "PARTIALLY_ISSUED"].includes(ind.status)).length}
                    onChange={toggleSelectAllIndents}
                    className="rounded text-saffron focus:ring-saffron"
                  />
                </th>
                <th>Indent No</th>
                <th>Requested By</th>
                <th>Department</th>
                <th>Priority</th>
                <th>Purpose</th>
                <th className="text-center font-bold">Lines</th>
                <th>Date Raised</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredIndents.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-onyx/40 font-medium">
                    No material indents found.
                  </td>
                </tr>
              ) : (
                filteredIndents.map((ind) => {
                  return (
                    <tr key={ind.id}>
                      <td className="text-center">
                        {["APPROVED", "PARTIALLY_ISSUED"].includes(ind.status) ? (
                          <input
                            type="checkbox"
                            checked={selectedIndentIds.includes(ind.id)}
                            onChange={() => toggleSelectIndent(ind.id)}
                            className="rounded text-saffron focus:ring-saffron"
                          />
                        ) : (
                          <div className="w-4 h-4 mx-auto border border-dashed border-onyx/10 rounded-sm bg-onyx/5" title="Only Approved or Partially Issued indents can be converted" />
                        )}
                      </td>
                      <td className="font-mono font-bold text-xs text-onyx/85">{ind.number}</td>
                      <td className="font-semibold">{ind.requestedBy}</td>
                      <td>{ind.department || "N/A"}</td>
                      <td>
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          ind.priority === "URGENT" 
                            ? "bg-red-100 text-red-800" 
                            : (ind.priority === "HIGH" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800")
                        }`}>
                          {ind.priority}
                        </span>
                      </td>
                      <td className="truncate max-w-[150px]">{ind.purpose || "N/A"}</td>
                      <td className="text-center font-semibold">{ind.lines.length} items</td>
                      <td suppressHydrationWarning>{new Date(ind.createdAt).toLocaleDateString()}</td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          ind.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                          ind.status === "SUBMITTED" ? "bg-yellow-100 text-yellow-800" :
                          ind.status === "APPROVED" ? "bg-green-100 text-green-800" :
                          ind.status === "REJECTED" ? "bg-red-100 text-red-800" :
                          ind.status === "PARTIALLY_ISSUED" ? "bg-orange-100 text-orange-800 animate-pulse" :
                          ind.status === "ISSUED" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                        }`}>
                          {ind.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => {
                              setSelectedIndent(ind);
                              setIsDetailOpen(true);
                            }}
                            title="View Items"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx"
                            type="button"
                          >
                            <Eye size={13} />
                          </button>

                          {ind.status === "DRAFT" && (
                            <>
                              <button
                                onClick={() => handleOpenEdit(ind)}
                                title="Edit Indent"
                                className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                                type="button"
                              >
                                <Edit3 size={13} />
                              </button>
                              <button
                                onClick={() => handleWorkflowAction("submit", ind)}
                                title="Submit for Approval"
                                className="p-1 hover:bg-yellow-50 text-yellow-600 hover:text-yellow-700 rounded border border-transparent hover:border-yellow-200 cursor-pointer"
                                type="button"
                              >
                                <RefreshCw size={13} />
                              </button>
                            </>
                          )}

                          {ind.status === "SUBMITTED" && isApprover && (
                            <>
                              <button
                                onClick={() => handleWorkflowAction("approve", ind)}
                                title="Approve"
                                className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200"
                                type="button"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={() => handleWorkflowAction("reject", ind)}
                                title="Reject"
                                className="p-1 hover:bg-red-50 text-red-600 hover:text-red-700 rounded border border-transparent hover:border-red-200"
                                type="button"
                              >
                                <XCircle size={13} />
                              </button>
                            </>
                          )}

                          {["APPROVED", "PARTIALLY_ISSUED"].includes(ind.status) && isStore && (
                            <>
                              <button
                                onClick={() => handleOpenIssue(ind)}
                                title="Issue Material"
                                className="p-1 hover:bg-blue-50 text-blue-600 hover:text-blue-700 rounded border border-transparent hover:border-blue-200"
                                type="button"
                              >
                                <Truck size={13} />
                              </button>
                              <button
                                onClick={() => handleWorkflowAction("convert_pr", ind)}
                                title="Convert Shortages to PR"
                                className="p-1 hover:bg-purple-50 text-purple-600 hover:text-purple-700 rounded border border-transparent hover:border-purple-200"
                                type="button"
                              >
                                <ArrowRight size={13} />
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

      {/* Raise Indent Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">{editingIndentId ? "Edit Material Requisition Indent" : "Raise Material Requisition Indent"}</h3>
              <button onClick={handleCloseCreate} className="hover:text-saffron transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateIndent} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Header Details */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Indent Priority
                  </label>
                  <select
                    value={newIndent.priority}
                    onChange={(e) => setNewIndent(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Department
                  </label>
                  <select
                    value={newIndent.deptId}
                    onChange={(e) => setNewIndent(prev => ({ ...prev, deptId: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="">Select Department (Default)</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Requisition Purpose / Remarks
                  </label>
                  <input
                    type="text"
                    value={newIndent.purpose}
                    onChange={(e) => setNewIndent(prev => ({ ...prev, purpose: e.target.value }))}
                    placeholder="e.g. Monthly maintenance setup, production batch 42"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              {/* Add Lines Panel */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Line Item</h4>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBulkItemIds([]);
                      setIsBulkAddOpen(true);
                    }}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center space-x-1 cursor-pointer border border-transparent hover:underline"
                  >
                    <span>+ Bulk Select Items</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-6">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                    <SearchableItemSelect
                      items={items}
                      value={newLineItem.itemId}
                      onChange={(val) => setNewLineItem(prev => ({ ...prev, itemId: val }))}
                      placeholder="Select Item"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Qty *</label>
                    <input
                      type="number"
                      value={newLineItem.qty}
                      onChange={(e) => setNewLineItem(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Date Needed</label>
                    <input
                      type="date"
                      value={newLineItem.requiredBy}
                      onChange={(e) => setNewLineItem(prev => ({ ...prev, requiredBy: limitYearTo4Digits(e.target.value) }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={addLineItem}
                      className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer border border-transparent shadow-sm"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Lines Table */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Line Items Added ({newIndent.lines.length})
                </label>
                {newIndent.lines.length === 0 ? (
                  <p className="text-center py-4 bg-white border border-dashed border-onyx/10 text-xs text-onyx/40 font-medium rounded-lg">
                    No items added yet. Use the panel above to add items.
                  </p>
                ) : (
                  <div className="border border-onyx/5 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse bg-white">
                      <thead className="bg-cream-dark/50">
                        <tr>
                          <th className="p-2 font-bold uppercase">Item</th>
                          <th className="p-2 font-bold uppercase text-right w-24">Qty</th>
                          <th className="p-2 font-bold uppercase w-36">Date Needed</th>
                          <th className="p-2 font-bold uppercase">Remarks</th>
                          <th className="p-2 font-bold text-center w-16">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newIndent.lines.map((line, idx) => {
                          const item = items.find(i => i.id === line.itemId);
                          return (
                            <tr key={idx} className="border-t border-onyx/5">
                              <td className="p-2">
                                <div className="font-semibold text-onyx">[{item?.code}] {item?.name}</div>
                              </td>
                              <td className="p-2 text-right">
                                <div className="flex items-center justify-end space-x-1">
                                  <input
                                    type="number"
                                    min="0.01"
                                    step="any"
                                    value={line.qty}
                                    onChange={(e) => updateLineItem(idx, "qty", parseFloat(e.target.value) || 0)}
                                    className="w-16 p-1 border border-onyx/10 rounded font-mono font-bold text-right text-xs focus:outline-none focus:border-saffron"
                                  />
                                  <span className="text-[10px] text-onyx/40">{item?.baseUom}</span>
                                </div>
                              </td>
                              <td className="p-2">
                                <input
                                  type="date"
                                  value={line.requiredBy}
                                  onChange={(e) => updateLineItem(idx, "requiredBy", limitYearTo4Digits(e.target.value))}
                                  className="w-full p-1 border border-onyx/10 rounded text-xs focus:outline-none focus:border-saffron"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  placeholder="Add remarks..."
                                  value={line.remarks}
                                  onChange={(e) => updateLineItem(idx, "remarks", e.target.value)}
                                  className="w-full p-1 border border-onyx/10 rounded text-xs focus:outline-none focus:border-saffron"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeLineItem(idx)}
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
                  onClick={handleCloseCreate}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || newIndent.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving..." : editingIndentId ? "Save Changes" : "Save Draft Indent"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Indent Details Side Drawer */}
      {isDetailOpen && selectedIndent && (
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
                {selectedIndent.number}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                Material Requisition Detail
              </h3>
              <p className="text-xs text-onyx/50">Purpose: {selectedIndent.purpose || "N/A"}</p>
            </div>

            {/* Content info block */}
            <div className="py-4 grid grid-cols-2 gap-4 text-xs border-b border-onyx/5 bg-cream-dark/20 p-3 rounded-lg mt-4">
              <div>
                <span className="font-semibold text-onyx/50">Requested By:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedIndent.requestedBy}</p>
              </div>
              <div>
                <span className="font-semibold text-onyx/50">Department:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedIndent.department || "N/A"}</p>
              </div>
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto py-6 space-y-4">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                Requested Materials List
              </h4>

              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50">
                    <tr>
                      <th className="p-2 font-bold">Item Description</th>
                      <th className="p-2 font-bold text-right">Qty</th>
                      <th className="p-2 font-bold text-right">Qty in Stock</th>
                      <th className="p-2 font-bold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedIndent.lines.map((line) => (
                      <tr key={line.id} className="border-t border-onyx/5">
                        <td className="p-2">
                          <p className="font-semibold text-onyx">[{line.itemCode}] {line.itemName}</p>
                        </td>
                        <td className="p-2 text-right font-mono font-bold">{line.qty}</td>
                        <td className="p-2 text-right font-mono font-bold text-blue-700">{line.stockQty}</td>
                        <td className="p-2 text-onyx/60 text-[10px]">{line.remarks || "-"}</td>
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

      {/* Material Issue Modal */}
      {isIssueOpen && selectedIndent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Post Material Issue ({selectedIndent.number})</h3>
              <button onClick={() => setIsIssueOpen(false)} className="hover:text-saffron transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handlePostIssue} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Source Warehouse */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Issue Source Store/Warehouse *
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                    <Building2 size={16} />
                  </span>
                  <select
                    value={selectedStoreId}
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                    className="w-full text-xs pl-10 pr-4 py-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                    required
                  >
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Recipient Department */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Recipient Department
                </label>
                <select
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                >
                  <option value="">Select Department (Optional)</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Issued To (Employee/Receiver) */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Issued To (Employee / Receiver Name)
                </label>
                <input
                  type="text"
                  value={issuedTo}
                  onChange={(e) => setIssuedTo(e.target.value)}
                  placeholder="Enter receiver's name"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              {/* Issue Line Items Quantities */}
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Specify Qty to Issue
                </label>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-3 font-bold">Item Description</th>
                        <th className="p-3 font-bold text-right">Remaining</th>
                        <th className="p-3 font-bold text-center w-28">Issue Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedIndent.lines.map((line) => {
                        const remaining = line.qty - line.issuedQty;
                        return (
                          <tr key={line.id} className="border-t border-onyx/5">
                            <td className="p-3">
                              <p className="font-semibold">[{line.itemCode}] {line.itemName}</p>
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-onyx/60">
                              {remaining}
                            </td>
                            <td className="p-3 text-center">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max={remaining}
                                value={lineIssues[line.id] || 0}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setLineIssues(prev => ({
                                    ...prev,
                                    [line.id]: Math.min(val, remaining)
                                  }));
                                }}
                                className="w-full text-xs p-1.5 border border-onyx/15 rounded text-center font-mono font-bold focus:outline-none focus:border-saffron"
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
                  onClick={() => setIsIssueOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Posting Issue..." : "Post Issue & Update Ledger"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Add Items Modal Overlay */}
      {isBulkAddOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-md w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-5 py-3 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h4 className="font-heading text-sm font-bold">Bulk Select Items</h4>
              <button type="button" onClick={() => setIsBulkAddOpen(false)} className="hover:text-saffron cursor-pointer text-cream-light">
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 border-b border-onyx/5">
              <input
                type="text"
                placeholder="Search items by code or name..."
                value={bulkSearch}
                onChange={(e) => setBulkSearch(e.target.value)}
                className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
              />
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {items
                .filter(item => 
                  item.code.toLowerCase().includes(bulkSearch.toLowerCase()) ||
                  item.name.toLowerCase().includes(bulkSearch.toLowerCase())
                )
                .map(item => {
                  const isAlreadyAdded = newIndent.lines.some(l => l.itemId === item.id);
                  return (
                    <label key={item.id} className={`flex items-center space-x-3 p-2 rounded-lg border transition cursor-pointer select-none text-xs ${
                      isAlreadyAdded ? "bg-cream-dark/40 border-onyx/10 opacity-70" : "bg-white hover:bg-cream-dark/15 border-onyx/5"
                    }`}>
                      <input
                        type="checkbox"
                        disabled={isAlreadyAdded}
                        checked={isAlreadyAdded || selectedBulkItemIds.includes(item.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBulkItemIds(prev => [...prev, item.id]);
                          } else {
                            setSelectedBulkItemIds(prev => prev.filter(id => id !== item.id));
                          }
                        }}
                        className="rounded text-saffron focus:ring-saffron w-4 h-4 disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <span className="font-mono font-bold text-onyx/80">[{item.code}]</span>{" "}
                        <span className="font-semibold text-onyx">{item.name}</span>
                        {isAlreadyAdded && <span className="text-[10px] text-green-700 font-semibold ml-2">(Added)</span>}
                      </div>
                    </label>
                  );
                })}
            </div>
            
            <div className="p-4 border-t border-onyx/5 flex items-center justify-end space-x-2 bg-cream-dark/10">
              <button
                type="button"
                onClick={() => {
                  setIsBulkAddOpen(false);
                  setSelectedBulkItemIds([]);
                }}
                className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  // Add all selected items to lines
                  const linesToAdd = selectedBulkItemIds.map(id => ({
                    itemId: id,
                    qty: 1,
                    remarks: "",
                    requiredBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // default 1 week
                  }));
                  setNewIndent(prev => ({
                    ...prev,
                    lines: [...prev.lines, ...linesToAdd]
                  }));
                  setSelectedBulkItemIds([]);
                  setIsBulkAddOpen(false);
                }}
                disabled={selectedBulkItemIds.length === 0}
                className="px-4 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs shadow-md cursor-pointer disabled:opacity-50"
              >
                Add Selected ({selectedBulkItemIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
