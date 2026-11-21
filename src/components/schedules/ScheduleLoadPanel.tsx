import type { ReactNode } from 'react';
import { Scale } from 'lucide-react';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { listInsightsForScope } from '@/lib/intelligence/ops-insights/view';
import { UNFAIR_ROTATION_RATIO } from '@/lib/oncall-load/insights';
import { loadScheduleLoad, type ScheduleLoadView } from '@/lib/oncall-load/store';
import { cn } from '@/lib/utils';
import HeatStrip from '@/components/analytics/HeatStrip';
import InsightsPanel from '@/components/intelligence/insights/InsightsPanel';
import { SectionError, StatGrid, StatTile } from '@/components/intelligence/overview/primitives';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';

const dayLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function hours(value: number): string {
  return value >= 48 ? `${Math.round(value / 24)}d` : `${Math.round(value)}h`;
}

function vsMean(ratio: number | null): string {
  return ratio === null ? '–' : `${ratio.toFixed(1)}×`;
}

/** The tab body, separate from loading so it can be rendered in tests with known numbers. */
export function ScheduleLoadBody({
  load,
  insights,
}: {
  load: ScheduleLoadView;
  insights: ReactNode;
}) {
  const maxDaily = Math.max(1, ...load.people.flatMap(person => person.daily.map(d => d.pages)));
  return (
    <div className="space-y-5">
      {insights}
      {load.rotation ? (
        <StatGrid label="Rotation load">
          <StatTile label="Pages" value={String(load.rotation.totalPages)} />
          <StatTile
            label="Mean pages per on-call week"
            value={
              load.rotation.meanPagesPerOnCallWeek === null
                ? '–'
                : load.rotation.meanPagesPerOnCallWeek.toFixed(1)
            }
          />
          <StatTile
            label="Fairness"
            value={
              load.rotation.fairnessIndex === null ? '–' : load.rotation.fairnessIndex.toFixed(2)
            }
            hint="1.00 is an even split per on-call week"
          />
        </StatGrid>
      ) : (
        <p className="text-sm text-muted-foreground">
          Rotation totals are hidden: with {load.rotationSize} people they would reveal someone
          else&apos;s numbers.
        </p>
      )}
      {load.people.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {load.rotationSize === 0
            ? `Nobody was on call here in the last ${load.windowDays} days.`
            : 'You can see your own load, and your team members’ if you lead their team.'}
        </p>
      ) : (
        <Table aria-label={`Load per person, last ${load.windowDays} days`}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Person</TableHead>
              <TableHead scope="col" className="text-right">
                Pages
              </TableHead>
              <TableHead scope="col" className="text-right">
                Night
              </TableHead>
              <TableHead scope="col" className="text-right">
                Weekend
              </TableHead>
              <TableHead scope="col" className="text-right">
                Interrupted
              </TableHead>
              <TableHead scope="col" className="text-right">
                Longest quiet
              </TableHead>
              <TableHead scope="col" className="text-right">
                On call
              </TableHead>
              <TableHead scope="col" className="text-right">
                vs mean
              </TableHead>
              <TableHead scope="col" className="min-w-[180px]">
                Pages per day
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {load.people.map(person => (
              <TableRow key={person.userId}>
                <TableCell className="font-medium">{person.name}</TableCell>
                <TableCell className="text-right tabular-nums">{person.pages}</TableCell>
                <TableCell className="text-right tabular-nums">{person.nightPages}</TableCell>
                <TableCell className="text-right tabular-nums">{person.weekendPages}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {hours(person.interruptedHours)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hours(person.longestQuietGapHours)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hours(person.onCallHours)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    (person.vsRotationMean ?? 0) > UNFAIR_ROTATION_RATIO &&
                      'font-semibold text-status-elevated-deep dark:text-status-elevated'
                  )}
                >
                  {vsMean(person.vsRotationMean)}
                </TableCell>
                <TableCell>
                  <HeatStrip
                    height={20}
                    maxValue={maxDaily}
                    label={`Pages per day for ${person.name}`}
                    data={person.daily.map(d => ({
                      key: d.day,
                      label: dayLabel.format(new Date(`${d.day}T00:00:00Z`)),
                      count: d.pages,
                    }))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * "Load & fairness" tab on the schedule page: an async server component behind its own Suspense boundary.
 * The page shows the tab only while the on-call insights switch is on and has already checked that the
 * viewer can read the schedule; per-person rows are narrowed to self, team lead and admin by the loader.
 */
export default async function ScheduleLoadPanel({
  actor,
  scheduleId,
  squireName,
}: {
  actor: AuthorizationActor;
  scheduleId: string;
  squireName?: string | null;
}) {
  let load: ScheduleLoadView | null;
  let insights: Awaited<ReturnType<typeof listInsightsForScope>>;
  try {
    [load, insights] = await Promise.all([
      loadScheduleLoad(actor, scheduleId),
      listInsightsForScope(actor, { type: 'SCHEDULE', id: scheduleId }),
    ]);
  } catch (error) {
    logger.warn('[Intelligence] Schedule load not shown', {
      scheduleId,
      error: error instanceof Error ? error.message : String(error),
    });
    return <SectionError message="Load and fairness could not be loaded. Try again shortly." />;
  }
  if (!load) return null;
  return (
    <Card
      className="overflow-hidden border-border/70 shadow-sm"
      aria-labelledby="schedule-load-title"
    >
      <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Scale className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <CardTitle id="schedule-load-title" className="text-sm font-semibold sm:text-base">
              Load &amp; fairness
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Pages and on-call time over the last {load.windowDays} days. Nights are 22:00–07:00 in
              each person&apos;s time zone.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        <ScheduleLoadBody
          load={load}
          insights={
            <InsightsPanel
              insights={insights}
              canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
              squireName={squireName}
              label="On-call insights for this schedule"
            />
          }
        />
      </CardContent>
    </Card>
  );
}
