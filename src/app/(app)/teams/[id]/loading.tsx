import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function TeamDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8 animate-pulse">
      {/* Breadcrumb Skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-12" />
        <span className="opacity-30">/</span>
        <Skeleton className="h-4 w-28" />
      </div>

      {/* Hero Banner Skeleton */}
      <div className="rounded-lg bg-primary/20 p-6 md:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <Skeleton className="h-12 w-12 rounded-xl bg-primary-foreground/20" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-28 bg-primary-foreground/20" />
              <Skeleton className="h-7 w-48 bg-primary-foreground/30" />
              <Skeleton className="h-4 w-64 bg-primary-foreground/20" />
            </div>
          </div>
          <Skeleton className="h-16 w-80 rounded-lg bg-primary-foreground/20" />
        </div>
      </div>

      {/* Tabs Bar Skeleton */}
      <div className="flex gap-2 border-b pb-2">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-8 w-24 rounded-lg" />
        ))}
      </div>

      {/* Tab Content Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1, 2].map(i => (
          <Card key={i} className="border-border/70">
            <CardHeader className="border-b bg-muted/20 px-4 py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-3/4" />
              <div className="pt-2 border-t flex justify-between">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/70">
        <CardHeader className="border-b bg-muted/20 px-4 py-3">
          <Skeleton className="h-4 w-36" />
        </CardHeader>
        <CardContent className="p-4 space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex justify-between items-center py-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
