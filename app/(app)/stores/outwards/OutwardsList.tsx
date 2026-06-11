"use client";

import { useState } from "react";
import { 
  createGatePass, 
  returnGatePassMaterial,
  updateGatePass,
  deleteGatePass,
  bulkDeleteGatePasses
} from "@/app/actions/gatepasses";
import {
  createDirectIssue,
  updateIssue,
  deleteIssue,
  bulkDeleteIssues
} from "@/app/actions/indents";
import { limitYearTo4Digits } from "@/lib/date";
import { 
  Search, 
  Plus, 
  X, 
  Trash2, 
  FileText, 
  Truck, 
  RefreshCw, 
  ArrowRight,
  Eye,
  Building2,
  CheckCircle,
  AlertCircle,
  Printer,
  Download,
  Edit,
  CheckSquare,
  Square
} from "lucide-react";

interface LineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  returnedQty?: number;
}

interface IssueRecord {
  id: string;
  number: string;
  type: string;
  storeName: string;
  deptName: string | null;
  deptId?: string | null;
  issuedTo?: string | null;
  indentNumber: string | null;
  postedBy: string;
  postedAt: string;
  lines: LineItem[];
}

interface GatePassRecord {
  id: string;
  number: string;
  type: string;
  status: string;
  vendorName: string | null;
  purpose: string | null;
  dueBack: string | null;
  createdAt: string;
  lines: LineItem[];
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

interface Store {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
}

interface OutwardsListProps {
  issues: IssueRecord[];
  gatePasses: GatePassRecord[];
  items: Item[];
  vendors: Vendor[];
  stores: Store[];
  departments: Department[];
  userRole: string;
}

export default function OutwardsList({
  issues,
  gatePasses,
  items,
  vendors,
  stores,
  departments,
  userRole
}: OutwardsListProps) {
  const [activeTab, setActiveTab] = useState<"issues" | "gatepasses">("issues");
  const [search, setSearch] = useState("");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals & Drawer States
  const [isCreateGpOpen, setIsCreateGpOpen] = useState(false);
  const [isCreateIssueOpen, setIsCreateIssueOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [selectedGp, setSelectedGp] = useState<GatePassRecord | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<IssueRecord | null>(null);

  // New Direct Issue Form State
  const [newDirectIssue, setNewDirectIssue] = useState({
    storeId: "",
    deptId: "",
    issuedTo: "",
    lines: [] as { itemId: string; qty: number }[]
  });
  const [newIssueLine, setNewIssueLine] = useState({ itemId: "", qty: 1 });

  // Edit States
  const [isEditIssueOpen, setIsEditIssueOpen] = useState(false);
  const [isEditGpOpen, setIsEditGpOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const [editIssueForm, setEditIssueForm] = useState<{
    id: string;
    number: string;
    storeId: string;
    deptId: string;
    issuedTo: string;
    lines: { id: string; itemId: string; itemName: string; itemCode: string; qty: number }[];
  } | null>(null);

  const [editGpForm, setEditGpForm] = useState<{
    id: string;
    number: string;
    type: "RETURNABLE" | "NON_RETURNABLE";
    vendorId: string;
    purpose: string;
    dueBack: string;
    lines: { itemId: string; qty: number }[];
  } | null>(null);

  const [editGpNewLine, setEditGpNewLine] = useState({ itemId: "", qty: 1 });

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Toggle select all
  const handleToggleSelectAll = () => {
    const currentFilteredIds = activeTab === "issues" 
      ? filteredIssues.map(i => i.id) 
      : filteredGatePasses.map(g => g.id);
    const allSelected = currentFilteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !currentFilteredIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...currentFilteredIds])));
    }
  };

  // Delete handlers
  const handleDeleteIssue = async (id: string) => {
    if (!confirm("Are you sure you want to delete this material issue? This will revert inventory stock ledger quantities and indent statuses.")) return;
    setActionLoading(true);
    const res = await deleteIssue(id);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert("Failed to delete issue: " + res.error);
    }
  };

  const handleDeleteGp = async (id: string) => {
    if (!confirm("Are you sure you want to delete this gate pass?")) return;
    setActionLoading(true);
    const res = await deleteGatePass(id);
    setActionLoading(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert("Failed to delete gate pass: " + res.error);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const tabLabel = activeTab === "issues" ? "material issues" : "gate passes";
    if (!confirm(`Are you sure you want to delete the ${count} selected ${tabLabel}? This will revert any stock entries and parent indents.`)) return;

    setActionLoading(true);
    const res = activeTab === "issues"
      ? await bulkDeleteIssues(selectedIds)
      : await bulkDeleteGatePasses(selectedIds);
    setActionLoading(false);

    if (res.success) {
      setSelectedIds([]);
      window.location.reload();
    } else {
      alert(`Failed to delete selected ${tabLabel}: ` + res.error);
    }
  };

  // Bulk Export CSV
  const handleBulkExportCSV = () => {
    if (selectedIds.length === 0) return;
    let headers: string[] = [];
    let rows: string[][] = [];

    if (activeTab === "issues") {
      headers = ["Issue Number", "Source Store", "Recipient Department", "Issued To (Employee)", "Source Indent", "Items Count", "Issued By", "Date Issued", "Items Details"];
      const selectedIssues = issues.filter(iss => selectedIds.includes(iss.id));
      rows = selectedIssues.map(iss => [
        iss.number,
        iss.storeName,
        iss.deptName || "N/A",
        iss.issuedTo || "N/A",
        iss.indentNumber || "-",
        iss.lines.length.toString(),
        iss.postedBy,
        new Date(iss.postedAt).toLocaleDateString(),
        iss.lines.map(l => `[${l.itemCode}] ${l.itemName}: ${l.qty}`).join(" | ")
      ]);
    } else {
      headers = ["Gatepass Number", "Type", "Custodian/Vendor", "Purpose", "Items Count", "Date Issued", "Due Back", "Status", "Items Details"];
      const selectedGps = gatePasses.filter(gp => selectedIds.includes(gp.id));
      rows = selectedGps.map(gp => [
        gp.number,
        gp.type,
        gp.vendorName || "N/A",
        gp.purpose || "-",
        gp.lines.length.toString(),
        new Date(gp.createdAt).toLocaleDateString(),
        gp.dueBack ? new Date(gp.dueBack).toLocaleDateString() : "-",
        gp.status,
        gp.lines.map(l => `[${l.itemCode}] ${l.itemName}: ${l.qty} (Returned: ${l.returnedQty || 0})`).join(" | ")
      ]);
    }

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => `"${(val || "").replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const prefix = activeTab === "issues" ? "MaterialIssues" : "GatePasses";
    link.setAttribute("download", `${prefix}_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print handler
  const handlePrint = (type: "issue" | "gp", record: any) => {
    let printContent = "";
    if (type === "issue") {
      const issue = record as IssueRecord;
      printContent = `
        <div style="border: 4px double #131313; padding: 20px; font-family: sans-serif; box-sizing: border-box; width: 100%; height: 100%;">
          <div style="text-align: center; border-bottom: 2px solid #131313; padding-bottom: 10px; margin-bottom: 20px;">
            <h2 style="margin: 0; font-family: serif; text-transform: uppercase; letter-spacing: 1px;">Saarlekha Stores & Purchase</h2>
            <p style="margin: 5px 0 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #555;">Department Material Issue Slip</p>
          </div>
          
          <table style="width: 100%; margin-bottom: 20px; font-size: 12px; border-collapse: collapse;">
            <tr>
              <td style="width: 50%; padding: 4px 0;"><strong>Issue Slip No:</strong> ${issue.number}</td>
              <td style="width: 50%; padding: 4px 0; text-align: right;"><strong>Date Issued:</strong> ${new Date(issue.postedAt).toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong>Source Warehouse:</strong> ${issue.storeName}</td>
              <td style="padding: 4px 0; text-align: right;"><strong>Recipient Department:</strong> ${issue.deptName || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong>Source Indent Ref:</strong> ${issue.indentNumber || "-"}</td>
              <td style="padding: 4px 0; text-align: right;"><strong>Issued To (Employee):</strong> ${issue.issuedTo || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong>Issued By:</strong> ${issue.postedBy}</td>
              <td style="padding: 4px 0; text-align: right;"></td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 40px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #131313; padding: 8px; text-align: left;">S.No</th>
                <th style="border: 1px solid #131313; padding: 8px; text-align: left;">Item Code</th>
                <th style="border: 1px solid #131313; padding: 8px; text-align: left;">Item Description</th>
                <th style="border: 1px solid #131313; padding: 8px; text-align: right;">Issued Qty</th>
              </tr>
            </thead>
            <tbody>
              ${issue.lines.map((l, index) => `
                <tr>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${index + 1}</td>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${l.itemCode}</td>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${l.itemName}</td>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: right; font-weight: bold;">${l.qty}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div style="margin-top: 60px; font-size: 12px; display: flex; justify-content: space-between;">
            <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Prepared By</div>
            <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Issued By</div>
            <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Receiver's Signature</div>
          </div>
        </div>
      `;
    } else {
      const gp = record as GatePassRecord;
      printContent = `
        <div style="border: 4px double #131313; padding: 20px; font-family: sans-serif; box-sizing: border-box; width: 100%; height: 100%;">
          <div style="text-align: center; border-bottom: 2px solid #131313; padding-bottom: 10px; margin-bottom: 20px;">
            <h2 style="margin: 0; font-family: serif; text-transform: uppercase; letter-spacing: 1px;">Saarlekha Stores & Purchase</h2>
            <p style="margin: 5px 0 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #555;">Material Gate Pass (${gp.type})</p>
          </div>
          
          <table style="width: 100%; margin-bottom: 20px; font-size: 12px; border-collapse: collapse;">
            <tr>
              <td style="width: 50%; padding: 4px 0;"><strong>Gatepass No:</strong> ${gp.number}</td>
              <td style="width: 50%; padding: 4px 0; text-align: right;"><strong>Date Issued:</strong> ${new Date(gp.createdAt).toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong>Destination/Custodian:</strong> ${gp.vendorName || "N/A"}</td>
              <td style="padding: 4px 0; text-align: right;"><strong>Purpose:</strong> ${gp.purpose || "-"}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong>Due Back Date:</strong> ${gp.dueBack ? new Date(gp.dueBack).toLocaleDateString() : "N/A"}</td>
              <td style="padding: 4px 0; text-align: right;"><strong>Status:</strong> <span style="text-transform: uppercase; font-weight: bold;">${gp.status.replace("_", " ")}</span></td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 40px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #131313; padding: 8px; text-align: left;">S.No</th>
                <th style="border: 1px solid #131313; padding: 8px; text-align: left;">Item Code</th>
                <th style="border: 1px solid #131313; padding: 8px; text-align: left;">Item Description</th>
                <th style="border: 1px solid #131313; padding: 8px; text-align: right;">Issued Qty</th>
                ${gp.type === "RETURNABLE" ? `<th style="border: 1px solid #131313; padding: 8px; text-align: right; color: green;">Returned Qty</th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${gp.lines.map((l, index) => `
                <tr>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${index + 1}</td>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${l.itemCode}</td>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: left;">${l.itemName}</td>
                  <td style="border: 1px solid #131313; padding: 8px; text-align: right; font-weight: bold;">${l.qty}</td>
                  ${gp.type === "RETURNABLE" ? `<td style="border: 1px solid #131313; padding: 8px; text-align: right; font-weight: bold; color: green;">${l.returnedQty || 0}</td>` : ""}
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div style="margin-top: 60px; font-size: 12px; display: flex; justify-content: space-between;">
            <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Gate Keeper Sign</div>
            <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Authorized By</div>
            <div style="border-top: 1px solid #131313; width: 120px; text-align: center; padding-top: 5px;">Receiver's Signature</div>
          </div>
        </div>
      `;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to print the slip");
      return;
    }
    printWindow.document.write(
      "<html>" +
        "<head>" +
          "<title>" + (type === "issue" ? "Material Issue Slip" : "Gate Pass") + " - " + record.number + "</title>" +
          "<style>" +
            "@page { size: A4; margin: 10mm; }" +
            "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: white; }" +
          "</style>" +
        "</head>" +
        "<body>" +
          "<div style=\"width: 170mm; height: 250mm; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; margin: auto; padding: 20px;\">" +
            printContent +
          "</div>" +
          "<script>" +
            "window.onload = function() { window.print(); window.close(); };" +
          "</script>" +
        "</body>" +
      "</html>"
    );
    printWindow.document.close();
  };

  // Edit Issue Handlers
  const handleOpenEditIssue = (iss: IssueRecord) => {
    setEditIssueForm({
      id: iss.id,
      number: iss.number,
      storeId: stores.find(s => s.name === iss.storeName)?.id || "",
      deptId: iss.deptId || "",
      issuedTo: iss.issuedTo || "",
      lines: iss.lines.map(l => ({
        id: l.id,
        itemId: l.itemId,
        itemName: l.itemName,
        itemCode: l.itemCode,
        qty: l.qty
      }))
    });
    setIsEditIssueOpen(true);
  };

  const handleSaveEditIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editIssueForm) return;

    if (editIssueForm.lines.length === 0) {
      alert("Issue must contain at least one line item");
      return;
    }

    setActionLoading(true);
    const res = await updateIssue(editIssueForm.id, {
      storeId: editIssueForm.storeId,
      deptId: editIssueForm.deptId || null,
      issuedTo: editIssueForm.issuedTo || null,
      lines: editIssueForm.lines.map(l => ({
        itemId: l.itemId,
        qty: l.qty
      }))
    });
    setActionLoading(false);

    if (res.success) {
      setIsEditIssueOpen(false);
      window.location.reload();
    } else {
      alert("Failed to update issue: " + res.error);
    }
  };

  // Edit GP Handlers
  const handleOpenEditGp = (gp: GatePassRecord) => {
    setEditGpForm({
      id: gp.id,
      number: gp.number,
      type: gp.type as any,
      vendorId: vendors.find(v => v.name === gp.vendorName)?.id || "",
      purpose: gp.purpose || "",
      dueBack: gp.dueBack ? gp.dueBack.split("T")[0] : "",
      lines: gp.lines.map(l => ({
        itemId: l.itemId,
        qty: l.qty
      }))
    });
    setIsEditGpOpen(true);
  };

  const handleSaveEditGp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGpForm) return;

    if (editGpForm.lines.length === 0) {
      alert("Gate Pass must contain at least one line item");
      return;
    }

    setActionLoading(true);
    const res = await updateGatePass(editGpForm.id, {
      type: editGpForm.type,
      vendorId: editGpForm.vendorId || null,
      purpose: editGpForm.purpose || null,
      dueBack: editGpForm.type === "RETURNABLE" ? editGpForm.dueBack : null,
      lines: editGpForm.lines
    });
    setActionLoading(false);

    if (res.success) {
      setIsEditGpOpen(false);
      window.location.reload();
    } else {
      alert("Failed to update Gate Pass: " + res.error);
    }
  };

  // New Gate Pass Form State
  const [newGp, setNewGp] = useState({
    type: "RETURNABLE" as "RETURNABLE" | "NON_RETURNABLE",
    vendorId: "",
    purpose: "",
    dueBack: "",
    lines: [] as { itemId: string; qty: number }[]
  });
  const [newLineItem, setNewLineItem] = useState({ itemId: "", qty: 1 });

  // Return Form State
  const [lineReturns, setLineReturns] = useState<{ [lineId: string]: number }>({});
  
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isStore = ["STORE_MANAGER", "STORE_KEEPER", "ADMIN", "OWNER"].includes(userRole);

  // Filter lists based on search
  const filteredIssues = issues.filter(iss => 
    iss.number.toLowerCase().includes(search.toLowerCase()) ||
    (iss.deptName?.toLowerCase() || "").includes(search.toLowerCase()) ||
    (iss.issuedTo?.toLowerCase() || "").includes(search.toLowerCase()) ||
    (iss.indentNumber?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const filteredGatePasses = gatePasses.filter(gp => 
    gp.number.toLowerCase().includes(search.toLowerCase()) ||
    (gp.vendorName?.toLowerCase() || "").includes(search.toLowerCase()) ||
    (gp.purpose?.toLowerCase() || "").includes(search.toLowerCase())
  );

  // Gate Pass Line handlers
  const addGpLine = () => {
    if (!newLineItem.itemId) return;
    setNewGp(prev => ({
      ...prev,
      lines: [...prev.lines, { itemId: newLineItem.itemId, qty: newLineItem.qty }]
    }));
    setNewLineItem({ itemId: "", qty: 1 });
  };

  const removeGpLine = (index: number) => {
    setNewGp(prev => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== index)
    }));
  };

  const handleCreateGp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newGp.lines.length === 0) {
      alert("Please add at least one item line");
      return;
    }

    setActionLoading(true);
    const res = await createGatePass({
      type: newGp.type,
      vendorId: newGp.vendorId || null,
      purpose: newGp.purpose || null,
      dueBack: newGp.type === "RETURNABLE" ? newGp.dueBack : null,
      lines: newGp.lines
    });
    setActionLoading(false);

    if (res.success) {
      setIsCreateGpOpen(false);
      window.location.reload();
    } else {
      alert("Failed to create Gate Pass: " + res.error);
    }
  };

  const handleOpenReturn = (gp: GatePassRecord) => {
    setSelectedGp(gp);
    const initialReturns: { [lineId: string]: number } = {};
    gp.lines.forEach(l => {
      initialReturns[l.id] = l.qty - (l.returnedQty || 0);
    });
    setLineReturns(initialReturns);
    setErrorMsg(null);
    setIsReturnOpen(true);
  };

  const handlePostReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGp) return;

    const returnPayload = Object.keys(lineReturns).map(lineId => ({
      lineId,
      qtyReturned: lineReturns[lineId] || 0
    }));

    setActionLoading(true);
    setErrorMsg(null);
    const res = await returnGatePassMaterial(selectedGp.id, returnPayload);
    setActionLoading(false);

    if (res.success) {
      setIsReturnOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to post gate pass return");
    }
  };

  const addIssueLine = () => {
    if (!newIssueLine.itemId) return;
    if (newDirectIssue.lines.some(l => l.itemId === newIssueLine.itemId)) {
      alert("Item already added to this issue");
      return;
    }
    setNewDirectIssue(prev => ({
      ...prev,
      lines: [...prev.lines, { itemId: newIssueLine.itemId, qty: newIssueLine.qty }]
    }));
    setNewIssueLine({ itemId: "", qty: 1 });
  };

  const removeIssueLine = (index: number) => {
    setNewDirectIssue(prev => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== index)
    }));
  };

  const handleCreateDirectIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirectIssue.storeId) {
      alert("Please select a source store");
      return;
    }
    if (newDirectIssue.lines.length === 0) {
      alert("Please add at least one item line");
      return;
    }

    setActionLoading(true);
    const res = await createDirectIssue({
      storeId: newDirectIssue.storeId,
      deptId: newDirectIssue.deptId || null,
      issuedTo: newDirectIssue.issuedTo || null,
      lines: newDirectIssue.lines
    });
    setActionLoading(false);

    if (res.success) {
      setIsCreateIssueOpen(false);
      window.location.reload();
    } else {
      alert("Failed to create Direct Issue: " + res.error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Stores Outwards Register</h2>
          <p className="text-xs text-onyx/50 mt-1">Track materials leaving stores for internal departments or external job work.</p>
        </div>
        <div className="flex items-center space-x-3">
          {activeTab === "issues" && (
            <>
              <button
                onClick={() => setIsCreateIssueOpen(true)}
                className="flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-cream-dark/50 border border-onyx/10 rounded-lg text-xs font-semibold text-onyx shadow-sm transition-all duration-150 cursor-pointer"
              >
                <Plus size={15} className="text-saffron" />
                <span>Direct Issue</span>
              </button>
              <a
                href="/stores/indents"
                className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
              >
                <Plus size={15} />
                <span>Issue Against Indent</span>
              </a>
            </>
          )}
          {activeTab === "gatepasses" && (
            <button
              onClick={() => setIsCreateGpOpen(true)}
              className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
            >
              <Plus size={15} />
              <span>Issue Gate Pass</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-onyx/10">
        <button
          onClick={() => { setActiveTab("issues"); setSearch(""); setSelectedIds([]); }}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-200 cursor-pointer ${
            activeTab === "issues" 
              ? "border-saffron text-saffron-dark" 
              : "border-transparent text-onyx/50 hover:text-onyx"
          }`}
        >
          Department Issues
        </button>
        <button
          onClick={() => { setActiveTab("gatepasses"); setSearch(""); setSelectedIds([]); }}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-200 cursor-pointer ${
            activeTab === "gatepasses" 
              ? "border-saffron text-saffron-dark" 
              : "border-transparent text-onyx/50 hover:text-onyx"
          }`}
        >
          Gate Passes (Repairs & Jobwork)
        </button>
      </div>

      {/* Filter and search */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder={activeTab === "issues" ? "Search by issue number, department, indent..." : "Search by GP number, supplier, purpose..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>
      </div>

      {/* Display Registers */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          {activeTab === "issues" ? (
            /* Issues Table */
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-3 w-10 text-center">
                    <button
                      onClick={handleToggleSelectAll}
                      className="text-onyx/65 hover:text-onyx cursor-pointer"
                    >
                      {filteredIssues.length > 0 && filteredIssues.every(iss => selectedIds.includes(iss.id)) ? (
                        <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th>Issue No</th>
                  <th>Source Store</th>
                  <th>Recipient Dept</th>
                  <th>Issued To (Employee)</th>
                  <th>Source Indent</th>
                  <th className="text-center font-bold">Items Count</th>
                  <th>Issued By</th>
                  <th>Date Issued</th>
                  <th className="text-center w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-onyx/40 font-medium">
                      No material issues found.{" "}
                      <button 
                        onClick={() => setIsCreateIssueOpen(true)} 
                        type="button"
                        className="text-saffron-dark hover:underline font-bold cursor-pointer bg-transparent border-none p-0 inline-block align-baseline"
                      >
                        Issue items directly
                      </button>
                      {" "}or{" "}
                      <a href="/stores/indents" className="text-saffron-dark hover:underline font-bold">
                        issue against an indent
                      </a>.
                    </td>
                  </tr>
                ) : (
                  filteredIssues.map((iss) => {
                    const isSelected = selectedIds.includes(iss.id);
                    return (
                      <tr key={iss.id} className={isSelected ? "bg-saffron/5" : ""}>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleSelect(iss.id)}
                            className="text-onyx/60 hover:text-onyx cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </td>
                        <td className="font-mono font-bold text-xs text-onyx/85">{iss.number}</td>
                        <td>{iss.storeName}</td>
                        <td className="font-semibold">{iss.deptName || "N/A"}</td>
                        <td>{iss.issuedTo || "N/A"}</td>
                        <td className="font-mono text-xs text-onyx/60">{iss.indentNumber || "-"}</td>
                        <td className="text-center font-semibold">{iss.lines.length} items</td>
                        <td>{iss.postedBy}</td>
                        <td suppressHydrationWarning>{new Date(iss.postedAt).toLocaleDateString()}</td>
                        <td className="text-center space-x-1">
                          <button
                            onClick={() => {
                              setSelectedIssue(iss);
                              setSelectedGp(null);
                              setIsDetailOpen(true);
                            }}
                            title="View Details"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx inline-flex"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            onClick={() => handleOpenEditIssue(iss)}
                            title="Edit Issue"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx inline-flex cursor-pointer"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            onClick={() => handlePrint("issue", iss)}
                            title="Print Slip"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx inline-flex cursor-pointer"
                          >
                            <Printer size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteIssue(iss.id)}
                            title="Delete Issue"
                            className="p-1 hover:bg-red-50 text-red-650 hover:text-red-700 rounded border border-transparent hover:border-red-200 inline-flex cursor-pointer"
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
          ) : (
            /* Gate Passes Table */
            <table className="w-full dense-table text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-3 w-10 text-center">
                    <button
                      onClick={handleToggleSelectAll}
                      className="text-onyx/65 hover:text-onyx cursor-pointer"
                    >
                      {filteredGatePasses.length > 0 && filteredGatePasses.every(gp => selectedIds.includes(gp.id)) ? (
                        <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th>Gatepass No</th>
                  <th>Type</th>
                  <th>Supplier / Customer</th>
                  <th>Purpose</th>
                  <th className="text-center font-bold">Items</th>
                  <th>Date Issued</th>
                  <th>Due Back</th>
                  <th className="text-center">Status</th>
                  <th className="text-center w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredGatePasses.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-onyx/40 font-medium">
                      No gate passes issued.
                    </td>
                  </tr>
                ) : (
                  filteredGatePasses.map((gp) => {
                    const isSelected = selectedIds.includes(gp.id);
                    const isGpEditable = gp.status === "OPEN";
                    const isOverdue = gp.type === "RETURNABLE" && 
                                      ["OPEN", "PARTIALLY_RETURNED"].includes(gp.status) && 
                                      gp.dueBack && new Date(gp.dueBack) < new Date();
                    return (
                      <tr key={gp.id} className={isSelected ? "bg-saffron/5" : ""}>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleSelect(gp.id)}
                            className="text-onyx/60 hover:text-onyx cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-saffron fill-saffron/10" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </td>
                        <td className="font-mono font-bold text-xs text-onyx/85">{gp.number}</td>
                        <td className="text-[10px] font-bold text-onyx/70">{gp.type}</td>
                        <td className="font-semibold">{gp.vendorName || "N/A"}</td>
                        <td>{gp.purpose || "-"}</td>
                        <td className="text-center font-semibold">{gp.lines.length} items</td>
                        <td suppressHydrationWarning>{new Date(gp.createdAt).toLocaleDateString()}</td>
                        <td suppressHydrationWarning>{gp.dueBack ? new Date(gp.dueBack).toLocaleDateString() : "-"}</td>
                        <td className="text-center">
                          {isOverdue ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-800 uppercase animate-pulse">
                              Overdue
                            </span>
                          ) : (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                              gp.status === "OPEN" ? "bg-yellow-100 text-yellow-800" :
                              gp.status === "RETURNED" ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
                            }`}>
                              {gp.status.replace("_", " ")}
                            </span>
                          )}
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => {
                                setSelectedGp(gp);
                                setSelectedIssue(null);
                                setIsDetailOpen(true);
                              }}
                              title="View Details"
                              className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx inline-flex"
                            >
                              <Eye size={13} />
                            </button>
                            <button
                              onClick={() => handleOpenEditGp(gp)}
                              disabled={!isGpEditable}
                              title={isGpEditable ? "Edit Gate Pass" : "Cannot edit returned/partially-returned gate pass"}
                              className={`p-1 rounded border border-transparent inline-flex cursor-pointer ${
                                isGpEditable 
                                  ? "hover:bg-cream-dark hover:border-onyx/5 text-onyx/65 hover:text-onyx" 
                                  : "text-onyx/30 cursor-not-allowed"
                              }`}
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={() => handlePrint("gp", gp)}
                              title="Print Gate Pass"
                              className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx inline-flex cursor-pointer"
                            >
                              <Printer size={13} />
                            </button>
                            {gp.type === "RETURNABLE" && ["OPEN", "PARTIALLY_RETURNED"].includes(gp.status) && isStore && (
                              <button
                                onClick={() => handleOpenReturn(gp)}
                                title="Log Material Return"
                                className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer inline-flex"
                              >
                                <CheckCircle size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteGp(gp.id)}
                              disabled={!isGpEditable}
                              title={isGpEditable ? "Delete Gate Pass" : "Cannot delete returned/partially-returned gate pass"}
                              className={`p-1 rounded border border-transparent inline-flex cursor-pointer ${
                                isGpEditable 
                                  ? "hover:bg-red-50 hover:border-red-200 text-red-650 hover:text-red-700" 
                                  : "text-onyx/30 cursor-not-allowed"
                              }`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Direct Issue Modal */}
      {isCreateIssueOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Create Direct Material Issue</h3>
              <button 
                onClick={() => {
                  setIsCreateIssueOpen(false);
                  setNewDirectIssue({ storeId: "", deptId: "", issuedTo: "", lines: [] });
                  setNewIssueLine({ itemId: "", qty: 1 });
                }} 
                className="hover:text-saffron cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateDirectIssue} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Store selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Source Store / Warehouse *
                  </label>
                  <select
                    value={newDirectIssue.storeId}
                    onChange={(e) => setNewDirectIssue(prev => ({ ...prev, storeId: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                    required
                  >
                    <option value="">Select Warehouse</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Recipient Department (Optional)
                  </label>
                  <select
                    value={newDirectIssue.deptId}
                    onChange={(e) => setNewDirectIssue(prev => ({ ...prev, deptId: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="">Select Department</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Issued To Employee */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Issued To (Employee Name / Ref)
                </label>
                <input
                  type="text"
                  value={newDirectIssue.issuedTo}
                  onChange={(e) => setNewDirectIssue(prev => ({ ...prev, issuedTo: e.target.value }))}
                  placeholder="e.g. Ramesh Kumar, Mech Maintenance Team"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              {/* Add items panel */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Line Item</h4>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-8">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                    <select
                      value={newIssueLine.itemId}
                      onChange={(e) => setNewIssueLine(prev => ({ ...prev, itemId: e.target.value }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
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
                      min="0.001"
                      step="any"
                      value={newIssueLine.qty}
                      onChange={(e) => setNewIssueLine(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={addIssueLine}
                      className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Items List ({newDirectIssue.lines.length})
                </label>
                {newDirectIssue.lines.length === 0 ? (
                  <p className="text-center py-4 bg-white border border-dashed border-onyx/10 text-xs text-onyx/40 font-medium rounded-lg">
                    No items added yet.
                  </p>
                ) : (
                  <div className="border border-onyx/5 rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-cream-dark/50">
                        <tr>
                          <th className="p-2 font-bold uppercase">Item</th>
                          <th className="p-2 font-bold uppercase text-right">Qty</th>
                          <th className="p-2 font-bold text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newDirectIssue.lines.map((line, idx) => {
                          const item = items.find(i => i.id === line.itemId);
                          return (
                            <tr key={idx} className="border-t border-onyx/5">
                              <td className="p-2">[{item?.code}] {item?.name}</td>
                              <td className="p-2 text-right font-mono font-bold">{line.qty} {item?.baseUom}</td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeIssueLine(idx)}
                                  className="text-red-655 hover:text-red-800 cursor-pointer"
                                  title="Remove Item"
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
                  onClick={() => {
                    setIsCreateIssueOpen(false);
                    setNewDirectIssue({ storeId: "", deptId: "", issuedTo: "", lines: [] });
                    setNewIssueLine({ itemId: "", qty: 1 });
                  }}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || newDirectIssue.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Issuing..." : "Issue Material"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Gate Pass Modal */}
      {isCreateGpOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Issue Materials Gate Pass</h3>
              <button onClick={() => setIsCreateGpOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateGp} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Type, Vendor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Gate Pass Type *
                  </label>
                  <select
                    value={newGp.type}
                    onChange={(e) => setNewGp(prev => ({ ...prev, type: e.target.value as any }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  >
                    <option value="RETURNABLE">Returnable (Overdue Tracked)</option>
                    <option value="NON_RETURNABLE">Non-Returnable (Scrap/Disposal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Destination Vendor / Custodian *
                  </label>
                  <select
                    value={newGp.vendorId}
                    onChange={(e) => setNewGp(prev => ({ ...prev, vendorId: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                    required
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Purpose & DueBack */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Purpose / Job Description
                  </label>
                  <input
                    type="text"
                    value={newGp.purpose}
                    onChange={(e) => setNewGp(prev => ({ ...prev, purpose: e.target.value }))}
                    placeholder="e.g. Die repair work, Galvanizing jobwork"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
                {newGp.type === "RETURNABLE" && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                      Due Back Date *
                    </label>
                    <input
                      type="date"
                      value={newGp.dueBack}
                      onChange={(e) => setNewGp(prev => ({ ...prev, dueBack: limitYearTo4Digits(e.target.value) }))}
                      className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Add items panel */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Line Item</h4>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-8">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                    <select
                      value={newLineItem.itemId}
                      onChange={(e) => setNewLineItem(prev => ({ ...prev, itemId: e.target.value }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
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
                      value={newLineItem.qty}
                      onChange={(e) => setNewLineItem(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={addGpLine}
                      className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Items List ({newGp.lines.length})
                </label>
                {newGp.lines.length === 0 ? (
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
                          <th className="p-2 font-bold text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newGp.lines.map((line, idx) => {
                          const item = items.find(i => i.id === line.itemId);
                          return (
                            <tr key={idx} className="border-t border-onyx/5">
                              <td className="p-2">[{item?.code}] {item?.name}</td>
                              <td className="p-2 text-right font-mono font-bold">{line.qty} {item?.baseUom}</td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeGpLine(idx)}
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
                  onClick={() => setIsCreateGpOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || newGp.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving..." : "Save Gate Pass"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Returnable Return Modal */}
      {isReturnOpen && selectedGp && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-lg w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Record Gate Pass Return ({selectedGp.number})</h3>
              <button onClick={() => setIsReturnOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handlePostReturn} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="p-3 bg-cream-dark/30 border border-onyx/5 rounded text-xs">
                <span className="font-semibold text-onyx/50 font-mono">Custodian:</span>
                <span className="font-bold text-onyx ml-1.5">{selectedGp.vendorName || "N/A"}</span>
              </div>

              {/* Line returns */}
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Enter Returned Quantities
                </label>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-3 font-bold">Item Description</th>
                        <th className="p-3 font-bold text-right">Remaining</th>
                        <th className="p-3 font-bold text-center w-28">Return Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedGp.lines.map((line) => {
                        const remaining = line.qty - (line.returnedQty || 0);
                        return (
                          <tr key={line.id} className="border-t border-onyx/5">
                            <td className="p-3">[{line.itemCode}] {line.itemName}</td>
                            <td className="p-3 text-right font-mono font-bold text-onyx/60">{remaining}</td>
                            <td className="p-3 text-center">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max={remaining}
                                value={lineReturns[line.id] || 0}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setLineReturns(prev => ({
                                    ...prev,
                                    [line.id]: Math.min(val, remaining)
                                  }));
                                }}
                                className="w-full text-xs p-1.5 border border-onyx/15 rounded text-center font-mono font-bold"
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
                  onClick={() => setIsReturnOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Logging Return..." : "Record Returns"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-onyx text-cream p-4 rounded-xl shadow-2xl border border-onyx-light flex items-center justify-between space-x-6 z-55 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <span className="text-xs font-bold">
            {selectedIds.length} {activeTab === "issues" ? "Issue(s)" : "Gate Pass(es)"} Selected
          </span>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBulkExportCSV}
              className="flex items-center space-x-2 px-3 py-1.5 bg-cream/10 hover:bg-cream/20 text-cream rounded-lg text-xs font-bold cursor-pointer transition-all"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center space-x-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-all"
            >
              <Trash2 size={14} />
              <span>Delete Selected</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="p-1.5 hover:bg-cream/10 text-cream/70 hover:text-cream rounded cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Edit Department Issue Modal */}
      {isEditIssueOpen && editIssueForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-lg w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-cream">Edit Department Issue {editIssueForm.number}</h3>
              <button onClick={() => setIsEditIssueOpen(false)} className="hover:text-saffron cursor-pointer text-cream-light">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEditIssue} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Store Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Source Store *
                </label>
                <select
                  value={editIssueForm.storeId}
                  onChange={(e) => setEditIssueForm(prev => prev ? { ...prev, storeId: e.target.value } : null)}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  required
                >
                  <option value="">Select Warehouse/Store</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Recipient Department */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Recipient Department
                </label>
                <select
                  value={editIssueForm.deptId}
                  onChange={(e) => setEditIssueForm(prev => prev ? { ...prev, deptId: e.target.value } : null)}
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
                  value={editIssueForm.issuedTo}
                  onChange={(e) => setEditIssueForm(prev => prev ? { ...prev, issuedTo: e.target.value } : null)}
                  placeholder="Enter receiver's name"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              {/* Edit Quantities of Item Lines */}
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Item Quantities to Issue
                </label>
                <div className="border border-onyx/5 rounded-lg overflow-hidden bg-white">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-3 font-bold">Item Description</th>
                        <th className="p-3 font-bold text-center w-36">Issue Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editIssueForm.lines.map((line, idx) => (
                        <tr key={line.itemId} className="border-t border-onyx/5">
                          <td className="p-3">[{line.itemCode}] {line.itemName}</td>
                          <td className="p-3 text-center">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              required
                              value={line.qty}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setEditIssueForm(prev => {
                                  if (!prev) return null;
                                  const updatedLines = [...prev.lines];
                                  updatedLines[idx] = { ...updatedLines[idx], qty: val };
                                  return { ...prev, lines: updatedLines };
                                });
                              }}
                              className="w-full text-xs p-1.5 border border-onyx/15 rounded text-center font-mono font-bold"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsEditIssueOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Updating..." : "Update Issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Gate Pass Modal */}
      {isEditGpOpen && editGpForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-cream">Edit Gate Pass {editGpForm.number}</h3>
              <button onClick={() => setIsEditGpOpen(false)} className="hover:text-saffron cursor-pointer text-cream-light">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEditGp} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Type, Vendor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Gate Pass Type *
                  </label>
                  <select
                    value={editGpForm.type}
                    onChange={(e) => setEditGpForm(prev => prev ? { ...prev, type: e.target.value as any } : null)}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  >
                    <option value="RETURNABLE">Returnable (Overdue Tracked)</option>
                    <option value="NON_RETURNABLE">Non-Returnable (Scrap/Disposal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Custodian / Vendor *
                  </label>
                  <select
                    value={editGpForm.vendorId}
                    onChange={(e) => setEditGpForm(prev => prev ? { ...prev, vendorId: e.target.value } : null)}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                    required
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Purpose & DueBack */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Purpose / Job Description
                  </label>
                  <input
                    type="text"
                    value={editGpForm.purpose}
                    onChange={(e) => setEditGpForm(prev => prev ? { ...prev, purpose: e.target.value } : null)}
                    placeholder="e.g. Repair work"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                  />
                </div>
                {editGpForm.type === "RETURNABLE" && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                      Due Back Date *
                    </label>
                    <input
                      type="date"
                      value={editGpForm.dueBack}
                      onChange={(e) => setEditGpForm(prev => prev ? { ...prev, dueBack: limitYearTo4Digits(e.target.value) } : null)}
                      className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Add item lines panel */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Line Item</h4>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-8">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                    <select
                      value={editGpNewLine.itemId}
                      onChange={(e) => setEditGpNewLine(prev => ({ ...prev, itemId: e.target.value }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
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
                      value={editGpNewLine.qty}
                      onChange={(e) => setEditGpNewLine(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none font-mono"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (!editGpNewLine.itemId) return;
                        setEditGpForm(prev => {
                          if (!prev) return null;
                          return {
                            ...prev,
                            lines: [...prev.lines, { itemId: editGpNewLine.itemId, qty: editGpNewLine.qty }]
                          };
                        });
                        setEditGpNewLine({ itemId: "", qty: 1 });
                      }}
                      className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Items List ({editGpForm.lines.length})
                </label>
                {editGpForm.lines.length === 0 ? (
                  <p className="text-center py-4 bg-white border border-dashed border-onyx/10 text-xs text-onyx/40 font-medium rounded-lg">
                    No items added yet.
                  </p>
                ) : (
                  <div className="border border-onyx/5 rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-cream-dark/50">
                        <tr>
                          <th className="p-2 font-bold uppercase">Item</th>
                          <th className="p-2 font-bold uppercase text-right">Qty</th>
                          <th className="p-2 font-bold text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editGpForm.lines.map((line, idx) => {
                          const item = items.find(i => i.id === line.itemId);
                          return (
                            <tr key={idx} className="border-t border-onyx/5">
                              <td className="p-2">[{item?.code}] {item?.name}</td>
                              <td className="p-2 text-right font-mono font-bold">{line.qty} {item?.baseUom}</td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditGpForm(prev => {
                                      if (!prev) return null;
                                      return {
                                        ...prev,
                                        lines: prev.lines.filter((_, i) => i !== idx)
                                      };
                                    });
                                  }}
                                  className="text-red-655 hover:text-red-800 cursor-pointer"
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
                  onClick={() => setIsEditGpOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || editGpForm.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Updating..." : "Update Gate Pass"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {isDetailOpen && (selectedIssue || selectedGp) && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-lg bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedIssue ? selectedIssue.number : selectedGp!.number}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                {selectedIssue ? "Department Material Issue Details" : "Material Gate Pass Details"}
              </h3>
              <p className="text-xs text-onyx/50">
                {selectedIssue ? `Warehouse: ${selectedIssue.storeName}` : `Purpose: ${selectedGp!.purpose || "N/A"}`}
              </p>
            </div>

            {/* Metadata */}
            <div className="py-4 grid grid-cols-2 gap-4 text-xs border-b border-onyx/5 bg-cream-dark/20 p-3 rounded-lg mt-4">
              {selectedIssue ? (
                <>
                  <div>
                    <span className="font-semibold text-onyx/50">Recipient Dept:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedIssue.deptName || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Issued To (Employee):</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedIssue.issuedTo || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Source Indent Ref:</span>
                    <p className="font-mono font-bold text-onyx mt-0.5">{selectedIssue.indentNumber || "-"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Issued By:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedIssue.postedBy}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Date Issued:</span>
                    <p suppressHydrationWarning className="font-bold text-onyx mt-0.5">{new Date(selectedIssue.postedAt).toLocaleDateString()}</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="font-semibold text-onyx/50">Gatepass Type:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedGp!.type}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Custodian:</span>
                    <p className="font-bold text-onyx mt-0.5">{selectedGp!.vendorName || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">GP Status:</span>
                    <p className="font-bold text-onyx mt-0.5 uppercase">{selectedGp!.status}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-onyx/50">Due Back Date:</span>
                    <p className="font-bold text-onyx mt-0.5">
                      <span suppressHydrationWarning>{selectedGp!.dueBack ? new Date(selectedGp!.dueBack).toLocaleDateString() : "N/A"}</span>
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto py-6 space-y-4">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                Material Items Register
              </h4>

              <div className="border border-onyx/5 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse bg-white">
                  <thead className="bg-cream-dark/50">
                    <tr>
                      <th className="p-2.5 font-bold">Item Description</th>
                      <th className="p-2.5 font-bold text-right">Issued Qty</th>
                      {selectedGp && selectedGp.type === "RETURNABLE" && (
                        <th className="p-2.5 font-bold text-right text-green-700">Returned</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedIssue ? selectedIssue.lines : selectedGp!.lines).map((line) => (
                      <tr key={line.id} className="border-t border-onyx/5">
                        <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                        <td className="p-2.5 text-right font-mono font-bold">{line.qty}</td>
                        {selectedGp && selectedGp.type === "RETURNABLE" && (
                          <td className="p-2.5 text-right font-mono font-bold text-green-700">{line.returnedQty || 0}</td>
                        )}
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
    </div>
  );
}
