export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page Header Skeleton */}
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-onyx/10 rounded" />
          <div className="h-4 w-96 bg-onyx/5 rounded" />
        </div>
        <div className="h-10 w-36 bg-saffron/20 rounded-lg" />
      </div>

      {/* Stats Cards Skeleton (3 Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-6 bg-white rounded-xl border border-onyx/5 space-y-3 shadow-sm">
            <div className="h-4 w-24 bg-onyx/10 rounded" />
            <div className="h-8 w-16 bg-onyx/15 rounded" />
            <div className="h-3 w-36 bg-onyx/5 rounded" />
          </div>
        ))}
      </div>

      {/* Filter / Search Bar Skeleton */}
      <div className="flex gap-4">
        <div className="flex-1 h-10 bg-white rounded-lg border border-onyx/5" />
        <div className="h-10 w-36 bg-white rounded-lg border border-onyx/5" />
      </div>

      {/* Data Table Skeleton */}
      <div className="bg-white rounded-xl border border-onyx/5 overflow-hidden shadow-sm">
        {/* Table Header */}
        <div className="px-6 py-4 bg-cream-dark/50 border-b border-onyx/5 flex justify-between">
          <div className="h-4 w-20 bg-onyx/10 rounded" />
          <div className="h-4 w-32 bg-onyx/10 rounded" />
          <div className="h-4 w-24 bg-onyx/10 rounded" />
          <div className="h-4 w-16 bg-onyx/10 rounded" />
        </div>
        {/* Table Rows */}
        <div className="divide-y divide-onyx/5">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="px-6 py-4 flex justify-between items-center">
              <div className="h-4 w-24 bg-onyx/5 rounded" />
              <div className="h-4 w-40 bg-onyx/5 rounded" />
              <div className="h-4 w-20 bg-onyx/5 rounded" />
              <div className="h-6 w-16 bg-onyx/5 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
