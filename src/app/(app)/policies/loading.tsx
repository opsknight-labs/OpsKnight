import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function PoliciesLoading() {
  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6 animate-pulse">
      {/* Centralized Hero Banner Skeleton */}
      <div className="rounded-2xl bg-primary/20 p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-36 bg-primary-foreground/20 rounded-full" />
            <Skeleton className="h-8 w-64 bg-primary-foreground/30 rounded-lg" />
            <Skeleton className="h-4 w-80 sm:w-96 bg-primary-foreground/20 rounded" />
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5 w-full lg:w-auto">
            <Skeleton className="h-16 w-24 sm:w-28 rounded-xl bg-primary-foreground/20" />
            <Skeleton className="h-16 w-24 sm:w-28 rounded-xl bg-primary-foreground/20" />
            <Skeleton className="h-16 w-24 sm:w-28 rounded-xl bg-primary-foreground/20" />
          </div>
        </div>
      </div>

      {/* Dashed Expander Skeleton */}
      <div className="h-24 w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center gap-2 p-4">
        <Skeleton className="h-9 w-9 rounded-full bg-slate-200" />
        <Skeleton className="h-4 w-44 bg-slate-200" />
      </div>

      {/* Main Grid: Directory + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Directory Skeleton */}
        <div className="lg:col-span-3 space-y-4">
          {/* Search Toolbar */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-white">
            <Skeleton className="h-8 w-64 rounded-md" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>

          {/* Directory Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="border-slate-200/80 bg-white p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3.5 w-60" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>

                <div className="p-3 rounded-lg border border-slate-100 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <Skeleton className="h-5 w-20 rounded" />
                    <Skeleton className="h-5 w-24 rounded" />
                    <Skeleton className="h-5 w-20 rounded" />
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <Skeleton className="h-3 w-28" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-16 rounded" />
                    <Skeleton className="h-5 w-20 rounded" />
                  </div>
                </div>

                <div className="pt-2 border-t flex items-center justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Sidebar Skeleton */}
        <div className="space-y-4">
          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-36" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
