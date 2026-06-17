"use client";

import React, { useState } from "react";
import { 
  inviteMember, 
  updateMemberScope, 
  suspendMember, 
  activateMember, 
  removeMember 
} from "@/app/actions/memberships";
import { 
  updateRolePermissions, 
  resetRolePermissions 
} from "@/app/actions/roles";
import { ROLE_PERMISSIONS } from "@/lib/rbac";
import { 
  UserPlus, 
  X, 
  UserMinus, 
  UserCheck, 
  AlertCircle, 
  CheckCircle,
  ShieldAlert,
  Sliders,
  Info,
  Copy,
  Check
} from "lucide-react";
import { Role, MembershipStatus } from "@prisma/client";

interface MemberRecord {
  id: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  storeScope: string[];
  deptScope: string[];
  approvalLimit: number | null;
  invitedAt: Date | string;
  acceptedAt: Date | string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface StoreItem {
  id: string;
  code: string;
  name: string;
}

interface DeptItem {
  id: string;
  code: string;
  name: string;
}

interface RolePermissionRecord {
  id: string;
  companyId: string;
  role: Role;
  permissions: string[];
  approvalLimit: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface MembersListProps {
  initialMembers: MemberRecord[];
  stores: StoreItem[];
  departments: DeptItem[];
  currentUserRole: Role;
  currentUserId: string;
  initialRolePermissions: RolePermissionRecord[];
  baseCurrency: string;
}

const ROLES = [
  "OWNER",
  "ADMIN",
  "PURCHASE_MANAGER",
  "PURCHASE_OFFICER",
  "STORE_MANAGER",
  "STORE_KEEPER",
  "QC_INSPECTOR",
  "INDENTER",
  "APPROVER",
  "ACCOUNTS",
  "VIEWER",
] as Role[];

interface CapabilityNode {
  key: string;
  label: string;
  category: string;
}

const CAPABILITIES: CapabilityNode[] = [
  // Identity & Admin
  { key: "company.settings.edit", label: "Edit Company Settings", category: "Identity & Admin" },
  { key: "company.branding.edit", label: "Edit Branding & Logo", category: "Identity & Admin" },
  { key: "user.manage", label: "Manage Memberships", category: "Identity & Admin" },
  { key: "role.assign", label: "Assign Roles", category: "Identity & Admin" },
  { key: "numbering.config", label: "Doc Numbering Config", category: "Identity & Admin" },
  { key: "module.toggle", label: "Toggle Modules", category: "Identity & Admin" },
  { key: "erp.config", label: "Configure Tally ERP", category: "Identity & Admin" },
  // Masters
  { key: "item.manage", label: "Manage Item Master", category: "Master Data" },
  { key: "vendor.manage", label: "Manage Vendor Details", category: "Master Data" },
  { key: "vendor.approve", label: "Approve Vendors & Unmask Bank Info", category: "Master Data" },
  { key: "store.manage", label: "Manage Store Locations", category: "Master Data" },
  { key: "shipto.manage", label: "Manage Ship-to Locations", category: "Master Data" },
  // Indents
  { key: "indent.create", label: "Create Indents", category: "Indents" },
  { key: "indent.approve", label: "Approve Indents", category: "Indents" },
  // Store Ops
  { key: "grn.post", label: "Create & Post GRNs", category: "Store Operations" },
  { key: "inspection.record", label: "Record QC Inspections", category: "Store Operations" },
  { key: "issue.create", label: "Record Outward Issues", category: "Store Operations" },
  { key: "gatepass.create", label: "Generate Gate Passes", category: "Store Operations" },
  { key: "stock.adjust", label: "Perform Stock Adjustments", category: "Store Operations" },
  { key: "stocktake.approve", label: "Approve Stocktakes", category: "Store Operations" },
  { key: "reorder.review", label: "Review Replenishment Suggestions", category: "Store Operations" },
  { key: "reorder.approve", label: "Convert Suggestions to Indents", category: "Store Operations" },
  // Purchase
  { key: "pr.create", label: "Raise Purchase Requisitions", category: "Purchase Module" },
  { key: "pr.approve", label: "Approve PRs", category: "Purchase Module" },
  { key: "rfq.manage", label: "Create RFQs & Record Quotes", category: "Purchase Module" },
  { key: "rfq.award", label: "Award RFQ Lines", category: "Purchase Module" },
  { key: "po.create", label: "Create PO Drafts & Amendments", category: "Purchase Module" },
  { key: "po.approve", label: "Approve POs", category: "Purchase Module" },
  { key: "po.send", label: "Issue & Send POs", category: "Purchase Module" },
  // Accounts
  { key: "invoice.match", label: "Perform 3-Way Invoice Match", category: "Finance & Accounts" },
  { key: "payment.record", label: "Record Supplier Payments", category: "Finance & Accounts" },
  { key: "ledger.view", label: "View Account Ledgers", category: "Finance & Accounts" },
  { key: "erp.writeback.approve", label: "Approve ERP Writebacks", category: "Finance & Accounts" },
  // Reports
  { key: "reports.view", label: "View Audit & Reports", category: "Reports" }
];

const DEFAULT_CEILINGS: Record<Role, number | null> = {
  OWNER: null,
  ADMIN: null,
  PURCHASE_MANAGER: 500000,
  PURCHASE_OFFICER: 50000,
  STORE_MANAGER: null,
  STORE_KEEPER: null,
  QC_INSPECTOR: null,
  INDENTER: null,
  APPROVER: null,
  ACCOUNTS: null,
  VIEWER: null,
};

export default function MembersList({
  initialMembers,
  stores,
  departments,
  currentUserRole,
  currentUserId,
  initialRolePermissions,
  baseCurrency,
}: MembersListProps) {
  const getCurrencySymbol = (currency: string) => {
    switch (currency) {
      case "USD": return "$";
      case "EUR": return "€";
      case "GBP": return "£";
      case "AED": return "د.إ";
      case "SGD": return "S$";
      case "SAR": return "ر.س";
      case "INR":
      default:
        return "₹";
    }
  };

  const currencySymbol = getCurrencySymbol(baseCurrency);

  const [activeTab, setActiveTab] = useState<"members" | "roles">("members");
  const [members, setMembers] = useState<MemberRecord[]>(initialMembers);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = (link: string) => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Initialize role custom configurations mapping
  const initialMap = ROLES.reduce((acc, r) => {
    const record = initialRolePermissions.find(p => p.role === r);
    acc[r] = {
      permissions: record ? record.permissions : ROLE_PERMISSIONS[r],
      approvalLimit: record ? record.approvalLimit : DEFAULT_CEILINGS[r],
    };
    return acc;
  }, {} as Record<Role, { permissions: string[]; approvalLimit: number | null }>);

  const [rolePermissionsMap, setRolePermissionsMap] = useState(initialMap);

  // Invitation Form State
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "VIEWER" as Role,
    storeScope: [] as string[],
    deptScope: [] as string[],
    approvalLimit: "",
  });

