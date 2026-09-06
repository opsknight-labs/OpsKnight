import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { Card, CardContent } from '@/components/ui/shadcn/card';

export default function UserDetailLoading() {
  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Back Link Skeleton */}
      <Skeleton className="h-4 w-36 rounded-md" />

      {/* Hero Profile Banner Skeleton */}
      <div className="rounded-2xl p-6 sm:p-7 bg-slate-100/80 border border-slate-200/60 shadow-xs">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-48 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-32 rounded-md" />
                <Skeleton className="h-4 w-28 rounded-md" />
                <Skeleton className="h-4 w-24 rounded-md" />
              </div>
            </div>
          </div>
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>

      {/* Tabs Skeleton */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* Tab Content Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-slate-200/80 bg-white">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-5 w-32 rounded-md" />
            <div className="space-y-3 pt-2">
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-5 w-32 rounded-md" />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
