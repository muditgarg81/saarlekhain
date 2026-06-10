"use client";

import { useState } from "react";
import { ErpType } from "@prisma/client";
import { 
  saveErpConnection, 
  mapVendorLedger, 
  generateBridgeAgentToken, 
  syncCreditorsMock 
} from "@/app/actions/erp";
import { 
  Search, 
  Plus, 
  X, 
  Check, 
  RefreshCw, 
  AlertCircle, 
  ShieldCheck, 
  Settings, 
  Link,
  Laptop,
  PlayCircle,
  Copy,
  Info,
  Server,
  Workflow
} from "lucide-react";

interface Connection {
  id: string;
  type: string;
  erpCompanyName: string;
  writebackEnabled: boolean;
  status: string;
  lastSyncAt: string | null;
  demoMode: boolean;
}

interface Mapping {
  id: string;
  vendorId: string;
  vendorName: string;
  erpLedgerName: string;
  billwise: boolean;
  status: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

interface Bill {
  id: string;
  billRef: string;
  billDate: string | null;
  dueDate: string | null;
  openingAmount: number;
  pendingAmount: number;
  overdueDays: number;
}

interface CreditorStatement {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  outstanding: number;
  asOf: string;
  bills: Bill[];
}

interface IntegrationSettingsProps {
  connections: Connection[];
  mappings: Mapping[];
  vendors: Vendor[];
  agents: any[];
  statements: CreditorStatement[];
}

export default function IntegrationSettings({
  connections,
  mappings,
  vendors,
  agents,
  statements
}: IntegrationSettingsProps) {
  const [activeConnection, setActiveConnection] = useState<Connection | null>(
    connections[0] || null
  );

  const [rightTab, setRightTab] = useState<"mappings" | "statements">("mappings");
  const [statementSearch, setStatementSearch] = useState("");
  const [selectedStatement, setSelectedStatement] = useState<CreditorStatement | null>(null);
  const [isStatementDetailOpen, setIsStatementDetailOpen] = useState(false);

  // Form states
  const [erpConfig, setErpConfig] = useState<{
    type: ErpType;
    erpCompanyName: string;
    writebackEnabled: boolean;
    demoMode: boolean;
  }>({
    type: (activeConnection?.type as ErpType) || ErpType.TALLY,
    erpCompanyName: activeConnection?.erpCompanyName || "ACME Industries Pvt Ltd",
    writebackEnabled: activeConnection?.writebackEnabled || false,
    demoMode: activeConnection?.demoMode || true
  });

  const [mapForm, setMapForm] = useState({
    vendorId: "",
    erpLedgerName: "",
    billwise: true
  });

  const [newAgentName, setNewAgentName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);
    const res = await saveErpConnection(erpConfig);
    setActionLoading(false);

    if (res.success) {
      alert("ERP connection parameters successfully updated!");
      window.location.reload();
    } else {
      setErrorMsg(res.error || "Failed to save ERP connection");
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) {
      alert("Please configure and save your ERP Connection settings first");
      return;
    }
    if (!newAgentName.trim()) return;

    setActionLoading(true);
    const res = await generateBridgeAgentToken(activeConnection.id, newAgentName);
    setActionLoading(false);

    if (res.success && res.token) {
      setGeneratedToken(res.token);
      setNewAgentName("");
    } else {
      alert("Error generating agent: " + res.error);
    }
  };

