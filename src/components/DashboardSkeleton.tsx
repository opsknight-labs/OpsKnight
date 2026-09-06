'use client';

export function DashboardSkeleton() {
  return (
    <main className="w-full max-w-7xl mx-auto pb-8 p-4 md:p-6">
      {/* Hero Section Skeleton */}
      <div className="bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 text-white p-8 rounded-xl mb-6 shadow-2xl flex justify-between items-center flex-wrap gap-6">
        <div className="flex-1">
          <div className="h-8 w-72 bg-white/20 rounded animate-pulse mb-2"></div>
          <div className="h-5 w-48 bg-white/15 rounded animate-pulse mb-4"></div>
          <div className="h-8 w-96 bg-white/15 rounded animate-pulse"></div>
        </div>
        <div className="flex flex-col gap-4 items-end">
          <div className="flex gap-3">
            <div className="h-10 w-24 bg-white/20 rounded-md animate-pulse"></div>
            <div className="h-10 w-28 bg-white/20 rounded-md animate-pulse"></div>
          </div>
          <div className="grid grid-cols-4 gap-4 w-full max-w-2xl">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-white/15 rounded-lg animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 md:gap-6">
        {/* Left Column */}
        <div className="flex flex-col gap-4 md:gap-6">
          {/* Filters Panel */}
          <div className="bg-white p-6 rounded-lg shadow-lg border border-border/50">
            <div className="h-6 w-36 bg-neutral-200 rounded animate-pulse mb-4"></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-neutral-100 rounded-lg animate-pulse"></div>
              ))}
            </div>
          </div>

          {/* Incidents Table */}
          <div className="bg-white rounded-lg shadow-lg border border-border/50 overflow-hidden">
            <div className="px-6 py-5 border-b border-border">
              <div className="h-5 w-28 bg-neutral-200 rounded animate-pulse"></div>
            </div>
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-16 bg-neutral-100 rounded-lg animate-pulse"></div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <aside className="flex flex-col gap-5">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="bg-white p-6 rounded-lg shadow-lg border border-border/50 animate-pulse"
            >
              <div className="h-5 w-32 bg-neutral-200 rounded mb-4 animate-pulse"></div>
              <div className="h-24 bg-neutral-100 rounded-lg animate-pulse"></div>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}
