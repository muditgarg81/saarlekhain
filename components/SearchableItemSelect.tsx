import React, { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, X } from "lucide-react";

interface Item {
  id: string;
  code: string;
  name: string;
}

interface SearchableItemSelectProps {
  items: Item[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchableItemSelect({
  items,
  value,
  onChange,
  placeholder = "Select Item",
}: SearchableItemSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find((item) => item.id === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset search query when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  const filteredItems = items.filter((item) => {
    const query = searchQuery.toLowerCase();
    return (
      (item.code || "").toLowerCase().includes(query) ||
      (item.name || "").toLowerCase().includes(query)
    );
  });

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger Button */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg flex items-center justify-between cursor-pointer hover:border-onyx/20 transition-all duration-150 min-h-[34px] select-none bg-no-repeat"
      >
        <span className={selectedItem ? "text-onyx font-medium truncate" : "text-onyx/40 truncate"}>
          {selectedItem
            ? `[${selectedItem.code}] ${selectedItem.name}`
            : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2 text-onyx/40">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="hover:text-onyx/80 cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
          <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Dropdown Container */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-onyx/10 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100 max-h-72 flex flex-col">
          {/* Search Input */}
          <div className="p-2 border-b border-onyx/5 flex items-center bg-cream-dark/5 gap-1.5 shrink-0">
            <Search size={12} className="text-onyx/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items by name or code..."
              className="w-full bg-transparent border-0 outline-none text-xs text-onyx p-0 placeholder-onyx/30 focus:ring-0 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Items List */}
          <div className="overflow-y-auto py-1 max-h-56">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-2 text-xs text-onyx/40 text-center font-medium">
                No items found
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    onChange(item.id);
                    setIsOpen(false);
                  }}
                  className={`px-3 py-2 text-xs cursor-pointer flex flex-col transition-colors duration-100 ${
                    item.id === value
                      ? "bg-saffron/10 font-bold text-onyx"
                      : "hover:bg-cream-dark/20 text-onyx/85"
                  }`}
                >
                  <span className="font-mono text-[10px] text-saffron-dark font-bold">
                    [{item.code}]
                  </span>
                  <span className="truncate font-medium mt-0.5">
                    {item.name}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
