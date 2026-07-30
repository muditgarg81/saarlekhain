"use client";

export default function PrintActions() {
  return (
    <div className="no-print flex gap-3 p-4 justify-end max-w-3xl mx-auto">
      <button
        onClick={() => window.print()}
        className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 cursor-pointer"
      >
        🖨 Print / Save PDF
      </button>
      <button
        onClick={() => window.close()}
        className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-100 cursor-pointer"
      >
        Close
      </button>
    </div>
  );
}
