import { BarChart3 } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  FilterChips,
  ListEmpty,
  ListSearch,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
} from '@/components/settings/mcp/McpListKit';
import McpUsageExport from '@/components/settings/mcp/McpUsageExport';
import type { McpUsage } from '@/app/(app)/settings/integrations/mcp/usage';
import type { McpUsageExportResult } from '@/app/(app)/settings/integrations/mcp/usage-actions';
import {
  USAGE_GROUPS,
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
};

export default function McpUsageSection({ usage, q, exportAction }: Props) {
  const { window: range, by } = usage;
  const link = (next: { window?: UsageWindow; by?: UsageGroup; q?: string | null }) =>
    mcpHref({
      tab: 'usage',
      window: (next.window ?? range) === '24h' ? null : (next.window ?? range),
      by: (next.by ?? by) === 'tool' ? null : (next.by ?? by),
      q: next.q === undefined ? q : next.q,
    });
  const incomplete = (WINDOW_DAYS.get(range) ?? 1) > usage.retentionDays;

  return (
    <SettingsSection
      title="Usage"
      description="Calls, failures and speed across every connection. Built from the request log, which keeps names of tools, assistants and people, never what was asked or returned."
      action={<McpUsageExport window={range} q={q} exportAction={exportAction} />}
    >
      <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <FilterChips
            label="Time window"
            selected={range}
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
          }}
          clearHref={link({ q: null })}
        />
      </div>

      {incomplete && (
        <p
          role="note"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
        >
          The request log is kept for {usage.retentionDays} days, so this window is incomplete. An
          administrator can keep it longer under Access policy.
        </p>
      )}

      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
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

      {usage.rows.length === 0 ? (
        <ListEmpty icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />} title="No calls">
          {q
            ? 'Nothing in this window matches that search.'
            : 'No assistant has called OpsKnight in this window yet.'}
        </ListEmpty>
      ) : (
        <ResponsiveTable
          caption={`MCP usage ${(GROUP_LABEL.get(by) ?? by).toLowerCase()}, ${(WINDOW_LABEL.get(range) ?? range).toLowerCase()}`}
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
      {usage.truncated && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the busiest {usage.rows.length}. Search to narrow the list, or export for
          everything.
        </p>
      )}
    </SettingsSection>
  );
}