  // Edit Form State
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState({
    role: "VIEWER" as Role,
    storeScope: [] as string[],
    deptScope: [] as string[],
    approvalLimit: "",
  });

  const isOwner = currentUserRole === "OWNER";
  const isAdmin = currentUserRole === "ADMIN" || isOwner;

  // Count active owners
  const activeOwnerCount = members.filter(m => m.role === "OWNER" && m.status === "ACTIVE").length;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email) return;

    setLoading(true);
    setMsg(null);
    try {
      const limit = inviteForm.approvalLimit ? Number(inviteForm.approvalLimit) : undefined;
      const res = await inviteMember(
        inviteForm.email,
        inviteForm.role,
        inviteForm.storeScope,
        inviteForm.deptScope,
        limit
      );
      
      const newMember: MemberRecord = {
        id: res.id,
        userId: res.userId,
        role: res.role,
        status: res.status,
        storeScope: res.storeScope,
        deptScope: res.deptScope,
        approvalLimit: res.approvalLimit,
        invitedAt: res.invitedAt,
        acceptedAt: res.acceptedAt,
        user: {
          id: res.userId,
          name: inviteForm.email.split("@")[0],
          email: inviteForm.email,
        }
      };

      setMembers(prev => [newMember, ...prev]);
      setMsg({ 
        type: "success", 
        text: `Invitation created successfully for ${inviteForm.email}!`,
        link: res.link
      });
      setIsInviteOpen(false);
      setInviteForm({ email: "", role: "VIEWER", storeScope: [], deptScope: [], approvalLimit: "" });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to send invitation." });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEdit = (m: MemberRecord) => {
    setEditingId(m.id);
    setEditForm({
      role: m.role,
      storeScope: m.storeScope,
      deptScope: m.deptScope,
      approvalLimit: m.approvalLimit !== null ? String(m.approvalLimit) : "",
    });
    setIsEditOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const limit = editForm.approvalLimit ? Number(editForm.approvalLimit) : null;
      await updateMemberScope(
        editingId,
        editForm.role,
        editForm.storeScope,
        editForm.deptScope,
        limit
      );
      setMsg({ type: "success", text: "User membership updated successfully!" });
      setIsEditOpen(false);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to update membership." });
    } finally {
      setLoading(false);
    }
  };

  const handleSuspend = async (m: MemberRecord) => {
    if (m.role === "OWNER" && activeOwnerCount <= 1) {
      alert("Error: Cannot suspend the last active OWNER of the company.");
      return;
    }
    if (!confirm(`Are you sure you want to suspend access for ${m.user.email}?`)) return;

    try {
      await suspendMember(m.id);
      setMembers(prev => prev.map(item => item.id === m.id ? { ...item, status: "SUSPENDED" } : item));
      setMsg({ type: "success", text: `Suspended member ${m.user.email}` });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to suspend member." });
    }
  };

  const handleActivate = async (m: MemberRecord) => {
    try {
      await activateMember(m.id);
      setMembers(prev => prev.map(item => item.id === m.id ? { ...item, status: "ACTIVE" } : item));
      setMsg({ type: "success", text: `Activated member ${m.user.email}` });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to activate member." });
    }
  };

  const handleRemove = async (m: MemberRecord) => {
    if (m.role === "OWNER" && activeOwnerCount <= 1) {
      alert("Error: Cannot remove the last active OWNER of the company.");
      return;
    }
    if (!confirm(`Are you sure you want to completely remove ${m.user.email}? This action archives the membership.`)) return;

    try {
      await removeMember(m.id);
      setMembers(prev => prev.filter(item => item.id !== m.id));
      setMsg({ type: "success", text: `Removed member ${m.user.email}` });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to remove member." });
    }
  };

  const toggleStoreScope = (id: string, isEdit: boolean) => {
    const form = isEdit ? editForm : inviteForm;
    const setForm = isEdit ? setEditForm : setInviteForm;
    const isChecked = form.storeScope.includes(id);
    const newScope = isChecked 
      ? form.storeScope.filter(s => s !== id) 
      : [...form.storeScope, id];
    setForm((prev: any) => ({ ...prev, storeScope: newScope } as any));
  };

  const toggleDeptScope = (id: string, isEdit: boolean) => {
    const form = isEdit ? editForm : inviteForm;
    const setForm = isEdit ? setEditForm : setInviteForm;
    const isChecked = form.deptScope.includes(id);
    const newScope = isChecked 
      ? form.deptScope.filter(d => d !== id) 
      : [...form.deptScope, id];
    setForm((prev: any) => ({ ...prev, deptScope: newScope } as any));
  };

  const isRoleEditable = (m: MemberRecord) => {
    if (m.userId === currentUserId) return false; // Cannot edit self
    if (!isOwner && m.role === "OWNER") return false; // Only OWNER can edit other OWNERs
    return true;
  };

  const handleInviteRoleChange = (selectedRole: Role) => {
    const ceiling = rolePermissionsMap[selectedRole]?.approvalLimit;
    setInviteForm(prev => ({
      ...prev,
      role: selectedRole,
      approvalLimit: ceiling !== null && ceiling !== undefined ? String(ceiling) : "",
    }));
  };

  const handleEditRoleChange = (selectedRole: Role) => {
    const ceiling = rolePermissionsMap[selectedRole]?.approvalLimit;
    setEditForm(prev => ({
      ...prev,
      role: selectedRole,
      approvalLimit: ceiling !== null && ceiling !== undefined ? String(ceiling) : "",
    }));
  };

  // Matrix Interactive Handlers
  const handleToggleCapability = async (role: Role, key: string, currentlyChecked: boolean) => {
    if (!isAdmin || role === "OWNER") return;

    const current = rolePermissionsMap[role]?.permissions || [];
    const updatedPermissions = currentlyChecked
      ? current.filter(k => k !== key)
      : [...current, key];

    // Optimistic UI Update
    setRolePermissionsMap(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        permissions: updatedPermissions,
      }
    }));

    try {
      await updateRolePermissions(role, updatedPermissions, rolePermissionsMap[role]?.approvalLimit);
      setMsg({ type: "success", text: `Updated ${key} capability for ${role.replace("_", " ")} role` });
    } catch (err: any) {
      // Revert on error
      setRolePermissionsMap(prev => ({
        ...prev,
        [role]: {
          ...prev[role],
          permissions: current,
        }
      }));
      setMsg({ type: "error", text: err.message || "Failed to update role capabilities" });
    }
  };

  const handleCeilingChange = async (role: Role, val: string) => {
    if (!isAdmin || role === "OWNER" || role === "ADMIN") return;

    const parsedVal = val === "" ? null : Number(val);
    const oldLimit = rolePermissionsMap[role]?.approvalLimit;

    // Optimistic UI Update
    setRolePermissionsMap(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        approvalLimit: parsedVal,
      }
    }));

    try {
      await updateRolePermissions(role, rolePermissionsMap[role]?.permissions, parsedVal);
      setMsg({ type: "success", text: `Updated default approval ceiling for ${role.replace("_", " ")} to ${currencySymbol}${parsedVal?.toLocaleString() || "Unlimited"}` });
    } catch (err: any) {
      // Revert on error
      setRolePermissionsMap(prev => ({
        ...prev,
        [role]: {
          ...prev[role],
          approvalLimit: oldLimit,
        }
      }));
      setMsg({ type: "error", text: err.message || "Failed to update default role ceiling" });
    }
  };

  const handleResetRoles = async () => {
    if (!confirm("Are you sure you want to reset all role custom overrides? This will restore standard system defaults.")) return;

    setLoading(true);
    setMsg(null);
    try {
      await resetRolePermissions();
      
      const resetMap = ROLES.reduce((acc, r) => {
        acc[r] = {
          permissions: ROLE_PERMISSIONS[r],
          approvalLimit: DEFAULT_CEILINGS[r],
        };
        return acc;
      }, {} as Record<Role, { permissions: string[]; approvalLimit: number | null }>);

      setRolePermissionsMap(resetMap);
      setMsg({ type: "success", text: "Role custom permissions and ceilings reset to default successfully!" });
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to reset role configurations" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 font-body text-xs text-onyx">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Members & Roles</h2>
          <p className="text-xs text-onyx/50 mt-1">Configure company access, membership invitation details, and fine-grained role capabilities.</p>
        </div>
        {activeTab === "members" && (
          <button
            onClick={() => setIsInviteOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <UserPlus size={15} />
            <span>Invite Member</span>
          </button>
        )}
      </div>

      {msg && (
        <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-start justify-between gap-4 font-semibold transition-all duration-200 animate-in fade-in ${
          msg.type === "success" 
            ? "bg-emerald-50/90 border-emerald-200 text-emerald-900" 
            : "bg-red-50/90 border-red-200 text-red-900"
        }`}>
          <div className="flex items-start space-x-2.5 flex-1 min-w-0">
            {msg.type === "success" ? (
              <CheckCircle size={16} className="shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-600" />
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <span className="block text-xs font-bold leading-normal">{msg.text}</span>
              {msg.type === "success" && msg.link && (
                <div className="mt-2 text-[10px] font-normal text-emerald-800 leading-normal">
                  <p className="font-semibold text-emerald-950 mb-1.5 flex items-center gap-1">
                    <span>Direct Activation Link:</span>
                    <span className="bg-emerald-100/60 text-emerald-900 px-1.5 py-0.5 rounded text-[8px] font-mono border border-emerald-200/50 uppercase tracking-wide">Fallback / Instant</span>
                  </p>
                  <div className="flex items-center gap-2 max-w-xl bg-white border border-emerald-200 p-1.5 rounded-lg">
                    <input
                      type="text"
                      readOnly
                      value={msg.link}
                      className="flex-1 min-w-0 bg-transparent px-1 font-mono text-[9px] select-all focus:outline-none text-emerald-900 border-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyLink(msg.link!)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-saffron hover:bg-saffron-dark text-onyx rounded font-bold text-[9px] transition duration-150 cursor-pointer shadow-sm active:scale-95 shrink-0"
                    >
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copied ? "Copied!" : "Copy Link"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <button 
            onClick={() => {
              setMsg(null);
              setCopied(false);
            }} 
            className="text-onyx/40 hover:text-onyx cursor-pointer self-start shrink-0 p-0.5 hover:bg-onyx/5 rounded"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs Layout */}
      <div className="flex border-b border-onyx/10 gap-6">
        <button
          onClick={() => setActiveTab("members")}
          className={`pb-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
            activeTab === "members"
              ? "border-saffron text-onyx"
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          Members & Invitations
        </button>
        <button
          onClick={() => setActiveTab("roles")}
          className={`pb-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
            activeTab === "roles"
              ? "border-saffron text-onyx"
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          Role Definitions Matrix
        </button>
      </div>

      {/* Members & Invitations Panel */}
      {activeTab === "members" && (
        <div className="glass-card rounded-xl border border-onyx/5 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-cream/40 border-b border-cream-dark text-[9px] uppercase font-bold text-onyx/60 tracking-wider">
                <th className="py-3.5 px-4">User Details</th>
                <th className="py-3.5 px-4">System Role</th>
                <th className="py-3.5 px-4">Store Access Scope</th>
                <th className="py-3.5 px-4">Dept Access Scope</th>
                <th className="py-3.5 px-4">Approval Ceiling</th>
                <th className="py-3.5 px-4">Membership Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-dark">
              {members.map((m) => {
                const showEdit = isRoleEditable(m);
                return (
                  <tr key={m.id} className="hover:bg-cream/10 transition-colors duration-150">
                    <td className="py-4 px-4">
                      <p className="font-bold text-onyx">{m.user.name || "Invited User"}</p>
                      <p className="text-[10px] text-onyx/50 font-mono mt-0.5">{m.user.email}</p>
                    </td>
                    <td className="py-4 px-4 font-semibold">
                      <span className="px-2 py-0.5 bg-onyx/5 text-onyx border border-onyx/10 rounded-md font-mono text-[10px]">
                        {m.role.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      {m.storeScope.length === 0 ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">All Stores</span>
                      ) : (
                        <span className="text-[10px] text-onyx/70">
                          {m.storeScope.map(id => stores.find(s => s.id === id)?.code || id).join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {m.deptScope.length === 0 ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">All Departments</span>
                      ) : (
                        <span className="text-[10px] text-onyx/70">
                          {m.deptScope.map(id => departments.find(d => d.id === id)?.code || id).join(", ")}
                        </span>
                      )}
                    </td>
                     <td className="py-4 px-4 font-mono font-bold text-onyx/80" suppressHydrationWarning>
                       {m.approvalLimit !== null ? `${currencySymbol}${m.approvalLimit.toLocaleString()}` : "Unlimited"}
                     </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${m.status === "ACTIVE" ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : m.status === "INVITED" ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {showEdit && (
                          <button
                            onClick={() => handleOpenEdit(m)}
                            className="p-1.5 text-onyx/60 hover:text-onyx hover:bg-cream rounded border border-transparent hover:border-onyx/10 cursor-pointer"
                            title="Edit membership scopes"
                          >
                            <Sliders size={13} />
                          </button>
                        )}

                        {showEdit && m.status === "ACTIVE" && (
                          <button
                            onClick={() => handleSuspend(m)}
                            className="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded border border-transparent hover:border-amber-100 cursor-pointer"
                            title="Suspend User"
                          >
                            <UserMinus size={13} />
                          </button>
                        )}

                        {showEdit && m.status === "SUSPENDED" && (
                          <button
                            onClick={() => handleActivate(m)}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded border border-transparent hover:border-emerald-100 cursor-pointer"
                            title="Activate User"
                          >
                            <UserCheck size={13} />
                          </button>
                        )}

                        {showEdit && (
                          <button
                            onClick={() => handleRemove(m)}
                            className="p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-100 cursor-pointer"
                            title="Remove User"
                          >
                            <UserMinus size={13} />
                          </button>
                        )}

                        {!showEdit && (
                          <span className="text-[10px] text-onyx/30 italic pr-2 flex items-center space-x-1">
                            <ShieldAlert size={11} />
                            <span>Locked</span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Role Definitions Panel */}
      {activeTab === "roles" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-onyx flex items-center gap-2">
                <span>Role Capabilities Matrix</span>
                <span className="text-[10px] font-medium bg-saffron/20 text-onyx/80 px-2 py-0.5 rounded-full border border-saffron/30">Dynamic RBAC</span>
              </h3>
              <p className="text-xs text-onyx/50 mt-0.5">
                Define what features each user role can access and approve across all modules. Changes apply dynamically across the active tenant company.
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={handleResetRoles}
                disabled={loading}
                className="px-3 py-1.5 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
              >
                Reset to System Defaults
              </button>
            )}
          </div>

          {/* Owner Role Safety Alert */}
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-3 text-amber-800">
            <Info size={16} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-[11px] uppercase tracking-wider">Owner Lockout Protection</h4>
              <p className="text-[11px] text-amber-700 leading-normal">
                To prevent accidental lockouts, the permissions and unlimited approval ceiling of the <strong>OWNER</strong> role are strictly locked and immutable.
              </p>
            </div>
          </div>

          <div className="glass-card rounded-xl border border-onyx/5 bg-white overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-cream/40 border-b border-cream-dark text-[9px] uppercase font-bold text-onyx/60 tracking-wider">
                  <th className="py-3.5 px-4 sticky left-0 bg-white z-10 w-[260px] border-r border-cream-dark shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Module & Capability Name</th>
                  {ROLES.map((role) => (
                    <th key={role} className="py-3.5 px-2 text-center min-w-[105px] border-r border-cream-dark/50">
                      {role.replace("_", " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-dark text-[11px]">
                {/* Render categories & capabilities */}
                {Object.entries(
                  CAPABILITIES.reduce((acc, cap) => {
                    if (!acc[cap.category]) acc[cap.category] = [];
                    acc[cap.category].push(cap);
                    return acc;
                  }, {} as Record<string, typeof CAPABILITIES>)
                ).map(([category, items]) => (
                  <React.Fragment key={category}>
                    <tr className="bg-cream/20 font-bold text-[10px] text-onyx/70">
                      <td colSpan={ROLES.length + 1} className="py-2 px-4 border-r border-cream-dark font-heading uppercase tracking-wide">
                        {category}
                      </td>
                    </tr>
                    {items.map((cap) => (
                      <tr key={cap.key} className="hover:bg-cream/5 transition-colors duration-150">
                        <td className="py-2.5 px-4 font-semibold text-onyx/85 sticky left-0 bg-white border-r border-cream-dark shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                          {cap.label}
                          <span className="block text-[8px] text-onyx/40 font-mono mt-0.5 font-normal">{cap.key}</span>
                        </td>
                        {ROLES.map((role) => {
                          const isRoleOwner = role === "OWNER";
                          const isCheckboxChecked = rolePermissionsMap[role]?.permissions.includes(cap.key) ?? false;
                          const disabled = !isAdmin || isRoleOwner;

                          return (
                            <td key={role} className="py-2.5 px-2 text-center border-r border-cream-dark/50">
                              <input
                                type="checkbox"
                                checked={isCheckboxChecked}
                                disabled={disabled}
                                onChange={() => handleToggleCapability(role, cap.key, isCheckboxChecked)}
                                className={`rounded text-saffron border-onyx/20 focus:ring-saffron h-3.5 w-3.5 ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}

                {/* Default Approval Limit Row */}
                <tr className="bg-cream/30 font-bold text-onyx/90 border-t-2 border-cream-dark">
                  <td className="py-3 px-4 sticky left-0 bg-cream/35 border-r border-cream-dark shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                    Default Approval Ceiling ({baseCurrency})
                    <span className="block text-[8px] text-onyx/40 font-normal mt-0.5 font-body">Used as pre-fill when inviting new members</span>
                  </td>
                  {ROLES.map((role) => {
                    const isRoleOwner = role === "OWNER";
                    const isRoleAdmin = role === "ADMIN";
                    const limitVal = rolePermissionsMap[role]?.approvalLimit;
                    const disabled = !isAdmin || isRoleOwner || isRoleAdmin;

                    return (
                      <td key={role} className="py-3 px-2 text-center font-mono border-r border-cream-dark/50">
                        {isRoleOwner || isRoleAdmin ? (
                          <span className="text-[10px] text-onyx/40 font-semibold italic">Unlimited</span>
                        ) : (
                          <div className="relative inline-block w-full max-w-[100px]">
                            <span className="absolute left-1.5 inset-y-0 flex items-center text-onyx/30 text-[9px]">{currencySymbol}</span>
                            <input
                              type="number"
                              value={limitVal !== null && limitVal !== undefined ? limitVal : ""}
                              disabled={disabled}
                              onChange={(e) => handleCeilingChange(role, e.target.value)}
                              placeholder="Unlimited"
                              className={`w-full text-[10px] pl-4 pr-1 py-1 text-center bg-cream border border-onyx/10 rounded font-mono ${
                                disabled ? "opacity-65 cursor-not-allowed bg-cream-dark/20" : "focus:outline-none focus:border-saffron"
                              }`}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-lg w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Invite New Member</h3>
              <button onClick={() => setIsInviteOpen(false)} className="hover:text-saffron cursor-pointer text-cream/75 hover:text-cream">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleInvite} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Email Address *</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="e.g. employee@company.com"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">System Role *</label>
                  <select
                    value={inviteForm.role}
                    onChange={(e) => handleInviteRoleChange(e.target.value as Role)}
                    className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold text-onyx cursor-pointer"
                  >
                    {ROLES.filter(r => isOwner || r !== "OWNER").map((r) => (
                      <option key={r} value={r}>{r.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Approval Ceiling Value ({baseCurrency})</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-2.5 flex items-center text-onyx/40 font-mono font-bold text-[11px]">
                      {currencySymbol}
                    </span>
                    <input
                      type="number"
                      value={inviteForm.approvalLimit}
                      onChange={(e) => setInviteForm(prev => ({ ...prev, approvalLimit: e.target.value }))}
                      placeholder="Unlimited (e.g. 50000)"
                      className="w-full text-xs pl-8 pr-2 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Scopes block */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-onyx/5">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-2">Scoped Stores (Empty = All)</label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto bg-cream-dark/20 p-2 rounded-lg border border-onyx/5">
                    {stores.map((s) => (
                      <label key={s.id} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteForm.storeScope.includes(s.id)}
                          onChange={() => toggleStoreScope(s.id, false)}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                        />
                        <span className="font-semibold">{s.name} ({s.code})</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-2">Scoped Departments (Empty = All)</label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto bg-cream-dark/20 p-2 rounded-lg border border-onyx/5">
                    {departments.map((d) => (
                      <label key={d.id} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteForm.deptScope.includes(d.id)}
                          onChange={() => toggleDeptScope(d.id, false)}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                        />
                        <span className="font-semibold">{d.name} ({d.code})</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsInviteOpen(false)}
                  className="px-3.5 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Sending invitation..." : "Send Invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-lg w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Edit Membership Scopes & Role</h3>
              <button onClick={() => setIsEditOpen(false)} className="hover:text-saffron cursor-pointer text-cream/75 hover:text-cream">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleUpdate} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">System Role *</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => handleEditRoleChange(e.target.value as Role)}
                    className="w-full text-xs p-2 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold text-onyx cursor-pointer"
                  >
                    {ROLES.filter(r => isOwner || r !== "OWNER").map((r) => (
                      <option key={r} value={r}>{r.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Approval Ceiling Value ({baseCurrency})</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-2.5 flex items-center text-onyx/40 font-mono font-bold text-[11px]">
                      {currencySymbol}
                    </span>
                    <input
                      type="number"
                      value={editForm.approvalLimit}
                      onChange={(e) => setEditForm(prev => ({ ...prev, approvalLimit: e.target.value }))}
                      placeholder="Unlimited (e.g. 50000)"
                      className="w-full text-xs pl-8 pr-2 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Scopes block */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-onyx/5">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-2">Scoped Stores (Empty = All)</label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto bg-cream-dark/20 p-2 rounded-lg border border-onyx/5">
                    {stores.map((s) => (
                      <label key={s.id} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.storeScope.includes(s.id)}
                          onChange={() => toggleStoreScope(s.id, true)}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                        />
                        <span className="font-semibold">{s.name} ({s.code})</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-2">Scoped Departments (Empty = All)</label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto bg-cream-dark/20 p-2 rounded-lg border border-onyx/5">
                    {departments.map((d) => (
                      <label key={d.id} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.deptScope.includes(d.id)}
                          onChange={() => toggleDeptScope(d.id, true)}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                        />
                        <span className="font-semibold">{d.name} ({d.code})</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-3.5 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Saving changes..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
