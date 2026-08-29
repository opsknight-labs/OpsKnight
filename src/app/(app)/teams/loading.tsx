import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function TeamsLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6 animate-pulse">
      {/* Header Banner Skeleton */}
      <div className="rounded-lg bg-primary/20 p-6 md:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <Skeleton className="h-12 w-12 rounded-xl bg-primary-foreground/20" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-32 bg-primary-foreground/20" />
              <Skeleton className="h-7 w-48 bg-primary-foreground/30" />
              <Skeleton className="h-4 w-72 bg-primary-foreground/20" />
            </div>
          </div>
          <Skeleton className="h-16 w-80 rounded-lg bg-primary-foreground/20" />
        </div>
      </div>

      {/* Dashed Create Button Skeleton */}
      <div className="h-24 w-full rounded-lg border-2 border-dashed border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-4 w-36" />
      </div>

      {/* Main Grid: Directory + Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Directory Skeleton */}
        <div className="xl:col-span-3 space-y-4">
          {/* Search Toolbar */}
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-8 w-64 rounded-md" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-16 rounded-lg" />
              <Skeleton className="h-7 w-24 rounded-lg" />
            </div>
          </div>

          {/* Directory Cards Grid */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="overflow-hidden border-border/70">
                <CardHeader className="border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="h-8 w-8 rounded-lg" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-40" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Skeleton className="h-3.5 w-20" />
                    <div className="flex gap-1.5">
                      <Skeleton className="h-5 w-16 rounded" />
                      <Skeleton className="h-5 w-16 rounded" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Sidebar Skeleton */}
        <aside className="space-y-4">
          <Card className="border-border/70">
            <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-2.5 items-start">
                  <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
