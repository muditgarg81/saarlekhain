"use client";

import { useState } from "react";
import { 
  Search, 
  FileSpreadsheet, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  CheckCircle,
  PackageCheck,
  X
} from "lucide-react";
import * as utils from "xlsx";
import { getItemStockLogs } from "@/app/actions/items";

interface StockRow {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  qty: number;
  valuationRate: number;
  totalValue: number;
  reorderLevel: number;
  qcRequired: boolean;
  baseUom: string;
  procurementStatus: "INDENTED" | "PO_ISSUED" | "NONE";
}

interface StoresReportsListProps {
  stockData: StockRow[];
  categories: { id: string; name: string }[];
  totalCompanyValuation: number;
  totalItemsCount: number;
  lowStockItemsCount: number;
}

export default function StoresReportsList({
  stockData,
  categories,
  totalCompanyValuation,
  totalItemsCount,
  lowStockItemsCount
}: StoresReportsListProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{ id: string; code: string; name: string } | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const handleItemClick = async (item: { id: string; code: string; name: string }) => {
    setSelectedItem(item);
    setIsLogsOpen(true);
    setLogsLoading(true);
    setLogsError(null);
    setLogs([]);

    const res = await getItemStockLogs(item.id, startDate, endDate);
    setLogsLoading(false);
    if (res.success) {
      setLogs(res.logs || []);
    } else {
      setLogsError(res.error || "Failed to fetch stock logs");
    }
  };

  // Filter the derived stock ledger rows
  const filteredData = stockData.filter(row => {
    const matchesSearch = row.name.toLowerCase().includes(search.toLowerCase()) || 
                          row.code.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === "all" || row.categoryName === selectedCategory;
    
    const isLowStock = row.qty < row.reorderLevel;
    const matchesLowStock = !showLowStockOnly || isLowStock;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(amount);
  };

  const exportToExcel = () => {
    const dataToExport = filteredData.map(row => ({
      "Item Code": row.code,
      "Item Name": row.name,
      "Category": row.categoryName,
      "Qty on Hand": row.qty,
      "Base UOM": row.baseUom,
      "Valuation Rate (INR)": row.valuationRate.toFixed(2),
      "Total Value (INR)": row.totalValue.toFixed(2),
      "Reorder Level": row.reorderLevel,
      "Procurement Status": row.procurementStatus === "NONE" ? "-" : row.procurementStatus.replace("_", " "),
      "Status": row.qty === 0 ? "OUT OF STOCK" : (row.qty < row.reorderLevel ? "LOW STOCK" : "GOOD"),
    }));

    const worksheet = utils.utils.json_to_sheet(dataToExport);
    const workbook = utils.utils.book_new();
    utils.utils.book_append_sheet(workbook, worksheet, "Inventory Status");
    utils.writeFile(workbook, "Saarlekha_Inventory_Valuation_Report.xlsx");
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Inventory Stock & Valuation</h2>
          <p className="text-xs text-onyx/50 mt-1">Real-time ledger-derived balances, average unit rates, and totals.</p>
        </div>
        <div>
          <button
            onClick={exportToExcel}
            className="flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-cream-dark/50 border border-onyx/10 rounded-lg text-xs font-semibold text-onyx shadow-sm transition-all duration-150 cursor-pointer"
          >
            <FileSpreadsheet size={15} className="text-emerald-700" />
            <span>Export Valuation Report</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Total Value */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Total Stock Value</p>
            <p className="text-2xl font-bold text-onyx mt-0.5">{formatCurrency(totalCompanyValuation)}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Weighted Average total</p>
          </div>
        </div>

        {/* Total Items count */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark">
            <PackageCheck size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Stock SKU Count</p>
            <p className="text-2xl font-bold text-onyx mt-0.5">{totalItemsCount}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Total items tracked</p>
          </div>
        </div>

        {/* Low Stock Items count */}
        <div className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4">
          <div className={`p-3 border rounded-lg ${
            lowStockItemsCount > 0 
              ? "bg-red-50 border-red-100 text-red-600 animate-pulse" 
              : "bg-cream-dark border-onyx/5 text-green-600"
          }`}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">Low Stock SKUs</p>
            <p className="text-2xl font-bold text-onyx mt-0.5">{lowStockItemsCount}</p>
            <p className="text-[10px] text-onyx/40 font-medium">Below reorder levels</p>
          </div>
        </div>
      </div>

      {/* Grid Filters */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5 flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Search by code, item name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Start Date */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-bold text-onyx/40 uppercase">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-2 py-1.5 focus:outline-none focus:border-saffron font-mono"
            />
          </div>

          {/* End Date */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-bold text-onyx/40 uppercase">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-2 py-1.5 focus:outline-none focus:border-saffron font-mono"
            />
          </div>

          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs bg-cream-dark/45 border border-onyx/10 rounded-lg px-3 py-2 focus:outline-none focus:border-saffron"
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>

          {/* Toggle Low Stock */}
          <button
            onClick={() => setShowLowStockOnly(prev => !prev)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all duration-150 cursor-pointer ${
              showLowStockOnly 
                ? "bg-red-50 hover:bg-red-100 text-red-800 border-red-200" 
                : "bg-white hover:bg-cream-dark/50 text-onyx border-onyx/10"
            }`}
          >
            {showLowStockOnly ? "Showing Low Stock" : "Filter Low Stock"}
          </button>
        </div>
      </div>

      {/* Derived Stock Table */}
      <div className="glass-card rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full dense-table text-left border-collapse">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Category</th>
                <th className="text-right">Qty on Hand</th>
                <th>Base UOM</th>
                <th className="text-right">Valuation Rate</th>
                <th className="text-right">Total Stock Value</th>
                <th className="text-right">Reorder Level</th>
                <th className="text-center">Procurement</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-onyx/40 font-medium">
                    No inventory rows found.
                  </td>
                </tr>
              ) : (
                filteredData.map((row) => {
                  const isLow = row.qty < row.reorderLevel;
                  const isOut = row.qty === 0;
                  return (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleItemClick({ id: row.id, code: row.code, name: row.name })}
                          className="font-mono font-bold text-xs text-saffron-dark hover:underline focus:outline-none cursor-pointer text-left"
                        >
                          {row.code}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleItemClick({ id: row.id, code: row.code, name: row.name })}
                          className="font-semibold text-onyx hover:text-saffron-dark text-left focus:outline-none cursor-pointer"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td>{row.categoryName}</td>
                      <td className="text-right font-bold font-mono">{row.qty}</td>
                      <td className="font-semibold text-onyx/50">{row.baseUom}</td>
                      <td className="text-right font-mono">{formatCurrency(row.valuationRate)}</td>
                      <td className="text-right font-mono font-bold text-onyx">{formatCurrency(row.totalValue)}</td>
                      <td className="text-right font-mono text-onyx/60">{row.reorderLevel}</td>
                      <td className="text-center">
                        {row.procurementStatus === "PO_ISSUED" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800 uppercase">
                            PO Issued
                          </span>
                        ) : row.procurementStatus === "INDENTED" ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-850 uppercase">
                            Indented
                          </span>
                        ) : (
                          <span className="text-onyx/30 font-bold font-mono text-xs">-</span>
                        )}
                      </td>
                      <td className="text-center">
                        {isOut ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-800 uppercase">
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 uppercase animate-pulse">
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-800 uppercase">
                            Good
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Logs Side Drawer */}
      {isLogsOpen && selectedItem && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-cream h-full border-l border-onyx/10 flex flex-col shadow-2xl p-6 relative animate-in slide-in-from-right duration-200">
            <button 
              onClick={() => setIsLogsOpen(false)} 
              className="absolute top-6 right-6 text-onyx/40 hover:text-onyx cursor-pointer"
            >
              <X size={20} />
            </button>

            <div className="space-y-2 mt-4 pb-4 border-b border-onyx/5">
              <span className="text-[10px] font-mono font-bold bg-saffron px-2 py-0.5 rounded text-onyx">
                {selectedItem.code}
              </span>
              <h3 className="font-heading text-lg font-extrabold text-onyx">
                Item Stock Ledger Logs
              </h3>
              <p className="text-xs text-onyx/60 font-semibold">
                {selectedItem.name}
              </p>
              {(startDate || endDate) && (
                <p className="text-[10px] text-onyx/40 font-medium">
                  Period: {startDate ? new Date(startDate).toLocaleDateString() : "Beginning"} to {endDate ? new Date(endDate).toLocaleDateString() : "Present"}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-6 space-y-4">
              {logsLoading ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-2">
                  <div className="w-6 h-6 border-2 border-saffron border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-onyx/40 font-medium">Loading ledger logs...</p>
                </div>
              ) : logsError ? (
                <div className="p-4 bg-red-50 border border-red-150 rounded-lg text-center text-xs text-red-700 font-medium">
                  {logsError}
                </div>
              ) : logs.length === 0 ? (
                <div className="p-8 bg-white border border-dashed border-onyx/15 rounded-lg text-center text-xs text-onyx/40 font-medium">
                  No stock movements logged for this period.
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => {
                    const isPositive = log.qty > 0;
                    return (
                      <div 
                        key={log.id} 
                        className="p-3.5 bg-white border border-onyx/5 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                              isPositive 
                                ? "bg-green-50 text-green-700 border border-green-200" 
                                : "bg-red-50 text-red-700 border border-red-200"
                            }`}>
                              {log.txnType.replace("_", " ")}
                            </span>
                            <span className="text-[10px] text-onyx/40 font-mono">
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-onyx/60 font-mono">
                            <div><span className="text-onyx/40 font-heading">Store:</span> {log.storeName}</div>
                            <div><span className="text-onyx/40 font-heading">Ref:</span> {log.refNo}</div>
                            {log.rate !== null && log.rate !== undefined && (
                              <div><span className="text-onyx/40 font-heading">Rate:</span> ₹{log.rate.toFixed(2)}</div>
                            )}
                          </div>
                        </div>
                        
                        <div className="text-right self-end sm:self-center">
                          <span className={`font-mono text-sm font-bold ${
                            isPositive ? "text-green-600" : "text-red-600"
                          }`}>
                            {isPositive ? "+" : ""}{log.qty}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-onyx/5">
              <button 
                onClick={() => setIsLogsOpen(false)}
                className="w-full py-2.5 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
