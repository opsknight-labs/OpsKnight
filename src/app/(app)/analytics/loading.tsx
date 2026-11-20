import { SectionSkeleton } from '@/components/analytics/SectionCard';
import { TableRowsSkeleton } from '@/components/patterns';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

// Same shape as page.tsx: header, filter card, 8 KPI tiles, then the section grid.
export default function AnalyticsLoading() {
  return (
    <div aria-busy="true" className="space-y-4 sm:space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl bg-primary/20 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-14 rounded-md" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-12">
        <SectionSkeleton title="incident volume" className="xl:col-span-12" />
        <SectionSkeleton title="time to acknowledge" className="xl:col-span-6" />
        <SectionSkeleton title="time to resolve" className="xl:col-span-6" />
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm xl:col-span-12">
          <div className="border-b px-4 py-3 sm:px-5">
            <Skeleton className="h-5 w-32" />
          </div>
          <TableRowsSkeleton rows={6} columns={6} label="Loading services" className="rounded-none border-0" />
        </div>
        <SectionSkeleton title="responder load" className="xl:col-span-7" />
        <SectionSkeleton title="incident timing" className="xl:col-span-5" />
      </div>
    </div>
  );
}
