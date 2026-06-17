"use client";

import { useState, useEffect } from "react";
import { 
  createPO, 
  submitForApproval, 
  approvePO, 
  amendPO, 
  cancelPO,
  updatePO
} from "@/app/actions/purchaseOrders";
import { SearchableItemSelect } from "@/components/SearchableItemSelect";
import { PoType } from "@prisma/client";
import { limitYearTo4Digits } from "@/lib/date";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  Search, 
  Plus, 
  X, 
  Trash2, 
  Check, 
  RefreshCw, 
  Eye, 
  AlertCircle, 
  ShieldCheck, 
  Edit3, 
  FileText,
  Building2,
  Calendar,
  History,
  MapPin,
  Settings
} from "lucide-react";

interface LineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  qty: number;
  rate: number;
  discount: number;
  gstRate: number;
  receivedQty: number;
}

interface AmendmentRecord {
  id: string;
  version: number;
  reason: string | null;
  createdAt: string;
  createdBy: string;
  snapshot: any;
}

interface PORecord {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  vendorAddress: string | null;
  vendorGstin: string | null;
  vendorPan: string | null;
  type: string;
  status: string;
  orderDate: string;
  deliveryDate: string | null;
  paymentTerms: string | null;
  freightTerms: string | null;
  shipTo: string | null;
  termsConditions: string | null;
  termsPresetId: string | null;
  termsVersion: number | null;
  resolvedTermsText: string | null;
  version: number;
  approvedBy: string | null;
  approvedAt: string | null;
  totalValue: number;
  lines: LineItem[];
  amendments: AmendmentRecord[];
  otherCharges: number;
  rfqNumbers?: string[];
  prNumbers?: string[];
  indentNumbers?: string[];
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

interface ShipToLocation {
  id: string;
  code: string;
  name: string;
  address: string;
  gstin: string | null;
}

interface Preset {
  id: string;
  key: string;
  name: string;
  description: string | null;
  appliesTo: string[];
  isDefault: boolean;
  bodyMarkdown: string;
  tokenDefaults: any;
  version: number;
}

interface CompanyProfile {
  name: string;
  address: string | null;
  gstin: string | null;
  city: string | null;
  governingPlace: string | null;
  legalName?: string | null;
  displayName?: string | null;
  logoUrl?: string | null;
  registeredAddress?: string | null;
  pan?: string | null;
  cin?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

interface TermsConfig {
  id: string;
  companyId: string;
  inspectionDays: number;
  replacementDays: number;
  returnCollectionDays: number;
  qtyTolerancePct: number;
  warrantyMonths: number;
  sparesYears: number;
  ldPctPerDay: number;
  ldCapPct: number;
  creditDays: number;
  latentDefectDays: number;
  fmTerminationDays: number;
  cureDays: number;
  arbitrationForum: string;
  jurisdictionCity: string | null;
}

import { can, SessionUser } from "@/lib/rbac";

interface PurchaseOrdersListProps {
  initialPOs: PORecord[];
  items: Item[];
  vendors: (Vendor & { creditDays: number; paymentTerms: string | null })[];
  shipToLocations: ShipToLocation[];
  presets: Preset[];
  companyProfile: CompanyProfile | null;
  termsConfig: TermsConfig | null;
  user: SessionUser;
}

export default function PurchaseOrdersList({
  initialPOs,
  items,
  vendors,
  shipToLocations,
  presets = [],
  companyProfile,
  termsConfig,
  user
}: PurchaseOrdersListProps) {
  const [purchaseOrders, setPurchaseOrders] = useState<PORecord[]>(initialPOs);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const statusParam = params.get("status");
      if (statusParam) {
        setStatusFilter(statusParam.toUpperCase());
      }
    }
  }, []);

  // Dialog & Form States
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isAmendOpen, setIsAmendOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PORecord | null>(null);
  const [editingPOId, setEditingPOId] = useState<string | null>(null);
  const [selectedPOIds, setSelectedPOIds] = useState<string[]>([]);

  // New PO Form State
  const [newPo, setNewPo] = useState<{
    vendorId: string;
    type: PoType;
    deliveryDate: string;
    paymentTerms: string;
    freightTerms: string;
    shipTo: string;
    termsConditions: string;
    termsPresetId: string;
    otherCharges: number;
    lines: { itemId: string; qty: number; rate: number; discount: number; gstRate: number }[];
    rfqId?: string | null;
  }>({
    vendorId: "",
    type: "REGULAR" as PoType,
    deliveryDate: "",
    paymentTerms: "Net 30",
    freightTerms: "FOB Destination",
    shipTo: "",
    termsConditions: "1. Standard warranty of 1 year applies from the date of receipt.\n2. Goods must be delivered in proper industrial packaging.\n3. Late delivery penalty of 0.5% per week, capped at 5% of total PO value.",
    termsPresetId: "",
    otherCharges: 0,
    lines: []
  });
  const [newPoLine, setNewPoLine] = useState({ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18 });

  // Amend Form State
  const [amendForm, setAmendForm] = useState({
    reason: "",
    paymentTerms: "",
    freightTerms: "",
    deliveryDate: "",
    shipTo: "",
    termsConditions: "",
    termsPresetId: "",
    otherCharges: 0,
    lines: [] as { itemId: string; qty: number; rate: number; discount: number; gstRate: number }[]
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canApprove = can(user, "po.approve") || ["ADMIN", "OWNER"].includes(user.role);
  const isPurchase = can(user, "po.create") || ["ADMIN", "OWNER"].includes(user.role);

  // Check sessionStorage for prefilled quotes
  useEffect(() => {
    const prefillStr = sessionStorage.getItem("draft_po_prefill");
    if (prefillStr) {
      try {
        const prefill = JSON.parse(prefillStr);
        setNewPo({
          vendorId: prefill.vendorId || "",
          type: "REGULAR",
          deliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          paymentTerms: prefill.paymentTerms || "Net 30",
          freightTerms: prefill.freightTerms || "FOB Destination",
          shipTo: prefill.shipTo || (shipToLocations.length > 0 ? `${shipToLocations[0].name} (${shipToLocations[0].address})` : ""),
          termsConditions: prefill.termsConditions || "1. Standard warranty of 1 year applies from the date of receipt.\n2. Goods must be delivered in proper industrial packaging.\n3. Late delivery penalty of 0.5% per week, capped at 5% of total PO value.",
          termsPresetId: "",
          otherCharges: prefill.otherCharges || 0,
          lines: prefill.lines || []
        });
        setIsOpen(true);
        sessionStorage.removeItem("draft_po_prefill");
      } catch (e) {
        console.error("Failed to parse prefill data", e);
      }
    }
  }, [shipToLocations]);

  // Auto-select default preset on PO type change
  useEffect(() => {
    if (!presets || presets.length === 0) return;
    const defPreset = presets.find(p => p.appliesTo.includes(newPo.type) && p.isDefault);
    if (defPreset) {
      setNewPo(prev => ({ ...prev, termsPresetId: defPreset.id }));
    } else {
      setNewPo(prev => ({ ...prev, termsPresetId: "" }));
    }
  }, [newPo.type, presets]);

  // Live token-resolved terms resolver
  const resolveTermsPreview = (presetIdsString: string, poData: any) => {
    let resolved = "";
    if (presetIdsString) {
      const ids = presetIdsString.split(",").map(id => id.trim()).filter(Boolean);
      const resolvedTexts: string[] = [];

      for (const presetId of ids) {
        const preset = presets.find(p => p.id === presetId);
        if (!preset) continue;

        const vendor = vendors.find(v => v.id === poData.vendorId);

        const defaults = {
          inspectionDays: termsConfig?.inspectionDays ?? 7,
          replacementDays: termsConfig?.replacementDays ?? 15,
          returnCollectionDays: termsConfig?.returnCollectionDays ?? 30,
          qtyTolerancePct: termsConfig?.qtyTolerancePct ?? 0,
          warrantyMonths: termsConfig?.warrantyMonths ?? 24,
          sparesYears: termsConfig?.sparesYears ?? 10,
          ldPctPerDay: termsConfig?.ldPctPerDay ?? 0.5,
          ldCapPct: termsConfig?.ldCapPct ?? 100,
          creditDays: termsConfig?.creditDays ?? 45,
          latentDefectDays: termsConfig?.latentDefectDays ?? 90,
          fmTerminationDays: termsConfig?.fmTerminationDays ?? 45,
          cureDays: termsConfig?.cureDays ?? 30,
          arbitrationForum: termsConfig?.arbitrationForum ?? "Arbitration and Conciliation Act, 1996",
          jurisdictionCity: termsConfig?.jurisdictionCity ?? companyProfile?.city ?? "New Delhi",
        };

        const previewPo = {
          number: poData.number || "DRAFT-PO",
          orderDate: poData.orderDate ? new Date(poData.orderDate) : new Date(),
          freightTerms: poData.freightTerms || "FOB Destination",
          shipTo: poData.shipTo || "Main Warehouse Gate 1",
          paymentTerms: poData.paymentTerms || "Net 30",
        };

        const tokenDefaults = preset.tokenDefaults || {};

        const resolverMap: Record<string, any> = {
          COMPANY_NAME: companyProfile?.legalName || companyProfile?.displayName || companyProfile?.name || "SAARLEKHA INDUSTRIES PVT LTD",
          COMPANY_ADDRESS: companyProfile?.registeredAddress || companyProfile?.address || null,
          COMPANY_GSTIN: companyProfile?.gstin || null,
          COMPANY_CITY: companyProfile?.city || null,
          GOVERNING_PLACE: companyProfile?.governingPlace || null,

          PO_NUMBER: previewPo.number,
          PO_DATE: previewPo.orderDate.toLocaleDateString("en-IN"),
          DELIVERY_TERMS: previewPo.freightTerms,
          DELIVERY_LOCATION: previewPo.shipTo,
          PAYMENT_MODE: previewPo.paymentTerms,

          CREDIT_DAYS: (vendor?.creditDays !== undefined && vendor?.creditDays !== 0) 
            ? vendor.creditDays 
            : (tokenDefaults.creditDays ?? defaults.creditDays),
          INSPECTION_DAYS: tokenDefaults.inspectionDays ?? defaults.inspectionDays,
          REPLACEMENT_DAYS: tokenDefaults.replacementDays ?? defaults.replacementDays,
          RETURN_COLLECTION_DAYS: tokenDefaults.returnCollectionDays ?? defaults.returnCollectionDays,
          QTY_TOLERANCE_PCT: tokenDefaults.qtyTolerancePct ?? defaults.qtyTolerancePct,
          WARRANTY_MONTHS: tokenDefaults.warrantyMonths ?? defaults.warrantyMonths,
          LATENT_DEFECT_DAYS: tokenDefaults.latentDefectDays ?? defaults.latentDefectDays,
          SPARES_YEARS: tokenDefaults.sparesYears ?? defaults.sparesYears,
          LD_PCT_PER_DAY: tokenDefaults.ldPctPerDay ?? defaults.ldPctPerDay,
          LD_CAP_PCT: tokenDefaults.ldCapPct ?? defaults.ldCapPct,
          FM_TERMINATION_DAYS: tokenDefaults.fmTerminationDays ?? defaults.fmTerminationDays,
          CURE_DAYS: tokenDefaults.cureDays ?? defaults.cureDays,
          ARBITRATION_FORUM: tokenDefaults.arbitrationForum ?? defaults.arbitrationForum,
          JURISDICTION_CITY: tokenDefaults.jurisdictionCity ?? defaults.jurisdictionCity,
        };

        let text = preset.bodyMarkdown || "";
        Object.entries(resolverMap).forEach(([token, val]) => {
          text = text.replaceAll(`{{${token}}}`, val !== undefined && val !== null && val !== "" ? String(val) : `[Missing ${token}]`);
        });

        resolvedTexts.push(`### ${preset.name}\n\n${text}`);
      }
      resolved = resolvedTexts.join("\n\n---\n\n");
    }

    if (poData.termsConditions) {
      if (resolved) {
        resolved += "\n\n---\n\n### ADDITIONAL CUSTOM TERMS & CONDITIONS\n\n" + poData.termsConditions;
      } else {
        resolved = poData.termsConditions;
      }
    }

    return resolved;
  };

  const getMissingTokensList = (text: string) => {
    const missing: string[] = [];
    const regex = /\[Missing ([A-Z_]+)\]|\{\{([A-Z_]+)\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      missing.push(match[1] || match[2]);
    }
    return Array.from(new Set(missing));
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
      if (para.trim().startsWith("<li")) {
        return `<ul class="my-1.5">${para}</ul>`;
      }
      return `<p class="text-xs text-onyx/80 leading-relaxed mb-2">${para.replace(/\n/g, "<br/>")}</p>`;
    }).join("");

    return html;
  };

  const calculateLandedCost = (
    qty: number,
    rate: number,
    discount: number,
    gstRate: number,
    totalTaxable = 0,
    otherCharges = 0
  ) => {
    const basic = qty * rate;
    const discounted = basic * (1 - discount / 100);
    const allocatedOtherCharges = totalTaxable > 0 ? otherCharges * (discounted / totalTaxable) : 0;
    return (discounted + allocatedOtherCharges) * (1 + gstRate / 100);
  };

  const getLandedTotal = (lines: { qty: number; rate: number; discount: number; gstRate: number }[], otherCharges = 0) => {
    return computePoTotals(lines, otherCharges).grandTotal;
  };

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

  const handleExportPDF = async (po: PORecord) => {
    const doc = new jsPDF();

    let logoImg: HTMLImageElement | null = null;
    if (companyProfile?.logoUrl) {
      try {
        logoImg = await new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = companyProfile.logoUrl!;
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
        });
      } catch (e) {
        console.error("Failed to load logo", e);
      }
    }

    const startX = logoImg ? 42 : 14;
    const maxChars = logoImg ? 65 : 85;

    if (logoImg) {
      doc.addImage(logoImg, "PNG", 14, 12, 23, 23);
    }

    // 1. Header Section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 30, 30);
    const compName = companyProfile?.legalName || companyProfile?.displayName || companyProfile?.name || "SAARLEKHA INDUSTRIES PVT LTD";
    doc.text(compName, startX, 18);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    
    let headerY = 22.5;
    const compAddr = companyProfile?.registeredAddress || companyProfile?.address || "";
    if (compAddr) {
      const compAddrShort = compAddr.length > maxChars ? compAddr.slice(0, maxChars) + "..." : compAddr;
      doc.text(compAddrShort, startX, headerY);
      headerY += 4;
    }

    const emailVal = companyProfile?.contactEmail ? `Email: ${companyProfile.contactEmail}` : "";
    const phoneVal = companyProfile?.contactPhone ? `Tel: ${companyProfile.contactPhone}` : "";
    const contactLine = [emailVal, phoneVal].filter(Boolean).join(" | ");
    if (contactLine) {
      doc.text(contactLine, startX, headerY);
      headerY += 4;
    }

    const gstinVal = companyProfile?.gstin ? `GSTIN: ${companyProfile.gstin}` : "";
    const panVal = companyProfile?.pan ? `PAN: ${companyProfile.pan}` : "";
    const gstinPanLine = [gstinVal, panVal].filter(Boolean).join(" | ");
    if (gstinPanLine) {
      doc.text(gstinPanLine, startX, headerY);
      headerY += 4;
    }

    if (companyProfile?.cin) {
      doc.text(`CIN: ${companyProfile.cin}`, startX, headerY);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(224, 130, 4); // Saffron color
    doc.text("PURCHASE ORDER", 140, 20);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);
    doc.text(`PO Number: ${po.number}`, 140, 25);
    doc.text(`Order Date: ${new Date(po.orderDate).toLocaleDateString()}`, 140, 30);
    doc.text(`Version: v${po.version}`, 140, 35);
    doc.text(`Status: ${po.status.replace("_", " ")}`, 140, 40);

    // Horizontal line
    doc.setDrawColor(220, 220, 220);
    doc.line(14, 45, 196, 45);

    // 2. Vendor / Shipping details
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text("SUPPLIER / VENDOR DETAILS", 14, 52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    doc.text(`Name: ${po.vendorName}`, 14, 57);
    
    let leftY = 61.5;
    if (po.vendorAddress) {
      const addrLines = doc.splitTextToSize(`Address: ${po.vendorAddress}`, 90);
      addrLines.forEach((l: string) => {
        doc.text(l, 14, leftY);
        leftY += 4.5;
      });
    } else {
      doc.text("Address: N/A", 14, leftY);
      leftY += 4.5;
    }
    
    const taxInfo = [`GSTIN: ${po.vendorGstin || "N/A"}`, `PAN: ${po.vendorPan || "N/A"}`].join(" | ");
    doc.text(taxInfo, 14, leftY);
    leftY += 4.5;
    
    doc.text(`Payment Terms: ${po.paymentTerms || "Net 30"}`, 14, leftY);
    leftY += 4.5;
    doc.text(`Freight Terms: ${po.freightTerms || "FOB Destination"}`, 14, leftY);
    leftY += 4.5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text("SHIP TO / DELIVERY DESTINATION", 110, 52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    
    let rightY = 57;
    if (po.shipTo) {
      const shipToLines = doc.splitTextToSize(`Destination: ${po.shipTo}`, 90);
      shipToLines.forEach((l: string) => {
        doc.text(l, 110, rightY);
        rightY += 4.5;
      });
    } else {
      doc.text("Destination: N/A", 110, rightY);
      rightY += 4.5;
    }
    
    doc.text(`Delivery Date: ${po.deliveryDate ? new Date(po.deliveryDate).toLocaleDateString() : "Immediate"}`, 110, rightY);
    rightY += 4.5;
    doc.text(`PO Type: ${po.type}`, 110, rightY);
    rightY += 4.5;

    const startY = Math.max(leftY, rightY) + 5;

    // 3. Table of items
    const tableHeaders = [
      ["S.No", "Code", "Item Description", "Qty", "Basic Rate (Rs.)", "Disc %", "GST %", "Landed Cost (Rs.)"]
    ];

    const totalTaxable = po.lines.reduce((sum, line) => {
      return sum + line.qty * line.rate * (1 - line.discount / 100);
    }, 0);

    const tableRows = po.lines.map((line, index) => {
      const landed = calculateLandedCost(
        line.qty,
        line.rate,
        line.discount,
        line.gstRate,
        totalTaxable,
        po.otherCharges
      );
      return [
        index + 1,
        line.itemCode,
        line.itemName,
        line.qty,
        line.rate.toFixed(2),
        line.discount + "%",
        line.gstRate + "%",
        landed.toFixed(2)
      ];
    });

    autoTable(doc, {
      head: tableHeaders,
      body: tableRows,
      startY: startY,
      theme: "striped",
      headStyles: { fillColor: [224, 130, 4] }, // Saffron colored header
      styles: { fontSize: 8.5, font: "helvetica" },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" }
      }
    });

    // 4. Totals Breakdown block
    const finalY = (doc as any).lastAutoTable.finalY || 120;
    const totals = computePoTotals(po.lines, po.otherCharges);
    
    let currentY = finalY + 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);

    doc.text("Basic Value:", 120, currentY);
    doc.text(`INR ${totals.basicTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 195, currentY, { align: "right" });
    
    if (totals.discountTotal > 0) {
      currentY += 5;
      doc.text("Total Discount (-):", 120, currentY);
      doc.text(`-INR ${totals.discountTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 195, currentY, { align: "right" });
    }

    if (po.otherCharges > 0) {
      currentY += 5;
      doc.text("Other Charges (+):", 120, currentY);
      doc.text(`INR ${po.otherCharges.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 195, currentY, { align: "right" });
    }

    currentY += 5;
    doc.text("Total GST (+):", 120, currentY);
    doc.text(`INR ${totals.gstTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 195, currentY, { align: "right" });

    currentY += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text("Net Landed Total:", 120, currentY);
    doc.text(`INR ${totals.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 195, currentY, { align: "right" });

    // 5. Terms & Conditions
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);

    const resolvedTerms = po.resolvedTermsText || resolveTermsPreview(po.termsPresetId || "", po);

    if (resolvedTerms) {
      doc.text("TERMS AND CONDITIONS OF PURCHASE", 14, 20);
      doc.setDrawColor(224, 130, 4); // Saffron line
      doc.line(14, 23, 196, 23);

      let termsY = 30;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(70, 70, 70);

      const lines = doc.splitTextToSize(resolvedTerms, 182);
      for (let i = 0; i < lines.length; i++) {
        if (termsY > 275) {
          doc.addPage();
          termsY = 20;
        }
        doc.text(lines[i], 14, termsY);
        termsY += 4.2;
      }
      currentY = termsY + 10;
    } else {
      doc.text("TERMS & CONDITIONS", 14, 20);
      doc.setDrawColor(224, 130, 4); // Saffron line
      doc.line(14, 23, 196, 23);

      let termsY = 30;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(70, 70, 70);

      const terms = "No specific terms & conditions defined for this Purchase Order.";
      const lines = doc.splitTextToSize(terms, 182);
      for (let i = 0; i < lines.length; i++) {
        if (termsY > 275) {
          doc.addPage();
          termsY = 20;
        }
        doc.text(lines[i], 14, termsY);
        termsY += 4.2;
      }
      currentY = termsY + 10;
    }

    // Signatures
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    
    if (currentY > 250) {
      doc.addPage();
      currentY = 20;
    }

    doc.line(14, currentY + 20, 70, currentY + 20);
    doc.text("Prepared By", 14, currentY + 25);

    doc.line(130, currentY + 20, 186, currentY + 20);
    doc.text("Authorised Signatory / Approved By", 130, currentY + 25);
    if (po.approvedBy) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 30, 30);
      doc.text(po.approvedBy, 130, currentY + 15);
    }

    doc.save(`PO_${po.number}_v${po.version}.pdf`);
  };

  const handleAddPoLine = () => {
    if (!newPoLine.itemId) return;
    setNewPo(prev => ({
      ...prev,
      lines: [...prev.lines, { ...newPoLine }]
    }));
    setNewPoLine({ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18 });
  };

  const toggleSelect = (id: string) => {
    setSelectedPOIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedPOIds.length === filteredPOs.length) {
      setSelectedPOIds([]);
    } else {
      setSelectedPOIds(filteredPOs.map(po => po.id));
    }
  };

  const handleBulkCancel = async () => {
    if (selectedPOIds.length === 0) return;
    const confirmMsg = `Are you sure you want to cancel/delete the ${selectedPOIds.length} selected Purchase Orders?`;
    if (!confirm(confirmMsg)) return;

    setActionLoading(true);
    setErrorMsg(null);
    let successCount = 0;
    for (const poId of selectedPOIds) {
      const res = await cancelPO(poId);
      if (res.success) successCount++;
    }
    setActionLoading(false);
    alert(`Successfully processed ${successCount} purchase orders.`);
    window.location.reload();
  };

  const handleOpenEdit = (po: PORecord) => {
    setErrorMsg(null);
    setEditingPOId(po.id);
    setNewPo({
      vendorId: po.vendorId,
      type: po.type as PoType,
      deliveryDate: po.deliveryDate ? new Date(po.deliveryDate).toISOString().split("T")[0] : "",
      paymentTerms: po.paymentTerms || "",
      freightTerms: po.freightTerms || "",
      shipTo: po.shipTo || "",
      termsConditions: po.termsConditions || "",
      termsPresetId: po.termsPresetId || "",
      otherCharges: po.otherCharges || 0,
      lines: po.lines.map(line => ({
        itemId: line.itemId,
        qty: line.qty,
        rate: line.rate,
        discount: line.discount,
        gstRate: line.gstRate
      }))
    });
    setIsOpen(true);
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPo.lines.length === 0) {
      alert("Please add at least one line item");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    
    let res;
    if (editingPOId) {
      res = await updatePO(editingPOId, newPo);
    } else {
      res = await createPO(newPo);
    }
    
    setActionLoading(false);

    if (res.success) {
      setIsOpen(false);
      setEditingPOId(null);
      window.location.reload();
    } else {
      setErrorMsg(res.error || `Failed to ${editingPOId ? 'update' : 'create'} PO`);
    }
  };

  const handleWorkflow = async (action: "submit" | "approve" | "cancel", poId: string) => {
    if (action === "cancel") {
      const poObj = purchaseOrders.find(p => p.id === poId);
      const isDraft = poObj?.status === "DRAFT";
      const confirmMsg = isDraft 
        ? "Are you sure you want to permanently delete this draft Purchase Order?"
        : "Are you sure you want to cancel this Purchase Order?";
      if (!confirm(confirmMsg)) return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    let res: { success: boolean; error?: string } | undefined;
    if (action === "submit") res = await submitForApproval(poId);
    else if (action === "approve") res = await approvePO(poId);
    else if (action === "cancel") res = await cancelPO(poId);
    setActionLoading(false);

    if (res && res.success) {
      window.location.reload();
    } else {
      alert("Action failed: " + (res?.error || "Unknown error"));
    }
  };

  const handleOpenAmend = (po: PORecord) => {
    setSelectedPO(po);
    setAmendForm({
      reason: "",
      paymentTerms: po.paymentTerms || "",
      freightTerms: po.freightTerms || "",
      deliveryDate: po.deliveryDate ? po.deliveryDate.split("T")[0] : "",
      shipTo: po.shipTo || "",
      termsConditions: po.termsConditions || "",
      termsPresetId: po.termsPresetId || "",
      otherCharges: po.otherCharges || 0,
      lines: po.lines.map(l => ({
        itemId: l.itemId,
        qty: l.qty,
        rate: l.rate,
        discount: l.discount,
        gstRate: l.gstRate
      }))
    });
    setIsAmendOpen(true);
  };

  const handleAmendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amendForm.reason.trim()) {
      alert("Please specify a reason for the amendment");
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    const res = await amendPO(selectedPO!.id, amendForm);
    setActionLoading(false);

    if (res.success) {
      setIsAmendOpen(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to submit amendment");
    }
  };

  const isPoOverdue = (po: PORecord) => {
    if (!po.deliveryDate) return false;
    const activeStatuses = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];
    if (!activeStatuses.includes(po.status)) return false;
    const delivery = new Date(po.deliveryDate);
    const today = new Date();
    delivery.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return delivery < today;
  };

  const getPoDisplayStatus = (po: PORecord) => {
    if (isPoOverdue(po)) return "OVERDUE";
    return po.status;
  };

  const filteredPOs = purchaseOrders.filter(po => 
    po.number.toLowerCase().includes(search.toLowerCase()) ||
    po.vendorName.toLowerCase().includes(search.toLowerCase()) ||
    po.type.toLowerCase().includes(search.toLowerCase())
  ).filter(po => {
    if (statusFilter === "all") return true;
    if (statusFilter === "OVERDUE") return isPoOverdue(po);
    return po.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Purchase Orders Register</h2>
          <p className="text-xs text-onyx/50 mt-1">Manage corporate purchase orders, value-based approval limits, and amendment versioning logs.</p>
        </div>
        <div className="flex items-center space-x-3">
          {selectedPOIds.length > 0 && (
            <button
              onClick={handleBulkCancel}
              className="flex items-center space-x-2 px-3.5 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-xs font-bold text-white shadow-md transition-all duration-150 cursor-pointer animate-in fade-in zoom-in-95 duration-100"
            >
              <Trash2 size={15} />
              <span>Bulk Cancel ({selectedPOIds.length})</span>
            </button>
          )}
          <button
            onClick={() => {
              setErrorMsg(null);
              setEditingPOId(null);
              setNewPo({
                vendorId: "",
                type: "REGULAR",
                deliveryDate: "",
                paymentTerms: "Net 30",
                freightTerms: "FOB Destination",
                shipTo: shipToLocations.length > 0 ? `${shipToLocations[0].name} (${shipToLocations[0].address})` : "",
                termsConditions: "1. Standard warranty of 1 year applies from the date of receipt.\n2. Goods must be delivered in proper industrial packaging.\n3. Late delivery penalty of 0.5% per week, capped at 5% of total PO value.",
                termsPresetId: "",
                otherCharges: 0,
                lines: []
              });
              setIsOpen(true);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>Create Purchase Order</span>
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
            placeholder="Search by PO number, vendor..."
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
          <option value="OVERDUE">Overdue Only</option>
          <option value="DRAFT">Draft Only</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="SENT">Sent to Supplier</option>
          <option value="PARTIALLY_RECEIVED">Partially Received</option>
          <option value="RECEIVED">Fully Received</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      {/* Table (Desktop View) */}
      <div className="hidden md:block glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredPOs.length > 0 && selectedPOIds.length === filteredPOs.length}
                    onChange={toggleSelectAll}
                    className="rounded border-onyx/20 text-saffron focus:ring-saffron cursor-pointer"
                  />
                </th>
                <th>PO Number</th>
                <th>Supplier</th>
                <th>Type</th>
                <th>Order Date</th>
                <th>Landed Value</th>
                <th>Source RFQ</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPOs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-onyx/40 font-medium">
                    No purchase orders found.
                  </td>
                </tr>
              ) : (
                filteredPOs.map((po) => {
                  return (
                    <tr key={po.id}>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={selectedPOIds.includes(po.id)}
                          onChange={() => toggleSelect(po.id)}
                          className="rounded border-onyx/20 text-saffron focus:ring-saffron cursor-pointer"
                        />
                      </td>
                      <td className="font-mono font-bold text-xs text-onyx/85">
                        {po.number}
                        {po.version > 1 && (
                          <span className="ml-1.5 px-1 py-0.5 bg-saffron/20 border border-saffron/40 text-[9px] font-bold rounded">
                            v{po.version}
                          </span>
                        )}
                      </td>
                      <td className="font-semibold text-onyx">{po.vendorName}</td>
                      <td>{po.type}</td>
                      <td suppressHydrationWarning>{new Date(po.orderDate).toLocaleDateString()}</td>
                      <td className="font-mono font-bold">₹{po.totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                      <td className="font-mono text-xs text-onyx/70">
                        {po.rfqNumbers && po.rfqNumbers.length > 0 ? po.rfqNumbers.join(", ") : "-"}
                      </td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          getPoDisplayStatus(po) === "OVERDUE" ? "bg-yellow-100 text-yellow-800" :
                          po.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                          po.status === "PENDING_APPROVAL" ? "bg-yellow-100 text-yellow-800 animate-pulse" :
                          po.status === "APPROVED" ? "bg-green-100 text-green-800" :
                          po.status === "SENT" ? "bg-blue-100 text-blue-800" :
                          po.status === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-purple-100 text-purple-800"
                        }`}>
                          {getPoDisplayStatus(po).replace("_", " ")}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedPO(po);
                              setIsDetailOpen(true);
                            }}
                            title="View PO Details"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                          >
                            <Eye size={13} />
                          </button>

                          <button
                            onClick={() => handleExportPDF(po)}
                            title="Print / Export PO PDF"
                            className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-saffron-dark hover:text-saffron-dark/80 cursor-pointer"
                          >
                            <FileText size={13} />
                          </button>
                          {["DRAFT", "PENDING_APPROVAL"].includes(po.status) && isPurchase && (
                            <button
                              onClick={() => handleOpenEdit(po)}
                              title="Edit PO"
                              className="p-1 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer"
                            >
                              <Edit3 size={13} />
                            </button>
                          )}

                          {po.status === "DRAFT" && (
                            <button
                              onClick={() => handleWorkflow("submit", po.id)}
                              title="Submit for Approval"
                              className="p-1 hover:bg-yellow-50 text-yellow-600 hover:text-yellow-700 rounded border border-transparent hover:border-yellow-200 cursor-pointer"
                            >
                              <RefreshCw size={13} />
                            </button>
                          )}

                          {po.status === "PENDING_APPROVAL" && canApprove && (
                            <button
                              onClick={() => handleWorkflow("approve", po.id)}
                              title="Approve PO"
                              className="p-1 hover:bg-green-50 text-green-600 hover:text-green-700 rounded border border-transparent hover:border-green-200 cursor-pointer"
                            >
                              <Check size={13} />
                            </button>
                          )}

                          {["APPROVED", "SENT"].includes(po.status) && isPurchase && (
                            <button
                              onClick={() => handleOpenAmend(po)}
                              title="Amend PO (Creates new version)"
                              className="p-1 hover:bg-saffron-light text-saffron-dark rounded border border-transparent hover:border-saffron-dark/20 cursor-pointer"
                            >
                              <Edit3 size={13} />
                            </button>
                          )}

                          {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(po.status) && isPurchase && (
                            <button
                              onClick={() => handleWorkflow("cancel", po.id)}
                              title="Cancel PO"
                              className="p-1 hover:bg-red-50 text-red-600 hover:text-red-700 rounded border border-transparent hover:border-red-200 cursor-pointer"
                            >
                              <Trash2 size={13} />
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
        {filteredPOs.length === 0 ? (
          <div className="glass-card p-6 text-center text-onyx/40 font-medium border border-onyx/5 rounded-xl">
            No purchase orders found.
          </div>
        ) : (
          filteredPOs.map((po) => {
            return (
              <div
                key={po.id}
                className="glass-card p-4 rounded-xl border border-onyx/5 bg-cream shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between border-b border-onyx/5 pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-xs text-onyx/85">
                      {po.number}
                      {po.version > 1 && (
                        <span className="ml-1.5 px-1 py-0.5 bg-saffron/20 border border-saffron/40 text-[9px] font-bold rounded">
                          v{po.version}
                        </span>
                      )}
                    </span>
                  </div>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                    getPoDisplayStatus(po) === "OVERDUE" ? "bg-yellow-100 text-yellow-800" :
                    po.status === "DRAFT" ? "bg-gray-100 text-gray-800" :
                    po.status === "PENDING_APPROVAL" ? "bg-yellow-100 text-yellow-800 animate-pulse" :
                    po.status === "APPROVED" ? "bg-green-100 text-green-800" :
                    po.status === "SENT" ? "bg-blue-100 text-blue-800" :
                    po.status === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-purple-100 text-purple-800"
                  }`}>
                    {getPoDisplayStatus(po).replace("_", " ")}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-onyx/70">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Supplier</span>
                    <span className="font-semibold text-onyx">{po.vendorName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">PO Type</span>
                      <span className="font-semibold text-onyx">{po.type}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Landed Value</span>
                      <span className="font-mono font-bold text-onyx/85">
                        ₹{po.totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Order Date</span>
                      <span className="font-semibold text-onyx" suppressHydrationWarning>
                        {new Date(po.orderDate).toLocaleDateString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider block">Source RFQ</span>
                      <span className="font-mono font-semibold text-onyx/85">
                        {po.rfqNumbers && po.rfqNumbers.length > 0 ? po.rfqNumbers.join(", ") : "-"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-onyx/5">
                  <button
                    onClick={() => {
                      setSelectedPO(po);
                      setIsDetailOpen(true);
                    }}
                    title="View PO Details"
                    className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => handleExportPDF(po)}
                    title="Print / Export PO PDF"
                    className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-saffron-dark hover:text-saffron-dark/80 cursor-pointer inline-flex"
                  >
                    <FileText size={14} />
                  </button>
                  {["DRAFT", "PENDING_APPROVAL"].includes(po.status) && isPurchase && (
                    <button
                      onClick={() => handleOpenEdit(po)}
                      title="Edit PO"
                      className="p-1.5 hover:bg-cream-dark border border-transparent hover:border-onyx/5 rounded text-onyx/65 hover:text-onyx cursor-pointer inline-flex"
                    >
                      <Edit3 size={14} />
                    </button>
                  )}

                  {po.status === "DRAFT" && (
                    <button
                      onClick={() => handleWorkflow("submit", po.id)}
                      title="Submit for Approval"
                      className="p-1.5 hover:bg-yellow-50 text-yellow-600 hover:text-yellow-700 rounded border border-yellow-200 cursor-pointer inline-flex"
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}

                  {po.status === "PENDING_APPROVAL" && canApprove && (
                    <button
                      onClick={() => handleWorkflow("approve", po.id)}
                      title="Approve PO"
                      className="p-1.5 bg-green-50 hover:bg-green-100 text-green-600 hover:text-green-700 rounded border border-green-200 cursor-pointer inline-flex font-bold"
                    >
                      <Check size={14} />
                    </button>
                  )}

                  {["APPROVED", "SENT"].includes(po.status) && isPurchase && (
                    <button
                      onClick={() => handleOpenAmend(po)}
                      title="Amend PO (Creates new version)"
                      className="p-1.5 hover:bg-saffron-light text-saffron-dark rounded border border-transparent hover:border-saffron-dark/20 cursor-pointer inline-flex"
                    >
                      <Edit3 size={14} />
                    </button>
                  )}

                  {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(po.status) && isPurchase && (
                    <button
                      onClick={() => handleWorkflow("cancel", po.id)}
                      title="Cancel PO"
                      className="p-1.5 hover:bg-red-50 text-red-600 hover:text-red-700 rounded border border-transparent hover:border-red-200 cursor-pointer inline-flex"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* PO Create Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-3xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">{editingPOId ? "Edit Purchase Order" : "Create Purchase Order"}</h3>
              <button onClick={() => { setIsOpen(false); setEditingPOId(null); }} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreatePo} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start space-x-3 text-xs text-red-800 font-semibold">
                  <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Vendor, Type, Delivery */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Supplier *
                  </label>
                  <select
                    value={newPo.vendorId}
                    onChange={(e) => setNewPo(prev => ({ ...prev, vendorId: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
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
                    PO Type *
                  </label>
                  <select
                    value={newPo.type}
                    onChange={(e) => setNewPo(prev => ({ ...prev, type: e.target.value as PoType }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="REGULAR">Regular</option>
                    <option value="BLANKET">Blanket Contract</option>
                    <option value="CAPITAL">Capex / Capital Goods</option>
                    <option value="SERVICE">Service PO</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Delivery Due Date
                  </label>
                  <input
                    type="date"
                    value={newPo.deliveryDate}
                    onChange={(e) => setNewPo(prev => ({ ...prev, deliveryDate: limitYearTo4Digits(e.target.value) }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              {/* Terms & Delivery Location */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Payment Terms *
                  </label>
                  <input
                    type="text"
                    value={newPo.paymentTerms || ""}
                    onChange={(e) => setNewPo(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Freight Terms *
                  </label>
                  <input
                    type="text"
                    value={newPo.freightTerms || ""}
                    onChange={(e) => setNewPo(prev => ({ ...prev, freightTerms: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Other Charges (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newPo.otherCharges || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setNewPo(prev => ({ ...prev, otherCharges: val }));
                    }}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Select Ship-To Location Master
                  </label>
                  <select
                    onChange={(e) => setNewPo(prev => ({ ...prev, shipTo: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx"
                  >
                    <option value="">-- Choose Master Location --</option>
                    {shipToLocations.length > 0 ? (
                      shipToLocations.map(loc => (
                        <option key={loc.id} value={`${loc.name} (${loc.address})`}>
                          [{loc.code}] {loc.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No predefined ship-to locations found</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Custom Delivery Address (Editable) *
                  </label>
                  <textarea
                    value={newPo.shipTo || ""}
                    onChange={(e) => setNewPo(prev => ({ ...prev, shipTo: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[60px] font-mono leading-relaxed"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-2">
                    Terms & Conditions Presets (Select one or more)
                  </label>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto p-3 bg-cream-dark/30 border border-onyx/10 rounded-lg">
                    {presets.filter(p => p.appliesTo.includes(newPo.type)).length > 0 ? (
                      presets.filter(p => p.appliesTo.includes(newPo.type)).map(p => {
                        const selectedIds = newPo.termsPresetId ? newPo.termsPresetId.split(",").map(id => id.trim()) : [];
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
                                  newIds = newIds.filter(id => id !== p.id);
                                }
                                setNewPo(prev => ({ ...prev, termsPresetId: newIds.filter(Boolean).join(",") }));
                              }}
                              className="mt-0.5 accent-saffron"
                            />
                            <span>{p.name}</span>
                          </label>
                        );
                      })
                    ) : (
                      <span className="text-xs text-onyx/50 italic">No presets available for this PO type</span>
                    )}
                  </div>
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-2">
                    Custom / Additional Terms & Conditions {(!newPo.termsPresetId) && "*"}
                  </label>
                  <textarea
                    value={newPo.termsConditions || ""}
                    onChange={(e) => setNewPo(prev => ({ ...prev, termsConditions: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[90px] leading-relaxed"
                    placeholder="Enter any custom or additional terms and conditions for this Purchase Order..."
                    required={!newPo.termsPresetId}
                  />
                </div>
              </div>

              {(() => {
                if (!newPo.termsPresetId) return null;
                const previewText = resolveTermsPreview(newPo.termsPresetId, newPo);
                const missing = getMissingTokensList(previewText);
                const previewHtml = renderMarkdownToHtml(previewText);

                return (
                  <div className="space-y-2 border border-saffron/20 bg-cream-dark/15 p-4.5 rounded-xl animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-onyx/50 uppercase tracking-wider">Preset Terms Live Preview</span>
                      {missing.length > 0 ? (
                        <span className="text-[9px] bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertCircle size={10} />
                          <span>{missing.length} Missing Configuration Fields</span>
                        </span>
                      ) : (
                        <span className="text-[9px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded">All Tokens Resolved</span>
                      )}
                    </div>
                    
                    {missing.length > 0 && (
                      <div className="bg-red-50 border border-red-100 p-3 rounded-lg text-[10px] text-red-800 space-y-1">
                        <span className="font-bold">Missing values (Must configure in PO Terms Settings or on PO/Vendor to submit/approve):</span>
                        <ul className="list-disc ml-4 font-mono font-bold flex flex-wrap gap-x-4">
                          {missing.map(m => <li key={m}>{m}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="bg-white border border-onyx/5 rounded-lg p-3 max-h-[160px] overflow-y-auto prose prose-sm leading-relaxed text-onyx/80">
                      <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                  </div>
                );
              })()}

              {/* Add line item */}
              <div className="p-4 bg-cream-dark/30 border border-onyx/5 rounded-xl space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/60">Add Line Item</h4>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Item *</label>
                    <SearchableItemSelect
                      items={items}
                      value={newPoLine.itemId}
                      onChange={(val) => setNewPoLine(prev => ({ ...prev, itemId: val }))}
                      placeholder="Select Item"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Qty *</label>
                    <input
                      type="number"
                      value={newPoLine.qty}
                      onChange={(e) => setNewPoLine(prev => ({ ...prev, qty: parseFloat(e.target.value) || 1 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Basic Rate *</label>
                    <input
                      type="number"
                      step="any"
                      value={newPoLine.rate || ""}
                      onChange={(e) => setNewPoLine(prev => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">Discount %</label>
                    <input
                      type="number"
                      step="any"
                      value={newPoLine.discount}
                      onChange={(e) => setNewPoLine(prev => ({ ...prev, discount: parseFloat(e.target.value) || 0 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg font-mono"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-0.5">GST %</label>
                    <input
                      type="number"
                      step="any"
                      value={newPoLine.gstRate}
                      onChange={(e) => setNewPoLine(prev => ({ ...prev, gstRate: parseFloat(e.target.value) || 0 }))}
                      className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg font-mono"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={handleAddPoLine}
                      className="w-full py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Lines table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                    PO Items List ({newPo.lines.length})
                  </label>
                  <p className="text-xs font-bold text-saffron-dark font-mono">
                    Landed Est: ₹{getLandedTotal(newPo.lines, newPo.otherCharges).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                {newPo.lines.length === 0 ? (
                  <p className="text-center py-4 bg-white border border-dashed border-onyx/10 text-xs text-onyx/40 font-medium rounded-lg">
                    No lines added.
                  </p>
                ) : (
                  <div className="border border-onyx/5 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse bg-white">
                      <thead className="bg-cream-dark/50">
                        <tr>
                          <th className="p-2 font-bold uppercase">Item</th>
                          <th className="p-2 font-bold uppercase text-right">Qty</th>
                          <th className="p-2 font-bold uppercase text-right">Rate</th>
                          <th className="p-2 font-bold uppercase text-right">Landed Val</th>
                          <th className="p-2 font-bold text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newPo.lines.map((line, idx) => {
                          const item = items.find(i => i.id === line.itemId);
                          const totalTaxable = newPo.lines.reduce((sum, l) => {
                            return sum + l.qty * l.rate * (1 - l.discount / 100);
                          }, 0);
                          const landed = calculateLandedCost(
                            line.qty,
                            line.rate,
                            line.discount,
                            line.gstRate,
                            totalTaxable,
                            newPo.otherCharges
                          );
                          return (
                            <tr key={idx} className="border-t border-onyx/5">
                              <td className="p-2">[{item?.code}] {item?.name}</td>
                              <td className="p-2 text-right font-mono">{line.qty}</td>
                              <td className="p-2 text-right font-mono">₹{line.rate.toFixed(2)}</td>
                              <td className="p-2 text-right font-mono font-bold">₹{landed.toFixed(2)}</td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setNewPo(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))}
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

              {/* Buttons */}
              <div className="pt-4 border-t border-onyx/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setIsOpen(false); setEditingPOId(null); }}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || newPo.lines.length === 0}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving..." : editingPOId ? "Save Changes" : "Save PO Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Amend Modal */}
      {isAmendOpen && selectedPO && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-3xl w-full max-h-[90vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">Amend Purchase Order ({selectedPO.number})</h3>
              <button onClick={() => setIsAmendOpen(false)} className="hover:text-saffron cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAmendSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded text-xs text-red-800 font-semibold">
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                  Reason for Amendment *
                </label>
                <input
                  type="text"
                  required
                  value={amendForm.reason}
                  onChange={(e) => setAmendForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g. Quantity adjusted to meet increased raw material production plan"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              {/* General Terms & Conditions and Delivery Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    PO Type (Read-only)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={selectedPO.type}
                    className="w-full text-xs p-2.5 bg-cream-dark/20 border border-onyx/5 rounded-lg text-onyx/50 cursor-not-allowed focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Delivery Due Date
                  </label>
                  <input
                    type="date"
                    value={amendForm.deliveryDate}
                    onChange={(e) => setAmendForm(prev => ({ ...prev, deliveryDate: limitYearTo4Digits(e.target.value) }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Payment Terms *
                  </label>
                  <input
                    type="text"
                    required
                    value={amendForm.paymentTerms}
                    onChange={(e) => setAmendForm(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
              </div>

              {/* Freight Terms, Other Charges & Ship-To Master */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Freight Terms *
                  </label>
                  <input
                    type="text"
                    required
                    value={amendForm.freightTerms}
                    onChange={(e) => setAmendForm(prev => ({ ...prev, freightTerms: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Other Charges (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={amendForm.otherCharges || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setAmendForm(prev => ({ ...prev, otherCharges: val }));
                    }}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Select Ship-To Location Master
                  </label>
                  <select
                    onChange={(e) => setAmendForm(prev => ({ ...prev, shipTo: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-semibold text-onyx"
                  >
                    <option value="">-- Choose Master Location --</option>
                    {shipToLocations.length > 0 ? (
                      shipToLocations.map(loc => (
                        <option key={loc.id} value={`${loc.name} (${loc.address})`}>
                          [{loc.code}] {loc.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No predefined ship-to locations found</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-1">
                    Custom Delivery Address (Editable) *
                  </label>
                  <textarea
                    value={amendForm.shipTo}
                    onChange={(e) => setAmendForm(prev => ({ ...prev, shipTo: e.target.value }))}
                    className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[60px] font-mono leading-relaxed"
                    required
                  />
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-2">
                        Terms & Conditions Presets (Select one or more)
                      </label>
                      <div className="space-y-2 max-h-[120px] overflow-y-auto p-3 bg-cream-dark/30 border border-onyx/10 rounded-lg">
                        {presets.filter(p => p.appliesTo.includes(selectedPO?.type as any)).length > 0 ? (
                          presets.filter(p => p.appliesTo.includes(selectedPO?.type as any)).map(p => {
                            const selectedIds = amendForm.termsPresetId ? amendForm.termsPresetId.split(",").map(id => id.trim()) : [];
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
                                      newIds = newIds.filter(id => id !== p.id);
                                    }
                                    setAmendForm(prev => ({ ...prev, termsPresetId: newIds.filter(Boolean).join(",") }));
                                  }}
                                  className="mt-0.5 accent-saffron"
                                />
                                <span>{p.name}</span>
                              </label>
                            );
                          })
                        ) : (
                          <span className="text-xs text-onyx/50 italic">No presets available for this PO type</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70 mb-2">
                        Custom / Additional Terms & Conditions {(!amendForm.termsPresetId) && "*"}
                      </label>
                      <textarea
                        value={amendForm.termsConditions}
                        onChange={(e) => setAmendForm(prev => ({ ...prev, termsConditions: e.target.value }))}
                        className="w-full text-xs p-2.5 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[90px] leading-relaxed"
                        placeholder="Enter any custom or additional terms and conditions for this Purchase Order..."
                        required={!amendForm.termsPresetId}
                      />
                    </div>
                  </div>

                  {(() => {
                    if (!amendForm.termsPresetId) return null;
                    const previewText = resolveTermsPreview(amendForm.termsPresetId, {
                      ...selectedPO,
                      ...amendForm
                    });
                    const missing = getMissingTokensList(previewText);
                    const previewHtml = renderMarkdownToHtml(previewText);

                    return (
                      <div className="space-y-2 border border-saffron/20 bg-cream-dark/15 p-4 rounded-xl animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-onyx/50 uppercase tracking-wider">Preset Terms Live Preview</span>
                          {missing.length > 0 ? (
                            <span className="text-[9px] bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                              <AlertCircle size={10} />
                              <span>{missing.length} Missing Configuration Fields</span>
                            </span>
                          ) : (
                            <span className="text-[9px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded">All Tokens Resolved</span>
                          )}
                        </div>
                        
                        {missing.length > 0 && (
                          <div className="bg-red-50 border border-red-100 p-2 rounded-lg text-[9px] text-red-800 space-y-1">
                            <span className="font-bold">Missing values (Must configure in PO Terms Settings or on PO/Vendor to submit/approve):</span>
                            <ul className="list-disc ml-4 font-mono font-bold flex flex-wrap gap-x-4">
                              {missing.map(m => <li key={m}>{m}</li>)}
                            </ul>
                          </div>
                        )}

                        <div className="bg-white border border-onyx/5 rounded-lg p-2 max-h-[120px] overflow-y-auto prose prose-sm leading-relaxed text-onyx/80">
                          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Lines list edit */}
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/70">
                  Edit Lines quantities/rates
                </label>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-2.5 font-bold">Item Description</th>
                        <th className="p-2.5 font-bold text-center w-24">Qty</th>
                        <th className="p-2.5 font-bold text-center w-24">Basic Rate</th>
                        <th className="p-2.5 font-bold text-center w-20">Discount%</th>
                        <th className="p-2.5 font-bold text-center w-20">GST%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {amendForm.lines.map((line, idx) => {
                        const originalLine = selectedPO.lines.find(ol => ol.itemId === line.itemId);
                        return (
                          <tr key={line.itemId} className="border-t border-onyx/5">
                            <td className="p-2.5">
                              <p className="font-semibold">[{originalLine?.itemCode}] {originalLine?.itemName}</p>
                            </td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                required
                                value={line.qty}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setAmendForm(prev => {
                                    const updated = [...prev.lines];
                                    updated[idx].qty = val;
                                    return { ...prev, lines: updated };
                                  });
                                }}
                                className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono font-bold"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                step="any"
                                required
                                value={line.rate}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setAmendForm(prev => {
                                    const updated = [...prev.lines];
                                    updated[idx].rate = val;
                                    return { ...prev, lines: updated };
                                  });
                                }}
                                className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono font-bold"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                step="any"
                                value={line.discount}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setAmendForm(prev => {
                                    const updated = [...prev.lines];
                                    updated[idx].discount = val;
                                    return { ...prev, lines: updated };
                                  });
                                }}
                                className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="number"
                                step="any"
                                value={line.gstRate}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setAmendForm(prev => {
                                    const updated = [...prev.lines];
                                    updated[idx].gstRate = val;
                                    return { ...prev, lines: updated };
                                  });
                                }}
                                className="w-full text-xs p-1 border border-onyx/15 rounded text-center font-mono"
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
                  onClick={() => setIsAmendOpen(false)}
                  className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow cursor-pointer"
                >
                  {actionLoading ? "Amending..." : "Amend PO"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Detail Side Drawer */}
      {isDetailOpen && selectedPO && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50">
          <div className="w-full max-w-xl bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer">
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
              </div>
              <h3 className="font-heading text-xl font-extrabold text-onyx">
                Purchase Order Details
              </h3>
              <p className="text-xs text-onyx/50">Supplier: {selectedPO.vendorName}</p>
            </div>

            {/* General Info */}
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
                <span className="font-semibold text-onyx/50">Supplier Registered Address:</span>
                <p className="font-bold text-onyx mt-0.5 whitespace-pre-line">{selectedPO.vendorAddress || "N/A"}</p>
              </div>
              <div className="col-span-2">
                <span className="font-semibold text-onyx/50">Ship-To Location / Address:</span>
                <p className="font-bold text-onyx mt-0.5">{selectedPO.shipTo || "N/A"}</p>
              </div>
            </div>

            {((selectedPO.rfqNumbers && selectedPO.rfqNumbers.length > 0) ||
              (selectedPO.prNumbers && selectedPO.prNumbers.length > 0) ||
              (selectedPO.indentNumbers && selectedPO.indentNumbers.length > 0)) && (
              <div className="py-3 px-3.5 bg-saffron/5 border-l-2 border-saffron rounded-r-lg text-xs mt-3 space-y-2 font-sans">
                <h5 className="font-bold text-onyx/75 uppercase tracking-wider text-[10px]">Reference Audit Trace</h5>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {selectedPO.indentNumbers && selectedPO.indentNumbers.length > 0 && (
                    <div className="col-span-2">
                      <span className="font-semibold text-onyx/50">Indent Number(s):</span>
                      <p className="font-mono font-bold text-onyx mt-0.5">{selectedPO.indentNumbers.join(", ")}</p>
                    </div>
                  )}
                  {selectedPO.prNumbers && selectedPO.prNumbers.length > 0 && (
                    <div>
                      <span className="font-semibold text-onyx/50">PR Number(s):</span>
                      <p className="font-mono font-bold text-onyx mt-0.5">{selectedPO.prNumbers.join(", ")}</p>
                    </div>
                  )}
                  {selectedPO.rfqNumbers && selectedPO.rfqNumbers.length > 0 && (
                    <div>
                      <span className="font-semibold text-onyx/50">RFQ Number(s):</span>
                      <p className="font-mono font-bold text-onyx mt-0.5">{selectedPO.rfqNumbers.join(", ")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Main Tabs for Details vs Version History */}
            <div className="flex-1 overflow-y-auto py-6 space-y-6">
              {/* Lines */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                  Item Lines Registered
                </h4>

                <div className="border border-onyx/5 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse bg-white">
                    <thead className="bg-cream-dark/50">
                      <tr>
                        <th className="p-2.5 font-bold">Item Description</th>
                        <th className="p-2.5 font-bold text-right">Rate</th>
                        <th className="p-2.5 font-bold text-right">Qty</th>
                        <th className="p-2.5 font-bold text-right">Landed Cost</th>
                        <th className="p-2.5 font-bold text-right">Recd Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.lines.map((line) => {
                        const totalTaxable = selectedPO.lines.reduce((sum, l) => {
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
                            <td className="p-2.5">[{line.itemCode}] {line.itemName}</td>
                            <td className="p-2.5 text-right font-mono">₹{line.rate.toFixed(2)}</td>
                            <td className="p-2.5 text-right font-mono font-bold">{line.qty}</td>
                            <td className="p-2.5 text-right font-mono">₹{landed.toFixed(2)}</td>
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
                    const resolved = selectedPO.resolvedTermsText || resolveTermsPreview(selectedPO.termsPresetId || "", selectedPO);
                    if (resolved) {
                      return (
                        <div 
                          className="p-4 bg-white border border-onyx/5 rounded-lg text-xs text-onyx/85 prose prose-sm max-w-none leading-relaxed overflow-y-auto max-h-[30vh]"
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
              {selectedPO.amendments.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-onyx/40">
                    PO Amendment History
                  </h4>
                  <div className="space-y-3">
                    {selectedPO.amendments.map((am) => (
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

            <div className="pt-4 border-t border-onyx/5 flex items-center justify-between space-x-3">
              <button 
                onClick={() => handleExportPDF(selectedPO)}
                className="flex-1 py-2.5 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs cursor-pointer flex items-center justify-center space-x-1.5 shadow"
              >
                <FileText size={14} />
                <span>Print / Export PDF</span>
              </button>
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="flex-1 py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
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
