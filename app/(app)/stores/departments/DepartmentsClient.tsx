"use client";

import { useState } from "react";
import { 
  createDepartment, 
  updateDepartment, 
  deleteDepartment 
} from "@/app/actions/items";
import { 
  Edit3, 
  Trash2, 
  Plus, 
  Check, 
  AlertCircle, 
  ShieldAlert,
  Building2,
  FolderTree,
  PackageOpen,
  X
} from "lucide-react";
import Link from "next/link";

interface Department {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  itemCount: number;
}

interface DepartmentsClientProps {
  initialDepartments: Department[];
}

export default function DepartmentsClient({ initialDepartments }: DepartmentsClientProps) {
  const [departmentsList, setDepartmentsList] = useState<Department[]>(initialDepartments);
  
  // Department Form states
  const [deptFormData, setDeptFormData] = useState({
    id: "",
    code: "",
    name: "",
    parentId: "",
  });
  const [deptFormMode, setDeptFormMode] = useState<"create" | "edit">("create");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const getDepartmentName = (deptId: string | null) => {
    if (!deptId) return "None";
    const dept = departmentsList.find(d => d.id === deptId);
    if (!dept) return "None";
    if (dept.parentId) {
      const parent = departmentsList.find(p => p.id === dept.parentId);
      if (parent) {
        return `${parent.name} > ${dept.name}`;
      }
    }
    return dept.name;
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload = {
      code: deptFormData.code.trim().toUpperCase(),
      name: deptFormData.name.trim(),
      parentId: deptFormData.parentId || null,
    };

    try {
      if (deptFormMode === "create") {
        const res = await createDepartment(payload);
        if (res.success && res.department) {
          const newDept = {
            ...(res.department as any),
            itemCount: 0
          };
          setDepartmentsList(prev => [...prev, newDept]);
          setDeptFormData({ id: "", code: "", name: "", parentId: "" });
          setSuccessMsg(`Department "${payload.name}" successfully created!`);
        } else {
          setErrorMsg(res.error || "Failed to create department");
        }
      } else {
        const res = await updateDepartment(deptFormData.id, payload);
        if (res.success && res.department) {
          const original = departmentsList.find(d => d.id === deptFormData.id);
          const updatedDept = {
            ...(res.department as any),
            itemCount: original?.itemCount || 0
          };
          setDepartmentsList(prev => prev.map(d => d.id === deptFormData.id ? updatedDept : d));
          setDeptFormData({ id: "", code: "", name: "", parentId: "" });
          setDeptFormMode("create");
          setSuccessMsg(`Department "${payload.name}" successfully updated!`);
        } else {
          setErrorMsg(res.error || "Failed to update department");
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred");
    } finally {
      setFormLoading(false);
    }
  };

  const handleEditDept = (dept: Department) => {
    setDeptFormData({
      id: dept.id,
      code: dept.code,
      name: dept.name,
      parentId: dept.parentId || "",
    });
    setDeptFormMode("edit");
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleDeleteDept = async (id: string) => {
    const dept = departmentsList.find(d => d.id === id);
    if (!dept) return;

    if (dept.itemCount > 0) {
      setErrorMsg(`Cannot delete department "${dept.name}" because it is currently assigned to ${dept.itemCount} active items in the Item Master.`);
      return;
    }

    const hasChildren = departmentsList.some(d => d.parentId === id);
    if (hasChildren) {
      setErrorMsg(`Cannot delete department "${dept.name}" because it has active subdepartments. Delete the subdepartments first.`);
      return;
    }

    if (!confirm(`Are you sure you want to delete department "${dept.name}" (${dept.code})?`)) return;
    
    setFormLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await deleteDepartment(id);
      if (res.success) {
        setDepartmentsList(prev => prev.filter(d => d.id !== id));
        setSuccessMsg(`Department "${dept.name}" successfully deleted.`);
        if (deptFormData.id === id) {
          setDeptFormData({ id: "", code: "", name: "", parentId: "" });
          setDeptFormMode("create");
        }
      } else {
        setErrorMsg(res.error || "Failed to delete department");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred");
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Departments Master register</h2>
          <p className="text-xs text-onyx/50 mt-1">Configure company department hierarchies, structural subdepartments, and review part allocation maps.</p>
        </div>
        <div>
          <Link
            href="/stores/items"
            className="flex items-center space-x-1 px-3 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg shadow-sm transition-all"
          >
            <span>Back to Item Master</span>
          </Link>
        </div>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-red-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
          <span className="whitespace-pre-line">{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-xl flex items-start space-x-3 text-xs text-green-800 font-semibold shadow-sm animate-in fade-in duration-200">
          <Check className="text-green-500 shrink-0 mt-0.5" size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Grid Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left Hierarchy Panel */}
        <div className="md:col-span-2 space-y-4">
          <div className="glass-card p-6 rounded-xl border border-onyx/5 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-onyx/5 pb-3">
              <h3 className="text-xs font-bold text-onyx/65 uppercase tracking-wider flex items-center space-x-1.5">
                <FolderTree size={14} className="text-saffron-dark" />
                <span>Departments & Subdepartments Hierarchy</span>
              </h3>
              <span className="text-[10px] bg-saffron/15 text-saffron-dark font-bold px-2 py-0.5 rounded-full border border-saffron/20">
                {departmentsList.length} Total
              </span>
            </div>

            {departmentsList.length === 0 ? (
              <div className="text-center py-16 text-onyx/40 text-xs">
                No departments created yet. Use the control form on the right to configure departments.
              </div>
            ) : (
              <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
                {/* Render top-level parents */}
                {departmentsList
                  .filter(d => !d.parentId)
                  .map(parent => {
                    const children = departmentsList.filter(c => c.parentId === parent.id);
                    return (
                      <div key={parent.id} className="p-4 bg-cream/40 border border-onyx/5 rounded-xl space-y-4 shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-xs text-saffron-dark bg-saffron/10 border border-saffron/20 px-2 py-0.5 rounded-md">
                              {parent.code}
                            </span>
                            <span className="font-bold text-xs text-onyx">{parent.name}</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-onyx/5 text-onyx/60 border border-onyx/10 ml-2">
                              <PackageOpen size={10} className="mr-1" />
                              {parent.itemCount} {parent.itemCount === 1 ? 'Part' : 'Parts'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleEditDept(parent)}
                              className="p-1.5 text-onyx/50 hover:text-saffron-dark hover:bg-cream-dark/50 rounded-lg transition-colors cursor-pointer"
                              title="Edit Department"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteDept(parent.id)}
                              className="p-1.5 text-onyx/50 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Department"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Render children subdepartments */}
                        {children.length > 0 && (
                          <div className="pl-6 border-l-2 border-onyx/10 space-y-2.5">
                            {children.map(child => (
                              <div key={child.id} className="flex items-center justify-between p-2.5 bg-white border border-onyx/5 rounded-xl shadow-2xs">
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-[10px] text-onyx/60 bg-onyx/5 px-2 py-0.5 rounded border border-onyx/5">
                                    {child.code}
                                  </span>
                                  <span className="text-xs text-onyx/85 font-semibold">{child.name}</span>
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-onyx/5 text-onyx/55 border border-onyx/5">
                                    {child.itemCount} {child.itemCount === 1 ? 'Part' : 'Parts'}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <button
                                    onClick={() => handleEditDept(child)}
                                    className="p-1 text-onyx/40 hover:text-saffron-dark hover:bg-cream-dark/50 rounded-lg transition-colors cursor-pointer"
                                    title="Edit Subdepartment"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteDept(child.id)}
                                    className="p-1 text-onyx/40 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete Subdepartment"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* Right Form Control Panel */}
        <div className="space-y-4">
          <div className="glass-card p-6 rounded-xl border border-onyx/5 shadow-sm space-y-5">
            <div className="border-b border-onyx/5 pb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold text-onyx/65 uppercase tracking-wider flex items-center space-x-1.5">
                <Building2 size={14} className="text-saffron-dark" />
                <span>{deptFormMode === "create" ? "Add Department/Sub" : "Edit Department details"}</span>
              </h3>
              {deptFormMode === "edit" && (
                <button
                  onClick={() => {
                    setDeptFormData({ id: "", code: "", name: "", parentId: "" });
                    setDeptFormMode("create");
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="p-1 hover:bg-cream-dark rounded-md text-onyx/55 hover:text-onyx cursor-pointer"
                  title="Cancel Edit"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <form onSubmit={handleSaveDepartment} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Department Code *
                </label>
                <input
                  type="text"
                  value={deptFormData.code}
                  onChange={(e) => setDeptFormData(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="e.g. PROD, MAINT-MECH"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono uppercase font-bold"
                  required
                  disabled={formLoading}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Department Name *
                </label>
                <input
                  type="text"
                  value={deptFormData.name}
                  onChange={(e) => setDeptFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Production Department"
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  required
                  disabled={formLoading}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Parent Department (Optional)
                </label>
                <select
                  value={deptFormData.parentId}
                  onChange={(e) => setDeptFormData(prev => ({ ...prev, parentId: e.target.value }))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  disabled={formLoading}
                >
                  <option value="">None (Top-level Department)</option>
                  {departmentsList
                    .filter(d => !d.parentId && d.id !== deptFormData.id) // Only allow top-level departments as parent to prevent recursion
                    .map(parent => (
                      <option key={parent.id} value={parent.id}>
                        {parent.name} ({parent.code})
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-onyx/40 mt-1">Select a parent department to make this a subdepartment.</p>
              </div>

              <div className="flex space-x-2 pt-2 border-t border-onyx/5">
                {deptFormMode === "edit" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeptFormData({ id: "", code: "", name: "", parentId: "" });
                      setDeptFormMode("create");
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="flex-1 py-2.5 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    disabled={formLoading}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-saffron hover:bg-saffron-dark text-xs font-bold text-onyx rounded-lg shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
                  disabled={formLoading}
                >
                  {formLoading ? "Saving..." : deptFormMode === "create" ? "Add Department" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
