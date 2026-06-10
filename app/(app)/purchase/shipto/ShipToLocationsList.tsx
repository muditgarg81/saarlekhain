"use client";

import { useState } from "react";
import { 
  createShipToLocation, 
  deleteShipToLocation 
} from "@/app/actions/shipto";
import { 
  Plus, 
  X, 
  Trash2, 
  MapPin, 
  Search, 
  AlertCircle 
} from "lucide-react";

interface LocationRecord {
  id: string;
  code: string;
  name: string;
  address: string;
  gstin: string | null;
  createdAt: Date;
}

interface ShipToLocationsListProps {
  locations: LocationRecord[];
  userRole: string;
}

export default function ShipToLocationsList({ locations: initialLocations, userRole }: ShipToLocationsListProps) {
  const [locations, setLocations] = useState<LocationRecord[]>(initialLocations);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form State
  const [newLoc, setNewLoc] = useState({
    code: "",
    name: "",
    address: "",
    gstin: ""
  });

  const canEdit = ["PURCHASE_MANAGER", "ADMIN", "OWNER"].includes(userRole);

  const filtered = locations.filter(loc => 
    loc.name.toLowerCase().includes(search.toLowerCase()) ||
    loc.code.toLowerCase().includes(search.toLowerCase()) ||
    loc.address.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLoc.code || !newLoc.name || !newLoc.address) {
      alert("Please fill in all required fields.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    const res = await createShipToLocation(newLoc);
    setLoading(false);

    if (res.success && res.location) {
      setLocations(prev => [...prev, res.location as any]);
      setIsOpen(false);
      setNewLoc({ code: "", name: "", address: "", gstin: "" });
    } else {
      setErrorMsg(res.error || "Failed to create ship-to location");
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Are you sure you want to delete location ${code}?`)) return;

    setLoading(true);
    const res = await deleteShipToLocation(id);
    setLoading(false);

    if (res.success) {
      setLocations(prev => prev.filter(loc => loc.id !== id));
    } else {
      alert(res.error || "Failed to delete location");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-onyx">Ship-To Locations Master</h2>
          <p className="text-xs text-onyx/50 mt-1">Configure delivery warehouse locations, gates, and addresses for Purchase Orders.</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 bg-saffron hover:bg-saffron-dark rounded-lg text-xs font-bold text-onyx shadow-md transition-all duration-150 cursor-pointer"
          >
            <Plus size={15} />
            <span>New Location</span>
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="glass-card p-4 rounded-xl border border-onyx/5">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Search by code, location name, address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>
      </div>

      {/* Grid of locations */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-onyx/10 text-onyx/40 text-xs font-medium">
            <MapPin size={36} className="mx-auto text-onyx/20 mb-3" />
            No ship-to locations configured.
          </div>
        ) : (
          filtered.map(loc => (
            <div key={loc.id} className="glass-card p-5 rounded-xl border border-onyx/5 flex flex-col justify-between hover:shadow-md transition-all duration-150">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold bg-saffron/20 border border-saffron/40 px-2 py-0.5 rounded text-saffron-dark">
                    {loc.code}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => handleDelete(loc.id, loc.code)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded border border-transparent hover:border-red-100 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-onyx text-sm">{loc.name}</h4>
                  <p className="text-xs text-onyx/60 mt-1.5 leading-relaxed">{loc.address}</p>
                </div>
              </div>
              <div className="pt-4 mt-4 border-t border-onyx/5 flex items-center justify-between text-[10px] font-mono text-onyx/40">
                <span>GSTIN: {loc.gstin || "N/A"}</span>
                <span>Added: {new Date(loc.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-cream max-w-md w-full rounded-xl shadow-2xl border border-onyx/10 overflow-hidden">
            <div className="px-6 py-4 bg-onyx text-cream-light border-b border-onyx-light flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">New Delivery Ship-To Location</h3>
              <button 
                onClick={() => {
                  setIsOpen(false);
                  setNewLoc({ code: "", name: "", address: "", gstin: "" });
                }} 
                className="hover:text-saffron cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded flex items-start space-x-2 text-red-800 font-semibold">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Code *</label>
                  <input
                    type="text"
                    value={newLoc.code}
                    onChange={(e) => setNewLoc(prev => ({ ...prev, code: e.target.value }))}
                    placeholder="e.g. WH-01"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron uppercase font-mono"
                    maxLength={10}
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Location Name *</label>
                  <input
                    type="text"
                    value={newLoc.name}
                    onChange={(e) => setNewLoc(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Main Plant Warehouse"
                    className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron font-bold text-onyx"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">Delivery Address *</label>
                <textarea
                  value={newLoc.address}
                  onChange={(e) => setNewLoc(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="e.g. Gate No. 2, Sector 12, Industrial Area, Noida - 201301"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron min-h-[80px]"
                  required
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase font-bold text-onyx/50 mb-1">GSTIN (Optional)</label>
                <input
                  type="text"
                  value={newLoc.gstin}
                  onChange={(e) => setNewLoc(prev => ({ ...prev, gstin: e.target.value }))}
                  placeholder="e.g. 09AAAAA0000A1Z5"
                  className="w-full text-xs p-2 bg-cream-dark/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron uppercase font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onyx/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setNewLoc({ code: "", name: "", address: "", gstin: "" });
                  }}
                  className="px-3 py-1.5 border border-onyx/10 rounded-lg text-xs font-semibold hover:bg-cream-dark/40 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-3.5 py-1.5 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-bold shadow cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Save Location"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
