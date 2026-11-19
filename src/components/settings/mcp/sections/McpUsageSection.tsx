import { BarChart3 } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  FilterChips,
  ListEmpty,
  ListSearch,
  Pagination,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
} from '@/components/settings/mcp/McpListKit';
import McpUsageExport from '@/components/settings/mcp/McpUsageExport';
import McpUsageChart from '@/components/settings/mcp/McpUsageChart';
import { outcomeMeta } from '@/components/settings/mcp/outcome-labels';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { earliestUsageDay, usageDay } from '@/app/(app)/settings/integrations/mcp/usage-range';
import type { McpUsage } from '@/app/(app)/settings/integrations/mcp/usage';
import type { McpUsageExportResult } from '@/app/(app)/settings/integrations/mcp/usage-actions';
import {
  MCP_SETTINGS_PATH,
  USAGE_GROUPS,
  USAGE_PAGE_SIZE,
  USAGE_WINDOW_KEYS,
  mcpHref,
  type UsageGroup,
  type UsageWindow,
} from '@/app/(app)/settings/integrations/mcp/list-params';

const WINDOW_LABEL = new Map<UsageWindow, string>([
  ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
]);
const WINDOW_DAYS = new Map<UsageWindow, number>([
  ['24h', 1],
  ['7d', 7],
  ['30d', 30],
]);
const GROUP_LABEL = new Map<UsageGroup, string>([
  ['tool', 'By tool'],
  ['client', 'By assistant'],
  ['user', 'By person'],
]);
const GROUP_COLUMN = new Map<UsageGroup, string>([
  ['tool', 'Tool'],
  ['client', 'Assistant'],
  ['user', 'Person'],
]);

