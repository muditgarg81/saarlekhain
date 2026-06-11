"use client";

import { useState } from "react";
import { 
  createItem, 
  updateItem, 
  toggleItemStatus, 
  getNextCode,
  bulkCreateItems,
  bulkDeleteItems,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  updateReorderLevels
} from "@/app/actions/items";
import { 
  Search, 
  Plus, 
  Filter, 
  FileSpreadsheet, 
  X, 
  Edit3, 
  Eye, 
  Power, 
  Package, 
  Info,
  ShieldAlert,
  Upload,
  Trash2,
  Save,
  Check,
  Loader2
} from "lucide-react";
import * as utils from "xlsx";

interface Item {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  departmentId: string | null;
  type: string;
  baseUom: string;
  altUom: string | null;
  altUomFactor: number | null;
  make: string | null;
  specification: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  leadTimeDays: number;
  shelfLifeDays: number | null;
  qcRequired: boolean;
  valuation: string;
  status: string;
}

interface Category {
  id: string;
  code: string;
  name: string;
}

interface Department {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
}

interface ItemMasterListProps {
  initialItems: Item[];
  categories: Category[];
  departments: Department[];
}

export default function ItemMasterList({ initialItems, categories, departments }: ItemMasterListProps) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  
  // Inline Reorder Level editing state
  const [isEditingReorders, setIsEditingReorders] = useState(false);
  const [tempReorders, setTempReorders] = useState<Record<string, number | string>>({});
  const [isSavingReorders, setIsSavingReorders] = useState(false);
  const [reordersError, setReordersError] = useState<string | null>(null);
  const [reordersSuccess, setReordersSuccess] = useState<string | null>(null);
  
  // Tab states
  const [activeTab, setActiveTab] = useState<"items" | "departments">("items");
  const [departmentsList, setDepartmentsList] = useState<Department[]>(departments);

  // Department Form states
  const [deptFormData, setDeptFormData] = useState({
    id: "",
    code: "",
    name: "",
    parentId: "",
  });
  const [deptFormMode, setDeptFormMode] = useState<"create" | "edit">("create");
  const [deptFormError, setDeptFormError] = useState<string | null>(null);
  const [deptFormLoading, setDeptFormLoading] = useState(false);

  // Drawer/Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");

  // Form states
  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    categoryId: "",
    departmentId: "",
    type: "RAW_MATERIAL",
    baseUom: "KG",
    altUom: "",
    altUomFactor: "",
    make: "",
    specification: "",
    hsnCode: "",
    gstRate: "18",
    reorderLevel: "0",
    minStock: "0",
    maxStock: "0",
    leadTimeDays: "0",
    shelfLifeDays: "",
    qcRequired: false,
    valuation: "WEIGHTED_AVG",
    code: "",
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Bulk Upload state
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkData, setBulkData] = useState<Array<{
    rowNum: number;
    data: any;
    errors: string[];
    warnings: string[];
    isValid: boolean;
  }> | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Department Helper Functions and Handlers
  const getDepartmentName = (deptId: string | null) => {
    if (!deptId) return "N/A";
    const dept = departmentsList.find(d => d.id === deptId);
    if (!dept) return "N/A";
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
    setDeptFormLoading(true);
    setDeptFormError(null);

    const payload = {
      code: deptFormData.code.trim().toUpperCase(),
      name: deptFormData.name.trim(),
      parentId: deptFormData.parentId || null,
    };

    try {
      if (deptFormMode === "create") {
        const res = await createDepartment(payload);
        if (res.success && res.department) {
          setDepartmentsList(prev => [...prev, res.department as any]);
          setDeptFormData({ id: "", code: "", name: "", parentId: "" });
        } else {
          setDeptFormError(res.error || "Failed to create department");
        }
      } else {
        const res = await updateDepartment(deptFormData.id, payload);
        if (res.success && res.department) {
          setDepartmentsList(prev => prev.map(d => d.id === deptFormData.id ? (res.department as any) : d));
          setDeptFormData({ id: "", code: "", name: "", parentId: "" });
          setDeptFormMode("create");
        } else {
          setDeptFormError(res.error || "Failed to update department");
        }
      }
    } catch (err: any) {
      setDeptFormError(err.message || "An error occurred");
    } finally {
      setDeptFormLoading(false);
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
    setDeptFormError(null);
  };

  const handleDeleteDept = async (id: string) => {
    if (!confirm("Are you sure you want to delete this department?")) return;
    setDeptFormLoading(true);
    setDeptFormError(null);

    try {
      const res = await deleteDepartment(id);
      if (res.success) {
        setDepartmentsList(prev => prev.filter(d => d.id !== id));
        if (deptFormData.id === id) {
          setDeptFormData({ id: "", code: "", name: "", parentId: "" });
          setDeptFormMode("create");
        }
      } else {
        setDeptFormError(res.error || "Failed to delete department");
      }
    } catch (err: any) {
      setDeptFormError(err.message || "An error occurred");
    } finally {
      setDeptFormLoading(false);
    }
  };

  // Template Excel generator
  const downloadTemplate = () => {
    const headers = [
      "Item Name",
      "Item Code",
      "Category Code",
      "Department Code",
      "Item Type",
      "Base UOM",
      "Alt UOM",
      "Alt UOM Factor",
      "Make/Brand",
      "Specification",
      "HSN Code",
      "GST Rate (%)",
      "Reorder Level",
      "Min Stock",
      "Max Stock",
      "Lead Time (Days)",
      "Shelf Life (Days)",
      "QC Required",
      "Valuation Method"
    ];
    const sampleRows = [
      [
        "M12 Hex Bolt 50mm",
        "CONS-0001",
        "CONS",
        "MAINT",
        "CONSUMABLE",
        "PCS",
        "BOX",
        "50",
        "Unbrako",
        "High tensile hex head bolts, zinc plated",
        "7318 1500",
        "18",
        "1000",
        "500",
        "5000",
        "7",
        "",
        "No",
        "WEIGHTED_AVG"
      ],
      [
        "Mild Steel Sheet 2.0mm",
        "RM-0001",
        "RM",
        "PROD",
        "RAW_MATERIAL",
        "KG",
        "",
        "",
        "Tata Steel",
        "Standard industrial grade MS Sheets, 2.0mm thickness",
        "7210 4900",
        "18",
        "200",
        "100",
        "1000",
        "15",
        "",
        "Yes",
        "WEIGHTED_AVG"
      ]
    ];
    const ws = utils.utils.aoa_to_sheet([headers, ...sampleRows]);
    const wb = utils.utils.book_new();
    utils.utils.book_append_sheet(wb, ws, "Template");
    utils.writeFile(wb, "Saarlekha_Items_Template.xlsx");
  };

  // Parsing and validation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBulkFile(file);
    setImportError(null);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = utils.read(bstr, { type: "binary" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawRows = utils.utils.sheet_to_json(ws) as Array<Record<string, any>>;

        if (rawRows.length === 0) {
          setImportError("The uploaded file is empty");
          return;
        }

        const parsedRows = rawRows.map((row, idx) => {
          const name = String(row["Item Name"] || "").trim();
          const code = String(row["Item Code"] || "").trim();
          const categoryCode = String(row["Category Code"] || "").trim().toUpperCase();
          const departmentCode = String(row["Department Code"] || "").trim().toUpperCase();
          const type = String(row["Item Type"] || row["Type"] || "RAW_MATERIAL").trim().toUpperCase();
          const baseUom = String(row["Base UOM"] || row["UOM"] || "").trim().toUpperCase();
          const altUom = String(row["Alt UOM"] || "").trim().toUpperCase();
          const altUomFactorRaw = row["Alt UOM Factor"];
          const make = String(row["Make/Brand"] || row["Make"] || row["Brand"] || "").trim();
          const specification = String(row["Specification"] || row["Specs"] || row["Spec"] || "").trim();
          const hsnCode = String(row["HSN Code"] || row["HSN"] || "").trim();
          const gstRateRaw = row["GST Rate (%)"] !== undefined ? row["GST Rate (%)"] : (row["GST Rate"] !== undefined ? row["GST Rate"] : row["GST"]);
          const reorderLevelRaw = row["Reorder Level"] !== undefined ? row["Reorder Level"] : row["Reorder"];
          const minStockRaw = row["Min Stock"] !== undefined ? row["Min Stock"] : row["Min"];
          const maxStockRaw = row["Max Stock"] !== undefined ? row["Max Stock"] : row["Max"];
          const leadTimeDaysRaw = row["Lead Time (Days)"] !== undefined ? row["Lead Time (Days)"] : row["Lead Time"];
          const shelfLifeDaysRaw = row["Shelf Life (Days)"] !== undefined ? row["Shelf Life (Days)"] : row["Shelf Life"];
          const qcRequiredRaw = String(row["QC Required"] !== undefined ? row["QC Required"] : (row["QC"] !== undefined ? row["QC"] : "")).trim().toLowerCase();
          const valuationRaw = String(row["Valuation Method"] || row["Valuation"] || "WEIGHTED_AVG").trim().toUpperCase();

          const errors: string[] = [];
          const warnings: string[] = [];

          if (!name) {
            errors.push("Item Name is required");
          } else if (name.length < 2) {
            errors.push("Item Name must be at least 2 characters");
          }

          if (code) {
            const codeExists = items.some(i => i.code.toUpperCase() === code.toUpperCase());
            if (codeExists) {
              errors.push(`Item Code '${code}' already exists`);
            }
          }

          let matchedCat = null;
          if (!categoryCode) {
            errors.push("Category Code is required");
          } else {
            matchedCat = categories.find(c => c.code.toUpperCase() === categoryCode);
            if (!matchedCat) {
              warnings.push(`Category Code '${categoryCode}' will be created`);
            }
          }

          let matchedDept = null;
          if (departmentCode) {
            matchedDept = departmentsList.find(d => d.code.toUpperCase() === departmentCode);
            if (!matchedDept) {
              errors.push(`Department Code '${departmentCode}' not found`);
            }
          }

          const validTypes = ["RAW_MATERIAL", "CONSUMABLE", "SPARE", "TOOL", "PACKING", "SEMI_FINISHED", "FINISHED_GOOD"];
          if (!validTypes.includes(type)) {
            errors.push(`Invalid Item Type '${type}'. Expected one of: ${validTypes.join(", ")}`);
          }

          if (!baseUom) {
            errors.push("Base UOM is required");
          }

          const altUomFactor = (altUomFactorRaw !== undefined && altUomFactorRaw !== "") ? parseFloat(altUomFactorRaw) : null;
          if (altUom && (altUomFactor === null || isNaN(altUomFactor) || altUomFactor <= 0)) {
            errors.push("Alt UOM Factor must be a positive number if Alt UOM is supplied");
          }

          const gstRate = gstRateRaw !== undefined ? parseFloat(gstRateRaw) : 0;
          if (isNaN(gstRate) || gstRate < 0) {
            errors.push("GST Rate (%) must be a non-negative number");
          }

          const reorderLevel = reorderLevelRaw !== undefined ? parseFloat(reorderLevelRaw) : 0;
          if (isNaN(reorderLevel) || reorderLevel < 0) {
            errors.push("Reorder Level must be a non-negative number");
          }

          const minStock = minStockRaw !== undefined ? parseFloat(minStockRaw) : 0;
          if (isNaN(minStock) || minStock < 0) {
            errors.push("Min Stock must be a non-negative number");
          }

          const maxStock = maxStockRaw !== undefined ? parseFloat(maxStockRaw) : 0;
          if (isNaN(maxStock) || maxStock < 0) {
            errors.push("Max Stock must be a non-negative number");
          }

          const leadTimeDays = leadTimeDaysRaw !== undefined ? parseInt(leadTimeDaysRaw, 10) : 0;
          if (isNaN(leadTimeDays) || leadTimeDays < 0) {
            errors.push("Lead Time (Days) must be a non-negative integer");
          }

          const shelfLifeDays = (shelfLifeDaysRaw !== undefined && String(shelfLifeDaysRaw).trim() !== "") ? parseInt(shelfLifeDaysRaw, 10) : null;
          if (shelfLifeDays !== null && (isNaN(shelfLifeDays) || shelfLifeDays < 0)) {
            errors.push("Shelf Life (Days) must be a positive integer");
          }

          const qcRequired = ["yes", "true", "1"].includes(qcRequiredRaw);

          const valuation = (valuationRaw === "FIFO") ? "FIFO" : "WEIGHTED_AVG";

           const dataPayload = {
            name,
            code: code || null,
            description: row["Description"] ? String(row["Description"]) : null,
            categoryCode,
            departmentCode: departmentCode || null,
            type: type as any,
            baseUom,
            altUom: altUom || null,
            altUomFactor: altUom && altUomFactor ? altUomFactor : null,
            make: make || null,
            specification: specification || null,
            hsnCode: hsnCode || null,
            gstRate,
            reorderLevel,
            minStock,
            maxStock,
            leadTimeDays,
            shelfLifeDays,
            qcRequired,
            valuation: valuation as any,
          };

           return {
            rowNum: idx + 2,
            data: dataPayload,
            errors,
            warnings,
            isValid: errors.length === 0
          };
        });

        setBulkData(parsedRows);
      } catch (err: any) {
        console.error("Error reading file", err);
        setImportError(err.message || "Failed to read and parse Excel file");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleBulkSubmit = async () => {
    if (!bulkData) return;
    const invalidRows = bulkData.filter(r => !r.isValid);
    if (invalidRows.length > 0) {
      setImportError(`Cannot import. There are ${invalidRows.length} rows with validation errors.`);
      return;
    }

    setIsImporting(true);
    setImportError(null);

    const payload = bulkData.map(r => r.data);

    try {
      const res = await bulkCreateItems(payload);
      if (res.success && res.items) {
        setItems(prev => [...(res.items as any[]), ...prev]);
        setImportSuccess(`Successfully imported ${res.count} items!`);
        setTimeout(() => {
          setIsBulkModalOpen(false);
          setBulkFile(null);
          setBulkData(null);
          setImportSuccess(null);
        }, 2000);
      } else {
        setImportError(res.error || "Failed to import items");
      }
    } catch (err: any) {
      setImportError(err.message || "An unexpected error occurred during import");
    } finally {
      setIsImporting(false);
    }
  };

  // Filter items
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) || 
                          item.code.toLowerCase().includes(search.toLowerCase()) ||
                          (item.make?.toLowerCase() || "").includes(search.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
    const matchesDepartment = selectedDepartment === "all" || item.departmentId === selectedDepartment;
    const matchesType = selectedType === "all" || item.type === selectedType;
    const matchesStatus = selectedStatus === "all" || item.status === selectedStatus;
    
    return matchesSearch && matchesCategory && matchesDepartment && matchesType && matchesStatus;
  });

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllItems = () => {
    if (selectedItemIds.length === filteredItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(filteredItems.map(item => item.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItemIds.length === 0) return;
    if (confirm(`Are you sure you want to delete the ${selectedItemIds.length} selected items from the Master database?`)) {
      setFormLoading(true);
      const res = await bulkDeleteItems(selectedItemIds);
      setFormLoading(false);
      if (res.success) {
        setItems(prev => prev.filter(i => !selectedItemIds.includes(i.id)));
        setSelectedItemIds([]);
        alert(`Successfully deleted ${res.count} items.`);
      } else {
        alert("Failed to delete items: " + res.error);
      }
    }
  };

  const exportSelectedToExcel = () => {
    const itemsToExport = selectedItemIds.length > 0 
      ? items.filter(i => selectedItemIds.includes(i.id))
      : filteredItems;
      
    const dataToExport = itemsToExport.map(item => ({
      "Item Code": item.code,
      "Item Name": item.name,
      "Category": categories.find(c => c.id === item.categoryId)?.name || "N/A",
      "Department": getDepartmentName(item.departmentId),
      "Department Code": departmentsList.find(d => d.id === item.departmentId)?.code || "N/A",
      "Type": item.type,
      "Base UOM": item.baseUom,
      "Reorder Level": item.reorderLevel,
      "Min Stock": item.minStock,
      "Max Stock": item.maxStock,
      "QC Required": item.qcRequired ? "Yes" : "No",
      "GST Rate (%)": item.gstRate,
      "Valuation Method": item.valuation,
      "Status": item.status,
    }));

    const worksheet = utils.utils.json_to_sheet(dataToExport);
    const workbook = utils.utils.book_new();
    utils.utils.book_append_sheet(workbook, worksheet, "Selected Items Master");
    utils.writeFile(workbook, selectedItemIds.length > 0 ? "Saarlekha_Selected_Items.xlsx" : "Saarlekha_Items_Master.xlsx");
  };

  // Handle category change in form to suggest code
  const handleFormCategoryChange = async (catId: string) => {
    setFormData(prev => ({ ...prev, categoryId: catId }));
    if (!catId) return;

    const cat = categories.find(c => c.id === catId);
    if (cat && modalMode === "create") {
      try {
        const suggestedCode = await getNextCode(cat.code);
        setFormData(prev => ({ ...prev, code: suggestedCode }));
      } catch (err) {
        console.error("Failed to suggest code", err);
      }
    }
  };

  const handleOpenCreate = async () => {
    setModalMode("create");
    setFormError(null);
    setFormData({
      id: "",
      name: "",
      description: "",
      categoryId: categories[0]?.id || "",
      departmentId: "",
      type: "RAW_MATERIAL",
      baseUom: "KG",
      altUom: "",
      altUomFactor: "",
      make: "",
      specification: "",
      hsnCode: "",
      gstRate: "18",
      reorderLevel: "0",
      minStock: "0",
      maxStock: "0",
      leadTimeDays: "0",
      shelfLifeDays: "",
      qcRequired: false,
      valuation: "WEIGHTED_AVG",
      code: "",
    });
    setIsModalOpen(true);
    
    // Auto fill suggested code for first category
    if (categories[0]) {
      try {
        const suggestedCode = await getNextCode(categories[0].code);
        setFormData(prev => ({ ...prev, code: suggestedCode }));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleOpenEdit = (item: Item) => {
    setModalMode("edit");
    setFormError(null);
    setFormData({
      id: item.id,
      name: item.name,
      description: item.description || "",
      categoryId: item.categoryId || "",
      departmentId: item.departmentId || "",
      type: item.type,
      baseUom: item.baseUom,
      altUom: item.altUom || "",
      altUomFactor: item.altUomFactor ? String(item.altUomFactor) : "",
      make: item.make || "",
      specification: item.specification || "",
      hsnCode: item.hsnCode || "",
      gstRate: String(item.gstRate || 0),
      reorderLevel: String(item.reorderLevel),
      minStock: String(item.minStock),
      maxStock: String(item.maxStock),
      leadTimeDays: String(item.leadTimeDays),
      shelfLifeDays: item.shelfLifeDays ? String(item.shelfLifeDays) : "",
      qcRequired: item.qcRequired,
      valuation: item.valuation,
      code: item.code,
    });
    setIsModalOpen(true);
  };

  const handleToggleStatus = async (item: Item) => {
    if (confirm(`Are you sure you want to ${item.status === "ACTIVE" ? "deactivate" : "activate"} item ${item.code}?`)) {
      const res = await toggleItemStatus(item.id);
      if (res.success && res.status) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: res.status! } : i));
      } else {
        alert("Failed to toggle status: " + res.error);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);

    const payload = {
      name: formData.name,
      description: formData.description || undefined,
      categoryId: formData.categoryId || null,
      departmentId: formData.departmentId || null,
      type: formData.type as any,
      baseUom: formData.baseUom,
      altUom: formData.altUom || null,
      altUomFactor: formData.altUomFactor ? parseFloat(formData.altUomFactor) : null,
      make: formData.make || null,
      specification: formData.specification || null,
      hsnCode: formData.hsnCode || null,
      gstRate: parseFloat(formData.gstRate) || 0,
      reorderLevel: parseFloat(formData.reorderLevel) || 0,
      minStock: parseFloat(formData.minStock) || 0,
      maxStock: parseFloat(formData.maxStock) || 0,
      leadTimeDays: parseInt(formData.leadTimeDays, 10) || 0,
      shelfLifeDays: formData.shelfLifeDays ? parseInt(formData.shelfLifeDays, 10) : null,
      qcRequired: formData.qcRequired,
      valuation: formData.valuation as any,
    };

    try {
      if (modalMode === "create") {
        const res = await createItem({ ...payload, code: formData.code });
        if (res.success && res.item) {
          setItems(prev => [res.item as any, ...prev]);
          setIsModalOpen(false);
        } else {
          setFormError(res.error || "Failed to create item");
        }
      } else {
        const res = await updateItem(formData.id, { ...payload, code: formData.code });
        if (res.success && res.item) {
          setItems(prev => prev.map(i => i.id === formData.id ? (res.item as any) : i));
          setIsModalOpen(false);
        } else {
          setFormError(res.error || "Failed to update item");
        }
      }
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setFormLoading(false);
    }
  };

  const startEditingReorders = () => {
    const levels: Record<string, number> = {};
    items.forEach(item => {
      levels[item.id] = item.reorderLevel;
    });
    setTempReorders(levels);
    setReordersError(null);
    setReordersSuccess(null);
    setIsEditingReorders(true);
  };

  const cancelEditingReorders = () => {
    setIsEditingReorders(false);
    setTempReorders({});
    setReordersError(null);
  };

  const saveReorders = async () => {
    setReordersError(null);
    setReordersSuccess(null);
    
    const updates = Object.entries(tempReorders)
      .map(([id, val]) => ({ id, reorderLevel: val === "" ? 0 : Number(val) }))
      .filter(({ id, reorderLevel }) => {
        const original = items.find(item => item.id === id);
        return original && original.reorderLevel !== reorderLevel;
      });

    if (updates.length === 0) {
      setIsEditingReorders(false);
      return;
    }

    setIsSavingReorders(true);

    try {
      const res = await updateReorderLevels(updates);
      if (res.success) {
        setItems(prev => prev.map(item => {
          const updated = updates.find(u => u.id === item.id);
          if (updated) {
            return { ...item, reorderLevel: updated.reorderLevel };
          }
          return item;
        }));
        setReordersSuccess(`Successfully updated reorder levels for ${res.count} items.`);
        setIsEditingReorders(false);
        setTimeout(() => setReordersSuccess(null), 3000);
      } else {
        setReordersError(res.error || "Failed to update reorder levels");
      }
    } catch (err: any) {
      setReordersError(err.message || "An unexpected error occurred");
    } finally {
      setIsSavingReorders(false);
    }
  };

  const exportToExcel = () => {
    const dataToExport = filteredItems.map(item => ({
      "Item Code": item.code,
      "Item Name": item.name,
      "Category": categories.find(c => c.id === item.categoryId)?.name || "N/A",
      "Department": getDepartmentName(item.departmentId),
      "Department Code": departmentsList.find(d => d.id === item.departmentId)?.code || "N/A",
      "Type": item.type,
      "Base UOM": item.baseUom,
      "Reorder Level": item.reorderLevel,
      "Min Stock": item.minStock,
      "Max Stock": item.maxStock,
      "QC Required": item.qcRequired ? "Yes" : "No",
      "GST Rate (%)": item.gstRate,
      "Valuation Method": item.valuation,
      "Status": item.status,
    }));

    const worksheet = utils.utils.json_to_sheet(dataToExport);
    const workbook = utils.utils.book_new();
    utils.utils.book_append_sheet(workbook, worksheet, "Items Master");
    utils.writeFile(workbook, "Saarlekha_Items_Master.xlsx");
  };

  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Item Master Codings</h2>
          <p className="text-xs text-onyx/50 mt-1">Configure item attributes, reorder levels, and code schemes.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={exportToExcel}
            className="flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-cream-dark/50 border border-onyx/10 rounded-lg text-xs font-semibold text-onyx shadow-sm transition-all duration-150 cursor-pointer"
          >
            <FileSpreadsheet size={15} className="text-emerald-700" />
            <span>Export Register</span>
          </button>
          <button
            onClick={() => setIsBulkModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-cream-dark/50 border border-onyx/10 rounded-lg text-xs font-semibold text-onyx shadow-sm transition-all duration-150 cursor-pointer"
          >
            <Upload size={15} className="text-saffron" />
            <span>Bulk Import</span>
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Create Item</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-onyx/10 space-x-6">
        <button
          onClick={() => setActiveTab("items")}
          className={`pb-2.5 text-xs font-bold uppercase tracking-wider cursor-pointer border-b-2 transition-all duration-250 ${
            activeTab === "items" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          Items Catalog
        </button>
        <button
          onClick={() => setActiveTab("departments")}
          className={`pb-2.5 text-xs font-bold uppercase tracking-wider cursor-pointer border-b-2 transition-all duration-250 ${
            activeTab === "departments" 
              ? "border-saffron text-onyx" 
              : "border-transparent text-onyx/40 hover:text-onyx"
          }`}
        >
          Departments & Subdepartments
        </button>
      </div>

      {activeTab === "items" && (
        <>
          {/* Grid filters & Search */}
          <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 w-full">
              <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                <Search size={15} />
              </span>
          <input
            type="text"
            placeholder="Search by name, code, make..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Category */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Department */}
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
          >
            <option value="all">All Departments</option>
            {departmentsList.map(d => (
              <option key={d.id} value={d.id}>
                {getDepartmentName(d.id)}
              </option>
            ))}
          </select>

          {/* Type */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
          >
            <option value="all">All Types</option>
            <option value="RAW_MATERIAL">Raw Material</option>
            <option value="CONSUMABLE">Consumable</option>
            <option value="SPARE">Spare</option>
            <option value="TOOL">Tool</option>
            <option value="PACKING">Packing</option>
            <option value="SEMI_FINISHED">Semi-finished</option>
            <option value="FINISHED_GOOD">Finished Good</option>
          </select>

          {/* Status */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
          >
            <option value="all">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>
        </div>

        {/* Bulk Actions */}
        {selectedItemIds.length > 0 && (
          <div className="flex items-center space-x-2 w-full md:w-auto shrink-0 animate-in fade-in duration-200">
            <button
              onClick={exportSelectedToExcel}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <FileSpreadsheet size={14} />
              <span>Export ({selectedItemIds.length})</span>
            </button>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow-md transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Trash2 size={14} />
              <span>Delete ({selectedItemIds.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Reorders Error / Success Alerts */}
      {reordersError && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-r-lg text-xs text-red-800 font-semibold flex items-center space-x-2 animate-in fade-in duration-200">
          <ShieldAlert size={14} className="text-red-500 shrink-0" />
          <span>{reordersError}</span>
        </div>
      )}

      {reordersSuccess && (
        <div className="p-3 bg-green-50 border-l-4 border-green-500 rounded-r-lg text-xs text-green-800 font-semibold flex items-center space-x-2 animate-in fade-in duration-200">
          <Check size={14} className="text-green-500 shrink-0" />
          <span>{reordersSuccess}</span>
        </div>
      )}

      {/* Bulk Reorder Edit Actions Banner */}
      {isEditingReorders && (
        <div className="glass-card bg-cream-dark/45 border-l-4 border-saffron p-4 rounded-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center space-x-2.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-saffron opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-saffron-dark"></span>
            </span>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-onyx">✏️ Bulk Editing Reorder Levels</h4>
              <p className="text-[10px] text-onyx/50 mt-0.5">Adjust reorder levels directly in the table cells below. Click Save to commit changes.</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={cancelEditingReorders}
              disabled={isSavingReorders}
              type="button"
              className="px-3 py-1.5 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={saveReorders}
              disabled={isSavingReorders}
              type="button"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-saffron hover:bg-saffron-dark text-xs font-bold text-onyx rounded-lg shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
            >
              {isSavingReorders ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={13} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Dense Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredItems.length > 0 && selectedItemIds.length === filteredItems.length}
                    onChange={toggleSelectAllItems}
                    className="rounded text-saffron focus:ring-saffron"
                  />
                </th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>Department</th>
                <th>Type</th>
                <th>Base UOM</th>
                <th className="text-right">
                  <button
                    onClick={isEditingReorders ? cancelEditingReorders : startEditingReorders}
                    type="button"
                    className={`inline-flex items-center space-x-1.5 hover:text-saffron transition-colors cursor-pointer ml-auto font-bold uppercase tracking-wider text-right ${
                      isEditingReorders ? "text-saffron font-black" : ""
                    }`}
                    title={isEditingReorders ? "Cancel Edit Mode" : "Click to edit Reorder Levels inline"}
                  >
                    <span>Reorder Level</span>
                    <Edit3 size={12} className={isEditingReorders ? "text-saffron animate-pulse" : "text-onyx/40"} />
                  </button>
                </th>
                <th className="text-center">QC Check</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-onyx/40 font-medium">
                    No items found matching the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const cat = categories.find(c => c.id === item.categoryId);
                  return (
                    <tr key={item.id}>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={selectedItemIds.includes(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          className="rounded text-saffron focus:ring-saffron"
                        />
                      </td>
                      <td className="font-mono font-bold text-xs text-onyx/85">{item.code}</td>
                      <td>
                        <div>
                          <p className="font-semibold">{item.name}</p>
                          {item.make && (
                            <p className="text-[10px] text-onyx/40 mt-0.5">Brand: {item.make}</p>
                          )}
                        </div>
                      </td>
                      <td>{cat?.name || "N/A"}</td>
                      <td className="text-xs text-onyx/75 font-medium">{getDepartmentName(item.departmentId)}</td>
                      <td className="text-[11px] font-medium text-onyx/65">
                        {item.type.replace("_", " ")}
                      </td>
                      <td>{item.baseUom}</td>
                      <td className="text-right">
                        {isEditingReorders ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={tempReorders[item.id] !== undefined ? tempReorders[item.id] : ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setTempReorders(prev => ({
                                ...prev,
                                [item.id]: raw === "" ? "" as any : parseFloat(raw)
                              }));
                            }}
                            disabled={isSavingReorders}
                            className="w-20 px-2 py-0.5 text-right bg-white border border-onyx/20 rounded focus:outline-none focus:border-saffron focus:ring-1 focus:ring-saffron text-xs font-mono font-bold transition-all"
                          />
                        ) : (
                          <span className="font-semibold font-mono">{item.reorderLevel}</span>
                        )}
                      </td>
                      <td className="text-center">
                        {item.qcRequired ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                            Required
                          </span>
                        ) : (
                          <span className="text-[10px] text-onyx/40">Standard</span>
                        )}
                      </td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          item.status === "ACTIVE" 
                            ? "bg-green-100 text-green-800" 
                            : "bg-gray-100 text-gray-800"
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => {
                              setSelectedItem(item);
                              setIsDetailOpen(true);
                            }}
                            title="View Specs"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(item)}
                            title="Edit"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(item)}
                            title={item.status === "ACTIVE" ? "Deactivate" : "Activate"}
                            className={`p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded ${
                              item.status === "ACTIVE" ? "text-red-600 hover:text-red-700" : "text-green-600 hover:text-green-700"
                            }`}
                          >
                            <Power size={14} />
                          </button>
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
      </>
      )}

      {/* TAB CONTENT: DEPARTMENTS */}
      {activeTab === "departments" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-200">
          {/* Departments List Column */}
          <div className="md:col-span-2 space-y-4">
            <div className="glass-card p-5 rounded-xl border border-onyx/5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-onyx/5 pb-2.5">
                <h3 className="text-xs font-bold text-onyx/65 uppercase tracking-wider">Departments & Subdepartments</h3>
                <span className="text-[10px] bg-saffron/10 text-saffron-dark font-bold px-2 py-0.5 rounded-full border border-saffron/20">
                  {departmentsList.length} Total
                </span>
              </div>

              {departmentsList.length === 0 ? (
                <div className="text-center py-12 text-onyx/40 text-xs">
                  No departments created yet. Use the form on the right to add one.
                </div>
              ) : (
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                  {/* Render parent departments first, then their children */}
                  {departmentsList
                    .filter(d => !d.parentId)
                    .map(parent => {
                      const children = departmentsList.filter(c => c.parentId === parent.id);
                      return (
                        <div key={parent.id} className="p-3.5 bg-cream/40 border border-onyx/5 rounded-xl space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-mono font-bold text-xs text-saffron-dark bg-saffron/5 border border-saffron/10 px-2 py-0.5 rounded-md mr-2">{parent.code}</span>
                              <span className="font-bold text-xs text-onyx">{parent.name}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleEditDept(parent)}
                                className="p-1 text-onyx/50 hover:text-saffron-dark hover:bg-cream-dark/50 rounded-lg transition-colors cursor-pointer"
                                title="Edit Department"
                              >
                                <Edit3 size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteDept(parent.id)}
                                className="p-1 text-onyx/50 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                title="Delete Department"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          {children.length > 0 && (
                            <div className="pl-6 border-l-2 border-onyx/5 space-y-2">
                              {children.map(child => (
                                <div key={child.id} className="flex items-center justify-between p-2 bg-white/60 border border-onyx/5 rounded-lg">
                                  <div>
                                    <span className="font-mono text-[10px] text-onyx/60 bg-onyx/5 px-1.5 py-0.5 rounded mr-2">{child.code}</span>
                                    <span className="text-xs text-onyx/80 font-semibold">{child.name}</span>
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

          {/* Department Form Column */}
          <div className="space-y-4">
            <div className="glass-card p-5 rounded-xl border border-onyx/5 shadow-sm space-y-4">
              <div className="border-b border-onyx/5 pb-2.5">
                <h3 className="text-xs font-bold text-onyx/65 uppercase tracking-wider">
                  {deptFormMode === "create" ? "Add Department / Subdepartment" : "Edit Department"}
                </h3>
              </div>

              {deptFormError && (
                <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-r-lg text-xs text-red-800 font-semibold flex items-center space-x-2 animate-in fade-in duration-200">
                  <ShieldAlert size={14} className="text-red-500 shrink-0" />
                  <span>{deptFormError}</span>
                </div>
              )}

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
                    disabled={deptFormLoading}
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
                    disabled={deptFormLoading}
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
                    disabled={deptFormLoading}
                  >
                    <option value="">None (Make it a Top-level Department)</option>
                    {departmentsList
                      .filter(d => !d.parentId && d.id !== deptFormData.id) // Only allow top-level departments as parent to prevent cycles
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
                        setDeptFormError(null);
                      }}
                      className="flex-1 py-2 border border-onyx/10 hover:bg-cream-dark text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      disabled={deptFormLoading}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-saffron hover:bg-saffron-dark text-xs font-bold text-onyx rounded-lg shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
                    disabled={deptFormLoading}
                  >
                    {deptFormLoading ? "Saving..." : deptFormMode === "create" ? "Add Department" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Creation / Editing Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">
                {modalMode === "create" ? "Create Item Master Coding" : `Edit Item Coding (${formData.code})`}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:text-saffron transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <ShieldAlert className="text-red-500 mt-0.5 shrink-0" size={16} />
                  <span>{formError}</span>
                </div>
              )}

              {/* Categorization & Coding */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Item Category *
                  </label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => handleFormCategoryChange(e.target.value)}
                    disabled={modalMode === "edit"}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  >
                    <option value="">Select Category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Item Code (Auto-Generated)
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                    disabled={modalMode === "edit"} // Keep codes stable once created
                    placeholder="Auto-generated on category select"
                    className="w-full text-xs p-2 bg-cream-dark/20 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono font-bold"
                  />
                </div>
              </div>

              {/* Department Assignment */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Department / Subdepartment Scope
                </label>
                <select
                  value={formData.departmentId}
                  onChange={(e) => setFormData(prev => ({ ...prev, departmentId: e.target.value }))}
                  className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                >
                  <option value="">Select Department (Optional / Generic)</option>
                  {departmentsList.map(d => (
                    <option key={d.id} value={d.id}>
                      {getDepartmentName(d.id)}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-onyx/40 mt-1">Select the department this item belongs to.</p>
              </div>

              {/* Core Details */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Item Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. MS Steel Sheet 2.5mm"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Provide details about grades, usage, or specifications..."
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron h-16 resize-none"
                  />
                </div>
              </div>

              {/* Attributes Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Item Type *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  >
                    <option value="RAW_MATERIAL">Raw Material</option>
                    <option value="CONSUMABLE">Consumable</option>
                    <option value="SPARE">Spare</option>
                    <option value="TOOL">Tool</option>
                    <option value="PACKING">Packing</option>
                    <option value="SEMI_FINISHED">Semi-finished</option>
                    <option value="FINISHED_GOOD">Finished Good</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Base UOM *
                  </label>
                  <input
                    type="text"
                    value={formData.baseUom}
                    onChange={(e) => setFormData(prev => ({ ...prev, baseUom: e.target.value.toUpperCase() }))}
                    placeholder="e.g. KG, PCS, BOX, MTR"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Valuation Method
                  </label>
                  <select
                    value={formData.valuation}
                    onChange={(e) => setFormData(prev => ({ ...prev, valuation: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  >
                    <option value="WEIGHTED_AVG">Weighted Average</option>
                    <option value="FIFO">FIFO</option>
                  </select>
                </div>
              </div>

              {/* Alternate UOM (Optional) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-cream-dark/20 p-3.5 rounded-lg border border-onyx/5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Alternate UOM (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.altUom}
                    onChange={(e) => setFormData(prev => ({ ...prev, altUom: e.target.value.toUpperCase() }))}
                    placeholder="e.g. BOX (if base is PCS)"
                    className="w-full text-xs p-2 bg-cream/50 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Conversion Factor (e.g. 1 Alt UOM = X Base)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.altUomFactor}
                    onChange={(e) => setFormData(prev => ({ ...prev, altUomFactor: e.target.value }))}
                    placeholder="e.g. 50 (50 PCS per BOX)"
                    className="w-full text-xs p-2 bg-cream/50 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
              </div>

              {/* Inventory Thresholds */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Reorder Level
                  </label>
                  <input
                    type="number"
                    value={formData.reorderLevel}
                    onChange={(e) => setFormData(prev => ({ ...prev, reorderLevel: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Min Stock
                  </label>
                  <input
                    type="number"
                    value={formData.minStock}
                    onChange={(e) => setFormData(prev => ({ ...prev, minStock: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Max Stock
                  </label>
                  <input
                    type="number"
                    value={formData.maxStock}
                    onChange={(e) => setFormData(prev => ({ ...prev, maxStock: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Lead Time (Days)
                  </label>
                  <input
                    type="number"
                    value={formData.leadTimeDays}
                    onChange={(e) => setFormData(prev => ({ ...prev, leadTimeDays: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
              </div>

              {/* Manufacturing & QC details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Shelf Life (Days)
                  </label>
                  <input
                    type="number"
                    value={formData.shelfLifeDays}
                    onChange={(e) => setFormData(prev => ({ ...prev, shelfLifeDays: e.target.value }))}
                    placeholder="Null = Infinite"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Make/Brand (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.make}
                    onChange={(e) => setFormData(prev => ({ ...prev, make: e.target.value }))}
                    placeholder="e.g. Tata, Bosch, SKF"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
                <div className="flex items-center h-full pt-5 pl-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.qcRequired}
                      onChange={(e) => setFormData(prev => ({ ...prev, qcRequired: e.target.checked }))}
                      className="w-4 h-4 rounded text-saffron bg-cream border-onyx/10 focus:ring-saffron"
                    />
                    <span className="text-xs font-bold text-onyx/80">Incoming QC Required</span>
                  </label>
                </div>
              </div>

              {/* Billing / HSN / Tax details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    value={formData.hsnCode}
                    onChange={(e) => setFormData(prev => ({ ...prev, hsnCode: e.target.value }))}
                    placeholder="e.g. 7210 4900"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    value={formData.gstRate}
                    onChange={(e) => setFormData(prev => ({ ...prev, gstRate: e.target.value }))}
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                  />
                </div>
              </div>

              {/* Specification Text */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Product Technical Specification
                </label>
                <input
                  type="text"
                  value={formData.specification}
                  onChange={(e) => setFormData(prev => ({ ...prev, specification: e.target.value }))}
                  placeholder="e.g. Grade IS 2062, Hot Rolled, Pickled & Oiled"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow shadow-saffron-dark/50 cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? "Saving..." : "Save Item to Master"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-4xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Upload size={20} className="text-saffron" />
                <h3 className="font-heading text-lg font-bold text-cream-light">Bulk Import Items</h3>
              </div>
              <button 
                onClick={() => {
                  setIsBulkModalOpen(false);
                  setBulkFile(null);
                  setBulkData(null);
                  setImportError(null);
                  setImportSuccess(null);
                }} 
                className="hover:text-saffron transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Instructions and Template Download */}
              <div className="bg-cream-dark/20 border border-onyx/5 p-4 rounded-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-onyx/80">Instructions</h4>
                  <ul className="text-[11px] text-onyx/60 list-disc list-inside space-y-1">
                    <li>Download the template below. Supported formats: Excel (.xlsx, .xls) and CSV (.csv).</li>
                    <li>Required columns are: <strong className="text-onyx/80">Item Name, Category Code, Item Type, Base UOM</strong>.</li>
                    <li>Category Code must match an existing category (e.g. <strong>RM, CONS</strong>).</li>
                    <li>Item Type must be one of: <strong>RAW_MATERIAL, CONSUMABLE, SPARE, TOOL, PACKING, SEMI_FINISHED, FINISHED_GOOD</strong>.</li>
                  </ul>
                </div>
                <div>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-sm transition-all duration-150 cursor-pointer w-full md:w-auto justify-center"
                  >
                    <FileSpreadsheet size={15} />
                    <span>Download Template</span>
                  </button>
                </div>
              </div>

              {/* Status Alert Messages */}
              {importError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <ShieldAlert className="text-red-500 mt-0.5 shrink-0" size={16} />
                  <span className="whitespace-pre-line">{importError}</span>
                </div>
              )}

              {importSuccess && (
                <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-lg flex items-start space-x-3 text-xs text-green-800 font-semibold">
                  <span className="text-green-500 text-base leading-none">✓</span>
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* File Dropzone Area */}
              {!bulkData && (
                <div className="relative border-2 border-dashed border-onyx/20 hover:border-saffron hover:bg-cream-dark/10 rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all duration-200 min-h-[160px]">
                  <Upload size={32} className="text-onyx/30" />
                  <div className="text-center">
                    <p className="text-xs font-bold text-onyx/75">Select or drop your Excel/CSV file here</p>
                    <p className="text-[10px] text-onyx/40 mt-1">Accepts .xlsx, .xls, and .csv formats</p>
                  </div>
                  <label className="mt-2 px-3.5 py-1.5 bg-white border border-onyx/10 rounded-lg text-xs font-bold hover:bg-cream-dark/50 cursor-pointer shadow-sm">
                    Select File
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* Verification Preview Grid */}
              {bulkData && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-bold text-onyx/85">File: <span className="font-mono">{bulkFile?.name}</span></span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-onyx/5 text-onyx/65">
                        {bulkData.length} rows parsed
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setBulkFile(null);
                        setBulkData(null);
                        setImportError(null);
                        setImportSuccess(null);
                      }}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                    >
                      Clear File
                    </button>
                  </div>

                  <div className="border border-onyx/15 rounded-xl overflow-hidden shadow-sm max-h-[300px] overflow-y-auto">
                    <table className="w-full dense-table text-left border-collapse">
                      <thead className="sticky top-0 bg-onyx text-cream-light z-10">
                        <tr>
                          <th className="w-12 text-center">Row</th>
                          <th className="w-12 text-center">Status</th>
                          <th>Item Name</th>
                          <th>Code</th>
                          <th>Category</th>
                          <th>Type</th>
                          <th>UOM</th>
                          <th>Validation Feedback</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkData.map((row, idx) => (
                          <tr 
                            key={idx} 
                            className={`border-b border-onyx/5 ${
                              row.isValid ? "hover:bg-green-50/30" : "bg-red-50/20 hover:bg-red-50/40"
                            }`}
                          >
                            <td className="text-center font-mono font-bold text-onyx/50 text-[10px]">{row.rowNum}</td>
                            <td className="text-center py-2">
                              {row.isValid ? (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-800 text-xs font-bold">✓</span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-800 text-xs font-bold">!</span>
                              )}
                            </td>
                            <td className="font-semibold text-xs text-onyx/90">{row.data.name || "—"}</td>
                            <td className="font-mono font-semibold text-[11px] text-onyx/70">{row.data.code || "(Auto)"}</td>
                            <td className="text-xs text-onyx/75 font-mono">{row.data.categoryCode || "—"}</td>
                            <td className="text-[10px] text-onyx/65 font-bold uppercase">{row.data.type?.replace("_", " ")}</td>
                            <td className="text-xs text-onyx/70 font-semibold">{row.data.baseUom || "—"}</td>
                            <td className="text-[10px] font-medium text-red-700 max-w-xs truncate">
                              {row.isValid ? (
                                row.warnings && row.warnings.length > 0 ? (
                                  <span className="text-amber-600 font-bold">{row.warnings.join("; ")}</span>
                                ) : (
                                  <span className="text-green-700 font-semibold">Valid row</span>
                                )
                              ) : (
                                <span className="text-red-700 font-semibold">{row.errors.join("; ")}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-cream-dark/15 border-t border-onyx/10 flex items-center justify-between">
              <div>
                {bulkData && (
                  <p className="text-[11px] text-onyx/50 font-medium">
                    {bulkData.filter(r => r.isValid).length} of {bulkData.length} rows are valid. All rows must be valid to import.
                  </p>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsBulkModalOpen(false);
                    setBulkFile(null);
                    setBulkData(null);
                    setImportError(null);
                    setImportSuccess(null);
                  }}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkSubmit}
                  disabled={isImporting || !bulkData || bulkData.some(r => !r.isValid)}
                  className="flex items-center space-x-2 px-4 py-2 bg-saffron hover:bg-saffron-dark disabled:opacity-40 rounded-lg text-xs font-bold text-onyx shadow shadow-saffron-dark/50 cursor-pointer"
                >
                  <span>{isImporting ? "Importing..." : "Import Items"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Item Detail Side Drawer */}
      {isDetailOpen && selectedItem && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-md bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 overflow-y-auto relative animate-in slide-in-from-right duration-200">
            <button 
              onClick={() => setIsDetailOpen(false)} 
              className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer"
            >
              <X size={20} />
            </button>

            {/* Header */}
            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedItem.code}
              </span>
              <h3 className="font-heading text-xl font-extrabold text-onyx leading-tight">
                {selectedItem.name}
              </h3>
              <p className="text-xs text-onyx/50">{selectedItem.description || "No description provided."}</p>
            </div>

            {/* Specifications Details */}
            <div className="py-6 space-y-6 flex-1">
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40 mb-2">
                  Technical Specifications
                </h4>
                <div className="glass-card p-4 rounded-lg border border-onyx/5 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-onyx/65">Make/Brand</span>
                    <span className="font-bold text-onyx">{selectedItem.make || "Standard"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-onyx/65">Specs Details</span>
                    <span className="font-bold text-onyx text-right max-w-[200px] truncate" title={selectedItem.specification || "N/A"}>
                      {selectedItem.specification || "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-onyx/65">HSN Code</span>
                    <span className="font-mono font-bold text-onyx">{selectedItem.hsnCode || "N/A"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-onyx/65">GST Rate</span>
                    <span className="font-bold text-onyx">{selectedItem.gstRate}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-onyx/65">Department</span>
                    <span className="font-bold text-onyx">{getDepartmentName(selectedItem.departmentId)}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40 mb-2">
                  Stock Parameters
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-cream-dark/30 p-3 rounded-lg border border-onyx/5 text-center">
                    <span className="text-[10px] font-bold text-onyx/40">Base UOM</span>
                    <p className="text-lg font-extrabold mt-0.5">{selectedItem.baseUom}</p>
                  </div>
                  <div className="bg-cream-dark/30 p-3 rounded-lg border border-onyx/5 text-center">
                    <span className="text-[10px] font-bold text-onyx/40">Reorder Level</span>
                    <p className="text-lg font-extrabold font-mono mt-0.5">{selectedItem.reorderLevel}</p>
                  </div>
                  <div className="bg-cream-dark/30 p-3 rounded-lg border border-onyx/5 text-center">
                    <span className="text-[10px] font-bold text-onyx/40">Min Stock</span>
                    <p className="text-lg font-extrabold font-mono mt-0.5">{selectedItem.minStock}</p>
                  </div>
                  <div className="bg-cream-dark/30 p-3 rounded-lg border border-onyx/5 text-center">
                    <span className="text-[10px] font-bold text-onyx/40">Max Stock</span>
                    <p className="text-lg font-extrabold font-mono mt-0.5">{selectedItem.maxStock}</p>
                  </div>
                </div>
              </div>

              {selectedItem.altUom && (
                <div className="bg-saffron/10 border border-saffron/20 p-4 rounded-lg flex items-start space-x-3">
                  <Info className="text-saffron-dark shrink-0 mt-0.5" size={16} />
                  <p className="text-xs text-onyx/80 leading-normal">
                    This item has dual UOM mappings enabled: <strong>1 {selectedItem.altUom}</strong> converts to <strong>{selectedItem.altUomFactor} {selectedItem.baseUom}</strong> inside the stock ledger.
                  </p>
                </div>
              )}
            </div>

            {/* Footer close */}
            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="w-full py-2 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close Spec Panel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
