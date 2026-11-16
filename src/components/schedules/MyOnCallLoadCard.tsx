import { Moon } from 'lucide-react';
import { logger } from '@/lib/logger';
import { loadMyOnCallLoad, type MyLoadView } from '@/lib/oncall-load/store';
import HeatStrip from '@/components/analytics/HeatStrip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';

const dayLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** The card body, separate from loading so tests can render it with known numbers. */
export function MyOnCallLoadBody({ load }: { load: MyLoadView }) {
  if (load.onCallHours <= 0 && load.pages === 0) return null;
  const stats: Array<[string, string]> = [
    ['Pages', String(load.pages)],
    ['At night', String(load.nightPages)],
    ['Weekend', String(load.weekendPages)],
    [
      'Per on-call week',
      load.pagesPerOnCallWeek === null ? '–' : load.pagesPerOnCallWeek.toFixed(1),
    ],
  ];
  return (
    <Card
      className="overflow-hidden border-border/70 shadow-xs"
      aria-labelledby="my-oncall-load-title"
    >
      <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Moon className="h-3 w-3" aria-hidden="true" />
          </div>
          <CardTitle
            id="my-oncall-load-title"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            My on-call load
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {stats.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <HeatStrip
          height={18}
          maxValue={Math.max(1, ...load.daily.map(d => d.pages))}
          label="My pages per day"
          data={load.daily.map(d => ({
            key: d.day,
            label: dayLabel.format(new Date(`${d.day}T00:00:00Z`)),
            count: d.pages,
          }))}
        />
        <p className="text-xs text-muted-foreground">
          Last {load.windowDays} days, {Math.round(load.onCallHours)}h on call. Only you, your team
          lead and admins see these numbers.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The signed-in person's own load on /schedules and /m/schedules, behind a Suspense boundary. Quiet: renders
 * nothing without on-call time or pages, or when loading fails. Callers pass the signed-in user's id only.
 */
export default async function MyOnCallLoadCard({ userId }: { userId: string }) {
  const load = await loadMyOnCallLoad(userId).catch((error: unknown) => {
    logger.warn('[Intelligence] My on-call load not shown', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  return load ? <MyOnCallLoadBody load={load} /> : null;
}