const percent = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.001 ? 2 : 1)}%`;

/** Failure share to a status tone: quiet below 2%, amber to 10%, red above. */
function errorTone(rate: number) {
  return rate >= 0.1 ? 'danger' : rate >= 0.02 ? 'warning' : 'success';
}

type Props = {
  usage: McpUsage;
  q: string;
  exportAction: (input: unknown) => Promise<McpUsageExportResult>;
  /** The dates as typed, so a refused range can be corrected in place. */
  requestedRange?: { from: string | null; to: string | null };
  now?: Date;
};

export default function McpUsageSection({
  usage,
  q,
  exportAction,
  requestedRange,
  now = new Date(),
}: Props) {
  const { window: range, by, range: custom } = usage;
  const link = (next: {
    window?: UsageWindow;
    by?: UsageGroup;
    q?: string | null;
    page?: number;
  }) =>
    mcpHref({
      page: next.page ?? 1,
      tab: 'usage',
      window: (next.window ?? range) === '24h' ? null : (next.window ?? range),
      by: (next.by ?? by) === 'tool' ? null : (next.by ?? by),
      q: next.q === undefined ? q : next.q,
      // Choosing a preset window leaves the custom range; every other link keeps it.
      from: next.window ? null : custom?.from,
      to: next.window ? null : custom?.to,
    });
  const incomplete = !custom && (WINDOW_DAYS.get(range) ?? 1) > usage.retentionDays;
  const periodLabel = custom
    ? `${custom.from} to ${custom.to} (UTC)`
    : (WINDOW_LABEL.get(range) ?? range);
  const fromValue = requestedRange?.from ?? custom?.from ?? '';
  const toValue = requestedRange?.to ?? custom?.to ?? '';
  const earliest = earliestUsageDay(usage.retentionDays, now);
  const today = usageDay(now);

  return (
    <SettingsSection
      title="Usage"
      description="Calls, failures and speed across every connection. Built from the request log, which keeps names of tools, assistants and people, never what was asked or returned."
      action={<McpUsageExport window={range} range={custom} q={q} exportAction={exportAction} />}
    >
      <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <FilterChips
            label="Time window"
            selected={custom ? 'custom' : range}
            options={USAGE_WINDOW_KEYS.map(value => ({
              value,
              label: WINDOW_LABEL.get(value) ?? value,
              href: link({ window: value }),
            }))}
          />
          <FilterChips
            label="Group usage by"
            selected={by}
            options={USAGE_GROUPS.map(value => ({
              value,
              label: GROUP_LABEL.get(value) ?? value,
              href: link({ by: value }),
            }))}
          />
        </div>
        <ListSearch
          id="usage-search"
          label="Search usage"
          placeholder="Tool, outcome, error code or request id"
          value={q}
          keep={{
            tab: 'usage',
            window: range === '24h' ? null : range,
            by: by === 'tool' ? null : by,
            from: custom?.from ?? null,
            to: custom?.to ?? null,
          }}
          clearHref={link({ q: null })}
        />
      </div>

      <form
        method="get"
        action={MCP_SETTINGS_PATH}
        aria-label="Custom date range"
        className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <input type="hidden" name="tab" value="usage" />
        {by !== 'tool' && <input type="hidden" name="by" value={by} />}
        {q && <input type="hidden" name="q" value={q} />}
        <div className="grid gap-1">
          <Label htmlFor="usage-from" className="text-xs">
            From (UTC)
          </Label>
          <Input
            id="usage-from"
            name="from"
            type="date"
            required
            min={earliest}
            max={today}
            defaultValue={fromValue}
            aria-invalid={usage.rangeError ? true : undefined}
            aria-describedby={usage.rangeError ? 'usage-range-error' : 'usage-range-hint'}
            className="h-11 sm:h-9 sm:w-44"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="usage-to" className="text-xs">
            To (UTC, included)
          </Label>
          <Input
            id="usage-to"
            name="to"
            type="date"
            required
            min={earliest}
            defaultValue={toValue}
            aria-invalid={usage.rangeError ? true : undefined}
            aria-describedby={usage.rangeError ? 'usage-range-error' : 'usage-range-hint'}
            className="h-11 sm:h-9 sm:w-44"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="h-11 sm:h-9">
            Show range
          </Button>
          {custom && (
            <Button asChild variant="ghost" size="sm" className="h-11 sm:h-9">
              <a href={link({ window: range })}>Clear range</a>
            </Button>
          )}
        </div>
        {usage.rangeError ? (
          <p id="usage-range-error" role="alert" className="text-xs text-destructive sm:basis-full">
            {usage.rangeError} Showing {(WINDOW_LABEL.get(range) ?? range).toLowerCase()} instead.
          </p>
        ) : (
          <p id="usage-range-hint" className="text-xs text-muted-foreground sm:basis-full">
            Up to 365 days, starting no earlier than {earliest} (the request log is kept for{' '}
            {usage.retentionDays} days).
          </p>
        )}
      </form>

      {incomplete && (
        <p
          role="note"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
        >
          The request log is kept for {usage.retentionDays} days, so this window is incomplete. An
          administrator can keep it longer under Access policy.
        </p>
      )}

      <dl className="mb-4 grid grid-cols-1 gap-3 text-sm min-[420px]:grid-cols-3">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Calls
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {usage.totals.calls.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Failed
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {usage.totals.failed.toLocaleString()}{' '}
            <span className="text-xs font-normal text-muted-foreground">
              ({percent(usage.totals.errorRate)})
            </span>
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Slowest 5% of calls
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {usage.totals.p95Ms === null ? '—' : `${usage.totals.p95Ms.toLocaleString()} ms`}
          </dd>
        </div>
      </dl>

      {usage.totals.calls > 0 && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <McpUsageChart series={usage.series} bucket={usage.bucket} />
          <section aria-labelledby="mcp-usage-errors-title" className="min-w-0 space-y-2">
            <h3 id="mcp-usage-errors-title" className="font-display text-sm font-semibold">
              Failures by error code
            </h3>
            {usage.errorCodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed calls in this period.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {usage.errorCodes.map(entry => {
                  const meta = outcomeMeta(entry.outcome);
                  return (
                    <li
                      key={`${entry.code ?? ''}|${entry.outcome}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <code className="break-all font-mono text-xs text-foreground">
                          {entry.code ?? 'No error code'}
                        </code>
                        <span>
                          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {entry.count.toLocaleString()}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {usage.rows.length === 0 ? (
        <ListEmpty icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />} title="No calls">
          {q
            ? 'Nothing in this window matches that search.'
            : 'No assistant has called OpsKnight in this window yet.'}
        </ListEmpty>
      ) : (
        <ResponsiveTable
          caption={`MCP usage ${(GROUP_LABEL.get(by) ?? by).toLowerCase()}, ${custom ? periodLabel : periodLabel.toLowerCase()}`}
          columns={[
            { label: GROUP_COLUMN.get(by) ?? by },
            { label: 'Calls', className: 'text-right' },
            { label: 'Failed', className: 'text-right' },
            { label: 'Failure rate' },
            { label: 'Slowest 5%', className: 'text-right' },
          ]}
        >
          {usage.rows.map(row => (
            <ResponsiveRow key={row.key ?? 'none'} muted={row.key === null}>
              <ResponsiveCell label={GROUP_COLUMN.get(by) ?? by} primary>
                {by === 'tool' ? (
                  <code className="font-mono text-xs">{row.label}</code>
                ) : (
                  <span className="truncate font-medium text-foreground">{row.label}</span>
                )}
              </ResponsiveCell>
              <ResponsiveCell label="Calls" align="end">
                <span className="tabular-nums">{row.calls.toLocaleString()}</span>
              </ResponsiveCell>
              <ResponsiveCell label="Failed" align="end">
                <span className="tabular-nums">{row.failed.toLocaleString()}</span>
              </ResponsiveCell>
              <ResponsiveCell label="Failure rate">
                <StatusPill tone={errorTone(row.errorRate)}>{percent(row.errorRate)}</StatusPill>
              </ResponsiveCell>
              <ResponsiveCell label="Slowest 5%" align="end">
                <span className="tabular-nums">
                  {row.p95Ms === null ? '—' : `${row.p95Ms.toLocaleString()} ms`}
                </span>
              </ResponsiveCell>
            </ResponsiveRow>
          ))}
        </ResponsiveTable>
      )}
      <div className="-mx-4 mt-4 md:-mx-6">
        <Pagination
          label="Usage pages"
          page={usage.page}
          pageSize={USAGE_PAGE_SIZE}
          total={usage.groupCount}
          href={n => link({ page: n })}
        />
      </div>
    </SettingsSection>
  );
}
