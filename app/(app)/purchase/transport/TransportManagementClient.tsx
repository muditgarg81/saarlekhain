"use client";

import React, { useState, useMemo } from "react";
import { 
  Truck, 
  Plus, 
  Search, 
  Calendar, 
  MapPin, 
  DollarSign, 
  TrendingUp, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  CreditCard,
  FileText,
  User,
  Phone,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { 
  createTransportRate, 
  deleteTransportRate, 
  createTransportOrder, 
  updateTransportOrder, 
  deleteTransportOrder, 
  createTransportBill, 
  deleteTransportBill, 
  recordTransportPayment 
} from "@/app/actions/transport";
import { createVendor } from "@/app/actions/vendors";

interface Transporter {
  id: string;
  name: string;
  code: string;
  gstin: string | null;
  address: string | null;
  creditDays: number;
}

interface Rate {
  id: string;
  transporterId: string;
  transporterName: string;
  fromLocation: string;
  toLocation: string;
  vehicleCapacity: string;
  rate: number;
}

interface Order {
  id: string;
  number: string;
  transporterId: string;
  transporterName: string;
  vehicleCapacity: string;
  fromLocation: string;
  toLocation: string;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  loadingPoint: string | null;
  unloadingPoint: string | null;
  freightAmount: number;
  otherCharges: number;
  taxRate: number;
  totalAmount: number;
  status: string;
  poId: string | null;
  poNumber: string | null;
  grnId: string | null;
  grnNumber: string | null;
  createdAt: string;
  totalBilled: number;
  totalPaid: number;
}

interface Payment {
  id: string;
  paymentNo: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNo: string | null;
}

interface Bill {
  id: string;
  billNo: string;
  billDate: string;
  amount: number;
  dueDate: string | null;
  paymentStatus: string;
  transportOrderId: string;
  transportOrderNo: string;
  transporterName: string;
  totalPaid: number;
  balance: number;
  payments: Payment[];
}

export type TransportTab = "dashboard" | "orders" | "contracts" | "transporters" | "bills";

interface TransportManagementClientProps {
  transporters: Transporter[];
  rates: Rate[];
  orders: Order[];
  bills: Bill[];
  purchaseOrders: { id: string; number: string }[];
  grns: { id: string; number: string }[];
  defaultTab?: TransportTab;
}

const LOAD_CAPACITIES = [
  "300 kgs",
  "500 kgs",
  "1000 kgs",
  "2000 kgs",
  "3000 kgs",
  "5000 kgs",
  "10000 kgs",
  "12000 kgs"
];

export default function TransportManagementClient({
  transporters,
  rates,
  orders,
  bills,
  purchaseOrders,
  grns,
  defaultTab = "dashboard",
}: TransportManagementClientProps) {
  const [activeTab, setActiveTab] = useState<TransportTab>(defaultTab);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  // Modals state
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [showTransporterModal, setShowTransporterModal] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedBillForPayment, setSelectedBillForPayment] = useState<Bill | null>(null);

  // Form States
  const [newOrder, setNewOrder] = useState({
    transporterId: "",
    vehicleCapacity: "1000 kgs",
    fromLocation: "",
    toLocation: "",
    vehicleNo: "",
    driverName: "",
    driverPhone: "",
    loadingPoint: "",
    unloadingPoint: "",
    freightAmount: 0,
    otherCharges: 0,
    taxRate: 5, // default 5% GST on transport
    poId: "",
    grnId: "",
  });

  const [newRate, setNewRate] = useState({
    transporterId: "",
    fromLocation: "",
    toLocation: "",
    vehicleCapacity: "1000 kgs",
    rate: 0,
  });

  const [newTransporter, setNewTransporter] = useState({
    name: "",
    code: "",
    gstin: "",
    address: "",
    creditDays: 0,
  });

  const [newBill, setNewBill] = useState({
    transportOrderId: "",
    billNo: "",
    billDate: new Date().toISOString().split("T")[0],
    amount: 0,
    dueDate: "",
  });

  const [newPayment, setNewPayment] = useState({
    amount: 0,
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "Bank Transfer",
    referenceNo: "",
  });

  // Trip rate lookup handler
  const handleRateLookup = (transporterId: string, from: string, to: string, capacity: string) => {
    const match = rates.find(
      (r) =>
        r.transporterId === transporterId &&
        r.fromLocation.toLowerCase().trim() === from.toLowerCase().trim() &&
        r.toLocation.toLowerCase().trim() === to.toLowerCase().trim() &&
        r.vehicleCapacity === capacity
    );
    return match ? match.rate : null;
  };

  // Auto-rate trigger during order form input
  const triggerRateFill = (field: string, val: string) => {
    const updated = { ...newOrder, [field]: val };
    setNewOrder(updated);

    if (updated.transporterId && updated.fromLocation && updated.toLocation && updated.vehicleCapacity) {
      const rate = handleRateLookup(
        updated.transporterId,
        updated.fromLocation,
        updated.toLocation,
        updated.vehicleCapacity
      );
      if (rate !== null) {
        setNewOrder((prev) => ({ ...prev, freightAmount: rate }));
      }
    }
  };

  // Form Submissions
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.transporterId || !newOrder.fromLocation || !newOrder.toLocation) {
      alert("Transporter and Route (From/To) are required.");
      return;
    }

    const res = await createTransportOrder({
      ...newOrder,
      status: "PLACED", // Auto-place
    });

    if (res.success) {
      setShowOrderModal(false);
      setNewOrder({
        transporterId: "",
        vehicleCapacity: "1000 kgs",
        fromLocation: "",
        toLocation: "",
        vehicleNo: "",
        driverName: "",
        driverPhone: "",
        loadingPoint: "",
        unloadingPoint: "",
        freightAmount: 0,
        otherCharges: 0,
        taxRate: 5,
        poId: "",
        grnId: "",
      });
    } else {
      alert(res.error);
    }
  };

  const handleCreateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRate.transporterId || !newRate.fromLocation || !newRate.toLocation || newRate.rate <= 0) {
      alert("Please fill all required fields correctly.");
      return;
    }

    const res = await createTransportRate(newRate);
    if (res.success) {
      setShowRateModal(false);
      setNewRate({
        transporterId: "",
        fromLocation: "",
        toLocation: "",
        vehicleCapacity: "1000 kgs",
        rate: 0,
      });
    } else {
      alert(res.error);
    }
  };

  const handleCreateTransporter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTransporter.name) {
      alert("Transporter name is required.");
      return;
    }

    const res = await createVendor({
      name: newTransporter.name,
      code: newTransporter.code || undefined,
      address: newTransporter.address,
      gstin: newTransporter.gstin,
      category: "TRANSPORTER",
      creditDays: newTransporter.creditDays,
      tdsApplicable: false,
    });

    if (res.success) {
      setShowTransporterModal(false);
      setNewTransporter({
        name: "",
        code: "",
        gstin: "",
        address: "",
        creditDays: 0,
      });
    } else {
      alert(res.error);
    }
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBill.transportOrderId || !newBill.billNo || newBill.amount <= 0) {
      alert("Please select order, fill invoice no and amount.");
      return;
    }

    const res = await createTransportBill({
      ...newBill,
      dueDate: newBill.dueDate || undefined,
    });

    if (res.success) {
      setShowBillModal(false);
      setNewBill({
        transportOrderId: "",
        billNo: "",
        billDate: new Date().toISOString().split("T")[0],
        amount: 0,
        dueDate: "",
      });
    } else {
      alert(res.error);
    }
  };

  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBillForPayment || newPayment.amount <= 0) {
      alert("Please enter a valid payment amount.");
      return;
    }

    const res = await recordTransportPayment({
      transportBillId: selectedBillForPayment.id,
      amount: newPayment.amount,
      paymentDate: newPayment.paymentDate,
      paymentMethod: newPayment.paymentMethod,
      referenceNo: newPayment.referenceNo,
    });

    if (res.success) {
      setShowPaymentModal(false);
      setSelectedBillForPayment(null);
      setNewPayment({
        amount: 0,
        paymentDate: new Date().toISOString().split("T")[0],
        paymentMethod: "Bank Transfer",
        referenceNo: "",
      });
    } else {
      alert(res.error);
    }
  };

  // Actions
  const handleUpdateOrderStatus = async (id: string, nextStatus: string) => {
    const res = await updateTransportOrder(id, { status: nextStatus as any });
    if (!res.success) alert(res.error);
  };

  const handleDeleteOrder = async (id: string) => {
    if (confirm("Are you sure you want to delete this transport order?")) {
      const res = await deleteTransportOrder(id);
      if (!res.success) alert(res.error);
    }
  };

  const handleDeleteRate = async (id: string) => {
    if (confirm("Are you sure you want to delete this standard trip rate?")) {
      const res = await deleteTransportRate(id);
      if (!res.success) alert(res.error);
    }
  };

  const handleDeleteBill = async (id: string) => {
    if (confirm("Are you sure you want to delete this transporter bill?")) {
      const res = await deleteTransportBill(id);
      if (!res.success) alert(res.error);
    }
  };

  // Filters & Calculations
  const dashboardStats = useMemo(() => {
    const totalOrders = orders.length;
    const activeOrders = orders.filter(o => ["PLACED", "IN_TRANSIT"].includes(o.status)).length;
    const commitments = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    
    const billedSum = bills.reduce((sum, b) => sum + b.amount, 0);
    const paidSum = bills.reduce((sum, b) => sum + b.totalPaid, 0);
    const outstanding = billedSum - paidSum;

    return { totalOrders, activeOrders, commitments, billedSum, paidSum, outstanding };
  }, [orders, bills]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const q = searchTerm.toLowerCase();
      return (
        o.number.toLowerCase().includes(q) ||
        o.transporterName.toLowerCase().includes(q) ||
        o.fromLocation.toLowerCase().includes(q) ||
        o.toLocation.toLowerCase().includes(q) ||
        (o.vehicleNo && o.vehicleNo.toLowerCase().includes(q))
      );
    });
  }, [orders, searchTerm]);

  const filteredContracts = useMemo(() => {
    return rates.filter((r) => {
      const q = searchTerm.toLowerCase();
      return (
        r.transporterName.toLowerCase().includes(q) ||
        r.fromLocation.toLowerCase().includes(q) ||
        r.toLocation.toLowerCase().includes(q)
      );
    });
  }, [rates, searchTerm]);

  const filteredTransporters = useMemo(() => {
    return transporters.filter((t) => {
      const q = searchTerm.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q);
    });
  }, [transporters, searchTerm]);

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const q = searchTerm.toLowerCase();
      return (
        b.billNo.toLowerCase().includes(q) ||
        b.transportOrderNo.toLowerCase().includes(q) ||
        b.transporterName.toLowerCase().includes(q)
      );
    });
  }, [bills, searchTerm]);

  // Selected Order calculations for display inside modals
  const selectedOrderTotalCost = useMemo(() => {
    const freight = newOrder.freightAmount;
    const other = newOrder.otherCharges || 0;
    const tax = newOrder.taxRate || 0;
    return (freight + other) * (1 + tax / 100);
  }, [newOrder.freightAmount, newOrder.otherCharges, newOrder.taxRate]);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx flex items-center">
            <Truck className="text-saffron mr-2" size={24} />
            Transport Management
          </h2>
          <p className="text-xs text-onyx/50 mt-1">
            Manage transporters, standard trip rates, place capacity-based transport orders, process freight bills, and record payments.
          </p>
        </div>

        {/* Action triggers depending on active tab */}
        <div className="flex items-center space-x-3">
          {activeTab === "orders" && (
            <button
              onClick={() => setShowOrderModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow-md transition-all duration-200 cursor-pointer"
            >
              <Plus size={14} />
              <span>New Transport Order</span>
            </button>
          )}
          {activeTab === "contracts" && (
            <button
              onClick={() => setShowRateModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow-md transition-all duration-200 cursor-pointer"
            >
              <Plus size={14} />
              <span>Define Route Rate</span>
            </button>
          )}
          {activeTab === "transporters" && (
            <button
              onClick={() => setShowTransporterModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow-md transition-all duration-200 cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Transporter</span>
            </button>
          )}
          {activeTab === "bills" && (
            <button
              onClick={() => setShowBillModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow-md transition-all duration-200 cursor-pointer"
            >
              <Plus size={14} />
              <span>Process Freight Bill</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-onyx/10">
        {[
          { id: "dashboard", label: "Dashboard" },
          { id: "orders", label: "Transport Orders" },
          { id: "contracts", label: "Contracts" },
          { id: "transporters", label: "Transporters" },
          { id: "bills", label: "Freight Bills & Payments" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setActiveTab(t.id as any);
              setSearchTerm("");
            }}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-150 cursor-pointer ${
              activeTab === t.id 
                ? "border-saffron text-onyx" 
                : "border-transparent text-onyx/40 hover:text-onyx"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* SEARCH BAR (hidden in dashboard) */}
      {activeTab !== "dashboard" && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-onyx/40" size={14} />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-white border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>
      )}

      {/* TAB CONTENTS */}

      {/* TAB 1: DASHBOARD */}
      {activeTab === "dashboard" && (
        <div className="space-y-6">
          {/* KPI grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Total Trips / Orders</p>
                <h3 className="text-xl font-extrabold text-onyx mt-1 font-mono">{dashboardStats.totalOrders}</h3>
                <p className="text-[9px] text-onyx/50 mt-1">{dashboardStats.activeOrders} actively moving</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                <Truck size={22} />
              </div>
            </div>

            <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Freight Commitments</p>
                <h3 className="text-xl font-extrabold text-onyx mt-1 font-mono">
                  ₹{dashboardStats.commitments.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </h3>
                <p className="text-[9px] text-onyx/50 mt-1">Total ordered value</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                <TrendingUp size={22} />
              </div>
            </div>

            <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Billed Freight</p>
                <h3 className="text-xl font-extrabold text-onyx mt-1 font-mono">
                  ₹{dashboardStats.billedSum.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </h3>
                <p className="text-[9px] text-onyx/50 mt-1">₹{dashboardStats.paidSum.toLocaleString("en-IN")} cleared</p>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                <FileText size={22} />
              </div>
            </div>

            <div className="glass-card p-4 rounded-xl border border-onyx/5 bg-white shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">Outstanding Freight Payable</p>
                <h3 className="text-xl font-extrabold text-red-650 mt-1 font-mono">
                  ₹{dashboardStats.outstanding.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </h3>
                <p className="text-[9px] text-onyx/50 mt-1">Pending payments against bills</p>
              </div>
              <div className="p-3 bg-red-50 text-red-650 rounded-lg">
                <Clock size={22} />
              </div>
            </div>
          </div>

          {/* Quick summaries */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Orders List */}
            <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm p-4">
              <h3 className="text-sm font-bold text-onyx mb-3">Recent Placed Orders</h3>
              <div className="divide-y divide-onyx/5 text-xs">
                {orders.slice(0, 5).map((o) => (
                  <div key={o.id} className="py-2.5 flex items-center justify-between hover:bg-cream-dark/10 rounded px-1">
                    <div>
                      <div className="font-bold text-onyx flex items-center">
                        {o.number} 
                        <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full ml-2 font-mono">
                          {o.status}
                        </span>
                      </div>
                      <div className="text-onyx/65 mt-0.5">{o.transporterName} • {o.fromLocation} → {o.toLocation}</div>
                    </div>
                    <div className="text-right font-mono font-semibold">₹{o.totalAmount.toFixed(2)}</div>
                  </div>
                ))}
                {orders.length === 0 && (
                  <p className="text-center text-onyx/40 py-6">No transport orders found.</p>
                )}
              </div>
            </div>

            {/* Transporters Summary */}
            <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm p-4">
              <h3 className="text-sm font-bold text-onyx mb-3">Transporters List</h3>
              <div className="divide-y divide-onyx/5 text-xs">
                {transporters.slice(0, 5).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between hover:bg-cream-dark/10 rounded px-1">
                    <div>
                      <div className="font-bold text-onyx">{t.name}</div>
                      <div className="text-onyx/65 mt-0.5">GSTIN: {t.gstin || "N/A"}</div>
                    </div>
                    <div className="text-right text-onyx/60 font-mono">Days: {t.creditDays}</div>
                  </div>
                ))}
                {transporters.length === 0 && (
                  <p className="text-center text-onyx/40 py-6">No transporters registered.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TRANSPORT ORDERS */}
      {activeTab === "orders" && (
        <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-cream-dark/50 border-b border-onyx/5">
                <tr>
                  <th className="p-3 font-bold uppercase text-onyx/60">TO Number</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Transporter</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Route / Capacity</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Vehicle & Crew</th>
                  <th className="p-3 font-bold uppercase text-right text-onyx/60">Freight Cost</th>
                  <th className="p-3 font-bold uppercase text-center text-onyx/60">Status</th>
                  <th className="p-3 font-bold uppercase text-center text-onyx/60">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-cream-dark/15 transition-colors">
                    <td className="p-3 font-mono font-bold text-onyx">
                      {o.number}
                      <div className="text-[9px] text-onyx/40 font-normal mt-0.5">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-onyx">{o.transporterName}</div>
                      <div className="text-[10px] text-onyx/50 mt-0.5 flex flex-wrap gap-x-2">
                        {o.poNumber && <span>PO: {o.poNumber}</span>}
                        {o.grnNumber && <span>GRN: {o.grnNumber}</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-onyx">{o.fromLocation} → {o.toLocation}</div>
                      <div className="text-[10px] text-onyx/60 font-mono mt-0.5">Cap: {o.vehicleCapacity}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-mono text-onyx">{o.vehicleNo || "N/A"}</div>
                      <div className="text-[10px] text-onyx/50 mt-0.5">
                        {o.driverName ? `${o.driverName} (${o.driverPhone || ""})` : "-"}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono">
                      <div className="font-bold">₹{o.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
                      <div className="text-[9px] text-onyx/50">Base: ₹{o.freightAmount} | Tax: {o.taxRate}%</div>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`inline-block text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        o.status === "DELIVERED" 
                          ? "bg-emerald-100 text-emerald-800" 
                          : o.status === "IN_TRANSIT" 
                            ? "bg-blue-100 text-blue-800" 
                            : o.status === "CANCELLED" 
                              ? "bg-red-100 text-red-800" 
                              : "bg-amber-100 text-amber-800"
                      }`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        {o.status === "PLACED" && (
                          <button
                            onClick={() => handleUpdateOrderStatus(o.id, "IN_TRANSIT")}
                            className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded font-bold transition cursor-pointer"
                          >
                            In Transit
                          </button>
                        )}
                        {o.status === "IN_TRANSIT" && (
                          <button
                            onClick={() => handleUpdateOrderStatus(o.id, "DELIVERED")}
                            className="text-[10px] bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-2 py-1 rounded font-bold transition cursor-pointer"
                          >
                            Delivered
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteOrder(o.id)}
                          className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                          title="Delete Order"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-onyx/40 font-medium">
                      No transport orders found matching query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CONTRACTS */}
      {activeTab === "contracts" && (
        <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-cream-dark/50 border-b border-onyx/5">
                <tr>
                  <th className="p-3 font-bold uppercase text-onyx/60">Transporter</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">From Location</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">To Location</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Vehicle Capacity</th>
                  <th className="p-3 font-bold uppercase text-right text-onyx/60">Standard Rate (₹)</th>
                  <th className="p-3 font-bold uppercase text-center text-onyx/60">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5 font-mono">
                {filteredContracts.map((r) => (
                  <tr key={r.id} className="hover:bg-cream-dark/15 transition-colors">
                    <td className="p-3 font-sans font-semibold text-onyx">{r.transporterName}</td>
                    <td className="p-3 font-sans text-onyx">{r.fromLocation}</td>
                    <td className="p-3 font-sans text-onyx">{r.toLocation}</td>
                    <td className="p-3 font-medium text-onyx">{r.vehicleCapacity}</td>
                    <td className="p-3 text-right font-bold text-onyx">
                      ₹{r.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleDeleteRate(r.id)}
                        className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredContracts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-onyx/40 font-medium font-sans">
                      No contracts defined. Click "Define Route Rate" to add.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: TRANSPORTERS */}
      {activeTab === "transporters" && (
        <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-cream-dark/50 border-b border-onyx/5">
                <tr>
                  <th className="p-3 font-bold uppercase text-onyx/60">Code</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Name</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">GSTIN</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Address</th>
                  <th className="p-3 font-bold uppercase text-center text-onyx/60">Credit Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredTransporters.map((t) => (
                  <tr key={t.id} className="hover:bg-cream-dark/15 transition-colors">
                    <td className="p-3 font-mono font-bold text-onyx">{t.code}</td>
                    <td className="p-3 font-semibold text-onyx">{t.name}</td>
                    <td className="p-3 font-mono">{t.gstin || "-"}</td>
                    <td className="p-3 text-onyx/75">{t.address || "-"}</td>
                    <td className="p-3 text-center font-mono">{t.creditDays}</td>
                  </tr>
                ))}
                {filteredTransporters.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-onyx/40 font-medium">
                      No transporters registered. Click "Add Transporter" to add.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: FREIGHT BILLS & PAYMENTS */}
      {activeTab === "bills" && (
        <div className="glass-card border border-onyx/5 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-cream-dark/50 border-b border-onyx/5">
                <tr>
                  <th className="p-3 w-10"></th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Bill Details</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Transport Order</th>
                  <th className="p-3 font-bold uppercase text-onyx/60">Transporter</th>
                  <th className="p-3 font-bold uppercase text-right text-onyx/60">Bill Amount</th>
                  <th className="p-3 font-bold uppercase text-right text-onyx/60">Pending Balance</th>
                  <th className="p-3 font-bold uppercase text-center text-onyx/60">Status</th>
                  <th className="p-3 font-bold uppercase text-center text-onyx/60">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                {filteredBills.map((b) => {
                  const isExpanded = expandedBillId === b.id;
                  return (
                    <React.Fragment key={b.id}>
                      <tr className="hover:bg-cream-dark/15 transition-colors">
                        <td className="p-3">
                          <button
                            onClick={() => setExpandedBillId(isExpanded ? null : b.id)}
                            className="p-1 text-onyx/50 hover:text-onyx cursor-pointer"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-onyx">{b.billNo}</div>
                          <div className="text-[10px] text-onyx/50 font-mono mt-0.5">
                            Date: {new Date(b.billDate).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="p-3 font-mono font-semibold text-onyx">{b.transportOrderNo}</td>
                        <td className="p-3 font-semibold text-onyx">{b.transporterName}</td>
                        <td className="p-3 text-right font-mono font-bold">
                          ₹{b.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-red-650">
                          ₹{b.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-block text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            b.paymentStatus === "PAID" 
                              ? "bg-emerald-100 text-emerald-800" 
                              : b.paymentStatus === "PARTIALLY_PAID" 
                                ? "bg-amber-100 text-amber-800" 
                                : "bg-red-100 text-red-800"
                          }`}>
                            {b.paymentStatus.replace("_", " ")}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center space-x-2">
                            {b.paymentStatus !== "PAID" && (
                              <button
                                onClick={() => {
                                  setSelectedBillForPayment(b);
                                  setNewPayment((prev) => ({ ...prev, amount: b.balance }));
                                  setShowPaymentModal(true);
                                }}
                                className="text-[10px] bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-2 py-1 rounded font-bold transition cursor-pointer"
                              >
                                Record Payment
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteBill(b.id)}
                              className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded payments view */}
                      {isExpanded && (
                        <tr className="bg-cream-dark/5">
                          <td colSpan={8} className="p-4">
                            <div className="space-y-2 border-l-2 border-saffron pl-4">
                              <h4 className="text-xs font-bold text-onyx uppercase tracking-wider">Payment Transactions</h4>
                              {b.payments.length === 0 ? (
                                <p className="text-[11px] text-onyx/40 italic">No payments logged yet against this bill.</p>
                              ) : (
                                <div className="space-y-1 text-[11px]">
                                  {b.payments.map((p) => (
                                    <div key={p.id} className="flex items-center justify-between max-w-xl py-1 border-b border-onyx/5">
                                      <span className="font-mono text-onyx/60">{p.paymentNo}</span>
                                      <span className="text-onyx/75">{new Date(p.paymentDate).toLocaleDateString()}</span>
                                      <span className="text-onyx/75">{p.paymentMethod} {p.referenceNo ? `(Ref: ${p.referenceNo})` : ""}</span>
                                      <span className="font-mono font-bold text-onyx">₹{p.amount.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredBills.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-onyx/40 font-medium">
                      No invoices/bills found. Click "Process Freight Bill" to log transporter bills.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: NEW TRANSPORT ORDER */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-onyx-dark/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateOrder} className="bg-white rounded-xl shadow-xl w-full max-w-2xl border border-onyx/10 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-onyx/5 bg-cream-dark/15 flex items-center justify-between">
              <h3 className="font-bold text-onyx flex items-center text-sm uppercase">
                <Truck className="mr-2 text-saffron" size={16} />
                Create Transport Order
              </h3>
              <button type="button" onClick={() => setShowOrderModal(false)} className="text-onyx/40 hover:text-onyx text-lg">×</button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Transporter */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Transporter *</label>
                  <select
                    value={newOrder.transporterId}
                    onChange={(e) => triggerRateFill("transporterId", e.target.value)}
                    required
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  >
                    <option value="">Select Transporter</option>
                    {transporters.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                    ))}
                  </select>
                </div>

                {/* Capacity */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Vehicle Capacity *</label>
                  <select
                    value={newOrder.vehicleCapacity}
                    onChange={(e) => triggerRateFill("vehicleCapacity", e.target.value)}
                    required
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  >
                    {LOAD_CAPACITIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* From Location */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">From Location *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Warehouse Delhi"
                    value={newOrder.fromLocation}
                    onChange={(e) => triggerRateFill("fromLocation", e.target.value)}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                {/* To Location */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">To Location *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Factory Pune"
                    value={newOrder.toLocation}
                    onChange={(e) => triggerRateFill("toLocation", e.target.value)}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                {/* Vehicle No */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Vehicle Number</label>
                  <input
                    type="text"
                    placeholder="e.g. DL-01-A-1234"
                    value={newOrder.vehicleNo}
                    onChange={(e) => setNewOrder((p) => ({ ...p, vehicleNo: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                {/* Driver Details */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Driver Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={newOrder.driverName}
                    onChange={(e) => setNewOrder((p) => ({ ...p, driverName: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Driver Phone</label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={newOrder.driverPhone}
                    onChange={(e) => setNewOrder((p) => ({ ...p, driverPhone: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                {/* Points */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Loading Address / Point</label>
                  <input
                    type="text"
                    placeholder="e.g. Gate No. 2"
                    value={newOrder.loadingPoint}
                    onChange={(e) => setNewOrder((p) => ({ ...p, loadingPoint: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Unloading Address / Point</label>
                  <input
                    type="text"
                    placeholder="e.g. Store Room B"
                    value={newOrder.unloadingPoint}
                    onChange={(e) => setNewOrder((p) => ({ ...p, unloadingPoint: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                  />
                </div>

                {/* References */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Linked Purchase Order (PO)</label>
                  <select
                    value={newOrder.poId}
                    onChange={(e) => setNewOrder((p) => ({ ...p, poId: e.target.value }))}
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="">None</option>
                    {purchaseOrders.map((po) => (
                      <option key={po.id} value={po.id}>{po.number}</option>
                    ))}
                  </select>
                </div>

              </div>

              {/* Pricing section */}
              <div className="border-t border-onyx/5 pt-4 bg-cream-dark/5 p-4 rounded-xl space-y-4">
                <h4 className="text-xs font-bold text-onyx uppercase tracking-wider flex items-center">
                  <DollarSign size={14} className="text-saffron mr-1" />
                  Freight Cost Details
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-onyx/60">Base Freight Rate *</label>
                    <input
                      type="number"
                      required
                      value={newOrder.freightAmount}
                      onChange={(e) => setNewOrder((p) => ({ ...p, freightAmount: parseFloat(e.target.value) || 0 }))}
                      className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-onyx/60">Other / Toll Charges</label>
                    <input
                      type="number"
                      value={newOrder.otherCharges}
                      onChange={(e) => setNewOrder((p) => ({ ...p, otherCharges: parseFloat(e.target.value) || 0 }))}
                      className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-onyx/60">GST Tax Rate (%)</label>
                    <input
                      type="number"
                      value={newOrder.taxRate}
                      onChange={(e) => setNewOrder((p) => ({ ...p, taxRate: parseFloat(e.target.value) || 0 }))}
                      className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-bold border-t border-onyx/10 pt-3">
                  <span className="text-onyx/60 uppercase">Calculated Total Transport Cost:</span>
                  <span className="text-sm font-mono text-onyx">
                    ₹{selectedOrderTotalCost.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-onyx/5 flex items-center justify-end space-x-3">
              <button type="button" onClick={() => setShowOrderModal(false)} className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/10 transition cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow transition cursor-pointer">Place Transport Order</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: DEFINE ROUTE RATE */}
      {showRateModal && (
        <div className="fixed inset-0 bg-onyx-dark/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateRate} className="bg-white rounded-xl shadow-xl w-full max-w-md border border-onyx/10">
            <div className="p-4 border-b border-onyx/5 bg-cream-dark/15 flex items-center justify-between">
              <h3 className="font-bold text-onyx flex items-center text-sm uppercase">
                <MapPin className="mr-2 text-saffron" size={16} />
                Define Route Standard Rate
              </h3>
              <button type="button" onClick={() => setShowRateModal(false)} className="text-onyx/40 hover:text-onyx text-lg">×</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Transporter */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Transporter *</label>
                <select
                  value={newRate.transporterId}
                  onChange={(e) => setNewRate((p) => ({ ...p, transporterId: e.target.value }))}
                  required
                  className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                >
                  <option value="">Select Transporter</option>
                  {transporters.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                  ))}
                </select>
              </div>

              {/* From/To */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">From Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Warehouse Delhi"
                  value={newRate.fromLocation}
                  onChange={(e) => setNewRate((p) => ({ ...p, fromLocation: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">To Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Factory Pune"
                  value={newRate.toLocation}
                  onChange={(e) => setNewRate((p) => ({ ...p, toLocation: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              {/* Capacity & Rate */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Vehicle Capacity *</label>
                  <select
                    value={newRate.vehicleCapacity}
                    onChange={(e) => setNewRate((p) => ({ ...p, vehicleCapacity: e.target.value }))}
                    required
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg"
                  >
                    {LOAD_CAPACITIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Standard Rate (₹) *</label>
                  <input
                    type="number"
                    required
                    value={newRate.rate}
                    onChange={(e) => setNewRate((p) => ({ ...p, rate: parseFloat(e.target.value) || 0 }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-onyx/5 flex items-center justify-end space-x-3">
              <button type="button" onClick={() => setShowRateModal(false)} className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/10 transition cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow transition cursor-pointer">Save Rate</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: ADD TRANSPORTER */}
      {showTransporterModal && (
        <div className="fixed inset-0 bg-onyx-dark/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateTransporter} className="bg-white rounded-xl shadow-xl w-full max-w-md border border-onyx/10">
            <div className="p-4 border-b border-onyx/5 bg-cream-dark/15 flex items-center justify-between">
              <h3 className="font-bold text-onyx flex items-center text-sm uppercase">
                <Truck className="mr-2 text-saffron" size={16} />
                Add Registered Transporter
              </h3>
              <button type="button" onClick={() => setShowTransporterModal(false)} className="text-onyx/40 hover:text-onyx text-lg">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Transporter Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRL Logistics"
                  value={newTransporter.name}
                  onChange={(e) => setNewTransporter((p) => ({ ...p, name: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Custom Code (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. TR-VRL"
                  value={newTransporter.code}
                  onChange={(e) => setNewTransporter((p) => ({ ...p, code: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">GSTIN</label>
                  <input
                    type="text"
                    placeholder="15-character GSTIN"
                    value={newTransporter.gstin}
                    onChange={(e) => setNewTransporter((p) => ({ ...p, gstin: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Credit Days</label>
                  <input
                    type="number"
                    value={newTransporter.creditDays}
                    onChange={(e) => setNewTransporter((p) => ({ ...p, creditDays: parseInt(e.target.value) || 0 }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Office Address</label>
                <textarea
                  placeholder="Street details..."
                  rows={2}
                  value={newTransporter.address}
                  onChange={(e) => setNewTransporter((p) => ({ ...p, address: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-onyx/5 flex items-center justify-end space-x-3">
              <button type="button" onClick={() => setShowTransporterModal(false)} className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/10 transition cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow transition cursor-pointer">Register Transporter</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: PROCESS FREIGHT BILL */}
      {showBillModal && (
        <div className="fixed inset-0 bg-onyx-dark/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateBill} className="bg-white rounded-xl shadow-xl w-full max-w-md border border-onyx/10">
            <div className="p-4 border-b border-onyx/5 bg-cream-dark/15 flex items-center justify-between">
              <h3 className="font-bold text-onyx flex items-center text-sm uppercase">
                <FileText className="mr-2 text-saffron" size={16} />
                Log Transporter Freight Bill
              </h3>
              <button type="button" onClick={() => setShowBillModal(false)} className="text-onyx/40 hover:text-onyx text-lg">×</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Transport Order selection */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Select Placed Transport Order *</label>
                <select
                  value={newBill.transportOrderId}
                  onChange={(e) => {
                    const orderId = e.target.value;
                    const order = orders.find((o) => o.id === orderId);
                    setNewBill((p) => ({
                      ...p,
                      transportOrderId: orderId,
                      amount: order ? order.totalAmount : 0,
                    }));
                  }}
                  required
                  className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                >
                  <option value="">Select Placed Order</option>
                  {orders
                    .filter((o) => ["PLACED", "DELIVERED"].includes(o.status))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number} ({o.transporterName} • Route: {o.fromLocation} → {o.toLocation})
                      </option>
                    ))}
                </select>
              </div>

              {/* Bill Details */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Bill Invoice Number *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRL-4512A"
                  value={newBill.billNo}
                  onChange={(e) => setNewBill((p) => ({ ...p, billNo: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Bill Date *</label>
                  <input
                    type="date"
                    required
                    value={newBill.billDate}
                    onChange={(e) => setNewBill((p) => ({ ...p, billDate: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Bill Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    value={newBill.amount}
                    onChange={(e) => setNewBill((p) => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Due Date (Optional)</label>
                <input
                  type="date"
                  value={newBill.dueDate}
                  onChange={(e) => setNewBill((p) => ({ ...p, dueDate: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-onyx/5 flex items-center justify-end space-x-3">
              <button type="button" onClick={() => setShowBillModal(false)} className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/10 transition cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow transition cursor-pointer">Process Freight Bill</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 5: RECORD TRANSPORT PAYMENT */}
      {showPaymentModal && selectedBillForPayment && (
        <div className="fixed inset-0 bg-onyx-dark/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRecordPaymentSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md border border-onyx/10">
            <div className="p-4 border-b border-onyx/5 bg-cream-dark/15 flex items-center justify-between">
              <h3 className="font-bold text-onyx flex items-center text-sm uppercase">
                <CreditCard className="mr-2 text-saffron" size={16} />
                Record Transporter Payment
              </h3>
              <button type="button" onClick={() => { setShowPaymentModal(false); setSelectedBillForPayment(null); }} className="text-onyx/40 hover:text-onyx text-lg">×</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Info block */}
              <div className="bg-cream-dark/5 p-3 rounded-lg text-xs space-y-1 text-onyx">
                <div><strong>Bill No:</strong> {selectedBillForPayment.billNo}</div>
                <div><strong>Transporter:</strong> {selectedBillForPayment.transporterName}</div>
                <div><strong>Outstanding Balance:</strong> ₹{selectedBillForPayment.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
              </div>

              {/* Payment details */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Payment Amount (₹) *</label>
                <input
                  type="number"
                  required
                  value={newPayment.amount}
                  onChange={(e) => setNewPayment((p) => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={newPayment.paymentDate}
                    onChange={(e) => setNewPayment((p) => ({ ...p, paymentDate: e.target.value }))}
                    className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-onyx/60">Payment Method *</label>
                  <select
                    value={newPayment.paymentMethod}
                    onChange={(e) => setNewPayment((p) => ({ ...p, paymentMethod: e.target.value }))}
                    required
                    className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg focus:outline-none"
                  >
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-onyx/60">Reference Number (Ref/Txn No)</label>
                <input
                  type="text"
                  placeholder="e.g. UTR-123456789"
                  value={newPayment.referenceNo}
                  onChange={(e) => setNewPayment((p) => ({ ...p, referenceNo: e.target.value }))}
                  className="w-full text-xs p-2 border border-onyx/10 rounded-lg focus:outline-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-onyx/5 flex items-center justify-end space-x-3">
              <button type="button" onClick={() => { setShowPaymentModal(false); setSelectedBillForPayment(null); }} className="px-4 py-2 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/10 transition cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow transition cursor-pointer">Record Payment</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
