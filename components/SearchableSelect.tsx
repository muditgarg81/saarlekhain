import React, { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, X } from "lucide-react";

interface Option {
  id: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select Option",
  className = "",
  disabled = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.id === value);

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

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  const filteredOptions = options.filter((opt) =>
    (opt.label || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full text-xs p-2 bg-white border border-onyx/10 rounded-lg flex items-center justify-between transition-all duration-150 min-h-[34px] select-none ${
          disabled 
            ? "bg-cream-dark/20 cursor-not-allowed opacity-60" 
            : "cursor-pointer hover:border-onyx/20"
        }`}
      >
        <span className={selectedOption ? "text-onyx font-medium truncate" : "text-onyx/40 truncate"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2 text-onyx/40">
          {!disabled && value && (
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
      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-onyx/10 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100 max-h-72 flex flex-col">
          {/* Search Input */}
          <div className="p-2 border-b border-onyx/5 flex items-center bg-cream-dark/5 gap-1.5 shrink-0">
            <Search size={12} className="text-onyx/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type to search..."
              className="w-full bg-transparent border-0 outline-none text-xs text-onyx p-0 placeholder-onyx/30 focus:ring-0 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Options List */}
          <div className="overflow-y-auto py-1 max-h-56">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-onyx/40 text-center font-medium">
                No matches found
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => {
                    onChange(opt.id);
                    setIsOpen(false);
                  }}
                  className={`px-3 py-2 text-xs cursor-pointer flex flex-col transition-colors duration-100 ${
                    opt.id === value
                      ? "bg-saffron/10 font-bold text-onyx"
                      : "hover:bg-cream-dark/20 text-onyx/85"
                  }`}
                >
                  <span className="truncate font-medium">{opt.label}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
