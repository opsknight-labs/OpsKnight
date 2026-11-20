import 'server-only';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import type { AnalyticsContext, BreakdownRow, MetricUnit } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import DeltaBadge from './DeltaBadge';
import { describeDelta, formatMetric } from './format';
import MetricInfo from './MetricInfo';
import { SectionCard } from './SectionCard';
import SectionError from './SectionError';
import { isFiltered, load, NoIncidents } from './sections';

const DIMENSIONS = [
  { section: 'breakdownTeam', value: 'team', label: 'Team' },
  { section: 'breakdownPriority', value: 'priority', label: 'Priority' },
  { section: 'breakdownUrgency', value: 'urgency', label: 'Urgency' },
] as const;

const COLUMNS: Array<{ key: keyof BreakdownRow; label: string; unit: MetricUnit }> = [
  { key: 'mttaP50', label: 'MTTA', unit: 'duration' },
  { key: 'mttrP50', label: 'MTTR', unit: 'duration' },
  { key: 'mttrP90', label: 'MTTR p90', unit: 'duration' },
  { key: 'ackSla', label: 'Ack SLA', unit: 'percent' },
  { key: 'resolveSla', label: 'Resolve SLA', unit: 'percent' },
];

function Incidents({ row, compare }: { row: BreakdownRow; compare: boolean }) {
  return (
    <span className="inline-flex items-center justify-end gap-2 tabular-nums">
      {formatMetric(row.incidents, 'count')}
      <DeltaBadge
        delta={
          compare ? describeDelta(row.incidents, row.previousIncidents, 'count', 'down') : null
        }
        compact
      />
    </span>
  );
}

function BreakdownTable({
  rows,
  groupLabel,
  compare,
}: {
  rows: BreakdownRow[];
  groupLabel: string;
  compare: boolean;
}) {
  return (
    <div>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Reliability by {groupLabel.toLowerCase()} for the selected period
          </caption>
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                {groupLabel}
              </th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">
                Incidents
              </th>
              {COLUMNS.map(column => (
                <th
                  key={column.key}
                  scope="col"
                  className="whitespace-nowrap px-2 py-2 text-right font-medium"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} className="border-b last:border-0 hover:bg-muted/50">
                <th
                  scope="row"
                  className={cn(
                    'max-w-56 truncate py-2.5 pr-3 text-left font-medium',
                    row.key === null && 'text-muted-foreground'
                  )}
                >
                  {row.label}
                </th>
                <td className="whitespace-nowrap px-2 py-2.5 text-right">
                  <Incidents row={row} compare={compare} />
                </td>
                {COLUMNS.map(column => (
                  <td
                    key={column.key}
                    className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums"
                  >
                    {formatMetric(row[column.key] as number | null, column.unit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: a card list instead of a sideways-scrolling table */}
      <ul className="space-y-2 sm:hidden">
        {rows.map(row => (
          <li key={row.label} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{row.label}</span>
              <span className="shrink-0 text-sm">
                <Incidents row={row} compare={compare} />
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {COLUMNS.map(column => (
                <div key={column.key}>
                  <dt className="text-muted-foreground">{column.label}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatMetric(row[column.key] as number | null, column.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function BreakdownSection({ context }: { context: AnalyticsContext }) {
  const results = await Promise.all(DIMENSIONS.map(dimension => load(context, dimension.section)));
  return (
    <SectionCard
      id="analytics-breakdown"
      title="Breakdown"
      description="Compare teams, priorities and urgencies side by side"
      info={<MetricInfo metrics={['incidents', 'mttaP50', 'mttrP50', 'ackSla', 'resolveSla']} />}
      className="xl:col-span-12"
    >
      <Tabs defaultValue="team">
        <TabsList aria-label="Break down by">
          {DIMENSIONS.map(dimension => (
            <TabsTrigger key={dimension.value} value={dimension.value}>
              {dimension.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {DIMENSIONS.map((dimension, index) => {
          // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
          const result = results[index];
          return (
            <TabsContent key={dimension.value} value={dimension.value} className="mt-4">
              {'error' in result ? (
                <SectionError
                  title={`Breakdown by ${dimension.label.toLowerCase()}`}
                  errorCode={result.error}
                />
              ) : result.data.every(row => row.incidents === 0) ? (
                <NoIncidents filtered={isFiltered(context)} />
              ) : (
                <BreakdownTable
                  rows={result.data}
                  groupLabel={dimension.label}
                  compare={context.params.compare}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </SectionCard>
  );
}