  const handleMapVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) return;
    if (!mapForm.vendorId || !mapForm.erpLedgerName.trim()) {
      alert("Please select a vendor and specify the ERP ledger name");
      return;
    }

    setActionLoading(true);
    const res = await mapVendorLedger({
      connectionId: activeConnection.id,
      vendorId: mapForm.vendorId,
      erpLedgerName: mapForm.erpLedgerName,
      billwise: mapForm.billwise
    });
    setActionLoading(false);

    if (res.success) {
      setMapForm({ vendorId: "", erpLedgerName: "", billwise: true });
      window.location.reload();
    } else {
      alert("Mapping failed: " + res.error);
    }
  };

  const handleSyncMock = async () => {
    if (!activeConnection) return;
    setActionLoading(true);
    const res = await syncCreditorsMock(activeConnection.id);
    setActionLoading(false);

    if (res.success) {
      alert("Demo sync completed! Mock outstanding statements generated for mapped vendors.");
      window.location.reload();
    } else {
      alert("Sync failed: " + res.error);
    }
  };

  const copyTokenToClipboard = () => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      alert("Token copied to clipboard!");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-onyx">ERP & Tally Settings</h2>
        <p className="text-xs text-onyx/50 mt-1">Configure credentials and map local Tally Sundry Creditors ledger accounts outbound to Saarlekha cloud.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Connection Config */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-card p-5 rounded-xl border border-onyx/5 space-y-4">
            <h3 className="font-heading font-bold text-sm text-onyx flex items-center space-x-2">
              <Server size={16} />
              <span>ERP Connectivity Profile</span>
            </h3>

            <form onSubmit={handleSaveConnection} className="space-y-4 text-xs">
              {errorMsg && <p className="text-red-600 font-bold">{errorMsg}</p>}

              <div>
                <label className="block font-bold text-onyx/70 uppercase text-[9px] mb-1">ERP Type</label>
                <select
                  value={erpConfig.type}
                  onChange={(e) => setErpConfig(prev => ({ ...prev, type: e.target.value as ErpType }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none"
                >
                  <option value="TALLY">Tally Prime (HTTP-XML)</option>
                  <option value="ZOHO_BOOKS">Zoho Books API</option>
                  <option value="SAP_B1">SAP Business One</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-onyx/70 uppercase text-[9px] mb-1">ERP Company Name</label>
                <input
                  type="text"
                  required
                  value={erpConfig.erpCompanyName}
                  onChange={(e) => setErpConfig(prev => ({ ...prev, erpCompanyName: e.target.value }))}
                  className="w-full p-2 bg-cream-dark/30 border border-onyx/10 rounded focus:outline-none font-semibold"
                />
                <span className="text-[9px] text-onyx/40">Matches exact `SVCurrentCompany` title loaded inside Tally.</span>
              </div>

              <div className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id="writebackEnabled"
                  checked={erpConfig.writebackEnabled}
                  onChange={(e) => setErpConfig(prev => ({ ...prev, writebackEnabled: e.target.checked }))}
                  className="rounded text-saffron"
                />
                <label htmlFor="writebackEnabled" className="font-bold text-onyx/75 text-[10px] uppercase">
                  Enable Payment Writeback
                </label>
              </div>

              <div className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id="demoMode"
                  checked={erpConfig.demoMode}
                  onChange={(e) => setErpConfig(prev => ({ ...prev, demoMode: e.target.checked }))}
                  className="rounded text-saffron"
                />
                <label htmlFor="demoMode" className="font-bold text-saffron-dark text-[10px] uppercase flex items-center space-x-1">
                  <span>Demo / Simulation Mode</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full py-2 bg-onyx hover:bg-onyx-light text-cream-light font-bold rounded cursor-pointer"
              >
                Save Connectivity Profile
              </button>
            </form>
          </div>

          {/* Bridge Agents list */}
          {activeConnection && (
            <div className="glass-card p-5 rounded-xl border border-onyx/5 space-y-4">
              <h3 className="font-heading font-bold text-sm text-onyx flex items-center space-x-2">
                <Laptop size={16} />
                <span>LAN Bridge Agents</span>
              </h3>

              <div className="space-y-3">
                <form onSubmit={handleCreateAgent} className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Agent location name"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    className="flex-1 text-xs p-1.5 bg-cream-dark/30 border border-onyx/10 rounded"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-saffron hover:bg-saffron-dark text-onyx text-[10px] font-bold rounded cursor-pointer"
                  >
                    Add
                  </button>
                </form>

                {generatedToken && (
                  <div className="p-3 bg-saffron/10 border border-saffron/20 rounded space-y-2 text-xs">
                    <p className="font-bold text-saffron-dark text-[10px] uppercase">Copy Bridge Token:</p>
                    <div className="flex items-center justify-between gap-2 bg-white p-1.5 rounded font-mono text-[10px]">
                      <span className="truncate flex-1">{generatedToken}</span>
                      <button onClick={copyTokenToClipboard} className="text-onyx/60 hover:text-onyx cursor-pointer">
                        <Copy size={14} />
                      </button>
                    </div>
                    <p className="text-[9px] text-onyx/50">Supply this token inside the `bridge-agent.js` startup script config.</p>
                  </div>
                )}

                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {agents.length === 0 ? (
                    <p className="text-center py-4 text-xs text-onyx/40">No agents registered.</p>
                  ) : (
                    agents.map((ag: any) => (
                      <div key={ag.id} className="p-2 bg-white border border-onyx/5 rounded flex items-center justify-between text-xs">
                        <div>
                          <p className="font-semibold">{ag.name}</p>
                          <p className="text-[9px] text-onyx/40 font-mono">Token ID: {ag.id.slice(0, 10)}...</p>
                        </div>
                        <span suppressHydrationWarning className={`w-2.5 h-2.5 rounded-full ${
                          ag.lastSeenAt && (Date.now() - new Date(ag.lastSeenAt).getTime() < 30000)
                            ? "bg-green-500 animate-pulse"
                            : "bg-red-400"
                        }`} title={ag.lastSeenAt ? `Last seen: ${new Date(ag.lastSeenAt).toLocaleTimeString()}` : "Offline"} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Vendor Mapping & Sync */}
        <div className="lg:col-span-2 space-y-6">
          {activeConnection && (
            <div className="glass-card p-5 rounded-xl border border-onyx/5 space-y-4">
              
              {/* Tab Navigation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-onyx/5 pb-2 gap-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setRightTab("mappings")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      rightTab === "mappings"
                        ? "bg-onyx text-cream-light shadow"
                        : "text-onyx/60 hover:bg-cream-dark/35"
                    }`}
                  >
                    Ledger Account Mappings
                  </button>
                  <button
                    onClick={() => setRightTab("statements")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      rightTab === "statements"
                        ? "bg-onyx text-cream-light shadow"
                        : "text-onyx/60 hover:bg-cream-dark/35"
                    }`}
                  >
                    Synced Creditor Statements ({statements.length})
                  </button>
                </div>

                {activeConnection.demoMode && (
                  <button
                    onClick={handleSyncMock}
                    disabled={actionLoading}
                    className="flex items-center space-x-1.5 px-3 py-1 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded text-[10px] cursor-pointer transition-all shadow-sm"
                  >
                    <RefreshCw size={12} className={actionLoading ? "animate-spin" : ""} />
                    <span>Sync Live Balances (Demo Mode)</span>
                  </button>
                )}
              </div>

              {rightTab === "mappings" ? (
                <>
                  {/* Mapping Form */}
                  <form onSubmit={handleMapVendor} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end p-3 bg-cream-dark/30 rounded-xl border border-onyx/5">
                    <div className="sm:col-span-5 text-xs">
                      <label className="block text-[9px] font-bold uppercase text-onyx/55 mb-0.5">Saarlekha Vendor</label>
                      <select
                        value={mapForm.vendorId}
                        onChange={(e) => setMapForm(prev => ({ ...prev, vendorId: e.target.value }))}
                        className="w-full p-2 bg-white border border-onyx/10 rounded focus:outline-none"
                        required
                      >
                        <option value="">Select Vendor</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>[{v.code}] {v.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-5 text-xs">
                      <label className="block text-[9px] font-bold uppercase text-onyx/55 mb-0.5">Tally Ledger Account Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Sharma Steel Traders"
                        value={mapForm.erpLedgerName}
                        onChange={(e) => setMapForm(prev => ({ ...prev, erpLedgerName: e.target.value }))}
                        className="w-full p-2 bg-white border border-onyx/10 rounded focus:outline-none font-semibold"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-center">
                      <button
                        type="submit"
                        className="w-full py-2 bg-onyx hover:bg-onyx-light text-cream-light text-xs font-bold rounded cursor-pointer"
                      >
                        Add Mapping
                      </button>
                    </div>
                  </form>

                  {/* Mappings register list */}
                  <div className="border border-onyx/5 rounded-lg overflow-hidden">
                    <table className="w-full dense-table text-left border-collapse">
                      <thead>
                        <tr>
                          <th>Saarlekha Vendor</th>
                          <th>Tally Ledger Name</th>
                          <th>Bill-by-Bill</th>
                          <th className="text-center">Sync Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-xs text-onyx/40">
                              No ledger mappings defined. Define mappings in the form above.
                            </td>
                          </tr>
                        ) : (
                          mappings.map((m) => (
                            <tr key={m.id}>
                              <td className="font-semibold">{m.vendorName}</td>
                              <td className="font-mono text-xs">{m.erpLedgerName}</td>
                              <td>
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                  m.billwise ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                                }`}>
                                  {m.billwise ? "Yes" : "No"}
                                </span>
                              </td>
                              <td className="text-center">
                                <span className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                  m.status === "MAPPED" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                                }`}>
                                  {m.status === "MAPPED" ? "Synced" : "Out of sync / Config warn"}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  {/* Search */}
                  <div className="relative text-xs">
                    <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
                      <Search size={14} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search synced statements by vendor..."
                      value={statementSearch}
                      onChange={(e) => setStatementSearch(e.target.value)}
                      className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none"
                    />
                  </div>

                  {/* Statements Table */}
                  <div className="border border-onyx/5 rounded-lg overflow-hidden">
                    <table className="w-full dense-table text-left border-collapse">
                      <thead>
                        <tr>
                          <th>Vendor / Supplier</th>
                          <th>Mapped Ledger</th>
                          <th className="text-right">Outstanding (Payable)</th>
                          <th>As Of Date</th>
                          <th className="text-center w-28">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statements.filter(s => 
                          s.vendorName.toLowerCase().includes(statementSearch.toLowerCase()) ||
                          s.vendorCode.toLowerCase().includes(statementSearch.toLowerCase())
                        ).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-6 text-xs text-onyx/40">
                              No synced statements found. Trigger a Tally sync to load live balances.
                            </td>
                          </tr>
                        ) : (
                          statements.filter(s => 
                            s.vendorName.toLowerCase().includes(statementSearch.toLowerCase()) ||
                            s.vendorCode.toLowerCase().includes(statementSearch.toLowerCase())
                          ).map((s) => {
                            const mapping = mappings.find(m => m.vendorId === s.vendorId);
                            return (
                              <tr key={s.id}>
                                <td>
                                  <div>
                                    <p className="font-semibold">{s.vendorName}</p>
                                    <p className="text-[10px] text-onyx/50 font-mono">{s.vendorCode}</p>
                                  </div>
                                </td>
                                <td className="font-mono text-xs">{mapping?.erpLedgerName || "N/A"}</td>
                                <td className="text-right font-mono font-bold text-xs text-onyx/85">
                                  ₹{s.outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td suppressHydrationWarning className="text-xs">
                                  {new Date(s.asOf).toLocaleString()}
                                </td>
                                <td className="text-center">
                                  <button
                                    onClick={() => {
                                      setSelectedStatement(s);
                                      setIsStatementDetailOpen(true);
                                    }}
                                    className="px-2.5 py-1 bg-onyx text-cream-light text-[10px] font-bold rounded hover:bg-onyx-light cursor-pointer shadow-sm"
                                  >
                                    View Bills
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Creditor Bills Details Modal */}
      {isStatementDetailOpen && selectedStatement && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-cream max-w-2xl w-full max-h-[85vh] flex flex-col rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <div>
                <h3 className="font-heading text-base font-bold text-cream">Outstanding Bills: {selectedStatement.vendorName}</h3>
                <p className="text-[10px] text-cream-light/60 mt-0.5 font-mono">Tally Ledger Account Sync</p>
              </div>
              <button onClick={() => setIsStatementDetailOpen(false)} className="hover:text-saffron transition-colors cursor-pointer text-cream-light">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="flex justify-between items-center bg-cream-dark/20 p-3 rounded-lg text-xs">
                <div>
                  <span className="font-semibold text-onyx/50">As of Date:</span>
                  <p suppressHydrationWarning className="font-bold text-onyx mt-0.5">{new Date(selectedStatement.asOf).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-onyx/50">Total Payable:</span>
                  <p className="font-mono font-bold text-saffron-dark mt-0.5 text-sm">
                    ₹{selectedStatement.outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              <div className="border border-onyx/5 rounded-lg overflow-hidden bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-cream-dark/50 font-bold">
                    <tr>
                      <th className="p-3">Bill Ref / Invoice</th>
                      <th className="p-3">Bill Date</th>
                      <th className="p-3">Due Date</th>
                      <th className="p-3 text-right">Opening Amount</th>
                      <th className="p-3 text-right">Pending Payable</th>
                      <th className="p-3 text-center">Overdue Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStatement.bills.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-xs text-onyx/40">
                          No outstanding bills found. Mapped vendor ledger does not have bill-by-bill enabled or is fully settled.
                        </td>
                      </tr>
                    ) : (
                      selectedStatement.bills.map((b) => {
                        const isOverdue = b.overdueDays > 0;
                        return (
                          <tr key={b.id} className="border-t border-onyx/5 hover:bg-cream-dark/10">
                            <td className="p-3 font-mono font-bold text-onyx">{b.billRef}</td>
                            <td suppressHydrationWarning className="p-3 font-mono text-[11px]">{b.billDate || "-"}</td>
                            <td suppressHydrationWarning className="p-3 font-mono text-[11px]">{b.dueDate || "-"}</td>
                            <td className="p-3 text-right font-mono text-onyx/60">
                              ₹{b.openingAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-onyx">
                              ₹{b.pendingAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isOverdue ? "bg-red-50 text-red-700 animate-pulse" : "bg-green-50 text-green-700"
                              }`}>
                                {isOverdue ? `${b.overdueDays} Days` : "Current"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-onyx/10 flex items-center justify-end bg-cream-dark/10">
              <button
                onClick={() => setIsStatementDetailOpen(false)}
                className="px-4 py-2 bg-onyx text-cream-light font-bold rounded-lg text-xs hover:bg-onyx-light cursor-pointer shadow-sm"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
