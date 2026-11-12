import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { getAssistantIcon } from '@/components/common/BrandLogos';
import { McpRestoreClientButton } from '@/components/settings/mcp/McpClientForms';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpGrantList from '@/components/settings/mcp/McpGrantList';
import McpScopeSummary from '@/components/settings/mcp/McpScopeSummary';
import { outcomeMeta } from '@/components/settings/mcp/outcome-labels';
import {
  ListEmpty,
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
} from '@/components/settings/mcp/McpListKit';
import { CLIENT_TYPE_LABEL } from '@/components/settings/mcp/sections/McpConnectionsSection';
import { formatDateTime } from '@/lib/timezone';
import type { McpClientRow, McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';
import type { McpClientFormResult } from '@/app/(app)/settings/integrations/mcp/actions';
import type {
  McpActivityCall,
  McpConnectionActivity,
} from '@/app/(app)/settings/integrations/mcp/activity';
import type { McpUsage } from '@/app/(app)/settings/integrations/mcp/usage';
import { mcpHref } from '@/app/(app)/settings/integrations/mcp/list-params';

const REGISTRATION = {
  automatic: 'Registered itself with the server URL (dynamic client registration)',
  metadata: 'Identified by an HTTPS client metadata document',
  manual: 'Registered by an administrator',
} as const;

const WINDOW_LABEL = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };

export type McpAssistantUsageWindow = Pick<McpUsage, 'window' | 'totals' | 'rows'>;

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** An administrator's view of one assistant: identity, connections, usage and recent requests. */
export default function McpAssistantDetail({
  client,
  connections,
  connectionsTotal,
  usage,
  calls,
  now,
  timeZone,
  describeScope,
  revokeAction,
  restoreAction,
  activityAction,
}: {
  client: McpClientRow;
  connections: McpGrantRow[];
  /** All of its connections, which may be more than the list shows. */
  connectionsTotal: number;
  usage: McpAssistantUsageWindow[];
  calls: (McpActivityCall & { person: string | null })[];
  now: Date;
  timeZone: string;
  describeScope: (scope: string) => string;
  revokeAction: (form: FormData) => Promise<void>;
  restoreAction: (form: FormData) => Promise<McpClientFormResult>;
  activityAction: (input: {
    grantId: string;
    cursor?: { at: string; id: string };
  }) => Promise<McpConnectionActivity>;
}) {
  const busiest = usage.find(entry => entry.window === '30d') ?? usage.at(-1);
  return (
    <div className="space-y-6">
      <Link
        href={mcpHref({ tab: 'assistants' })}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All assistants
      </Link>

      <header className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-2xs sm:flex-row sm:items-start sm:justify-between md:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-muted/40">
            {getAssistantIcon(client.name, 'h-7 w-7', client.metadataHost)}
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="break-words font-display text-xl font-bold tracking-tight md:text-2xl">
              {client.name}
            </h1>
            <p className="flex flex-wrap items-center gap-1.5">
              {client.revokedAt ? (
                <StatusPill tone="danger" dot>
                  Revoked
                </StatusPill>
              ) : client.blockedReason ? (
                <StatusPill tone="warning" dot>
                  Blocked by policy
                </StatusPill>
              ) : (
                <StatusPill tone="success" dot>
                  Allowed
                </StatusPill>
              )}
              <StatusPill tone="neutral">{CLIENT_TYPE_LABEL[client.type]}</StatusPill>
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">{client.id}</p>
          </div>
        </div>
        <div className="shrink-0">
          {client.revokedAt ? (
            <McpRestoreClientButton action={restoreAction} id={client.id} name={client.name} />
          ) : (
            <McpConfirmAction
              action={revokeAction}
              fields={{ kind: 'client', id: client.id }}
              label="Revoke assistant"
              accessibleLabel={`Revoke ${client.name}`}
              title={`Revoke ${client.name}?`}
              confirmLabel="Revoke assistant"
              successMessage="Assistant revoked"
              className="min-h-11 w-full sm:w-auto"
              description={
                <>
                  <p>
                    This blocks the assistant and revokes{' '}
                    {client.activeConnections === 1
                      ? 'its 1 active connection'
                      : `all ${client.activeConnections} of its active connections`}
                    . It stops working on the next request.
                  </p>
                  <p>
                    You can allow it again later. People then sign in and approve again; old
                    connections stay revoked.
                  </p>
                </>
              }
            />
          )}
        </div>
      </header>

      <SettingsSection title="Identity" description="Who this assistant is and how it registered.">
        <dl className="grid gap-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact term="Registration">{REGISTRATION[client.type]}</Fact>
          <Fact term="Metadata document host">
            {client.metadataHost ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <code className="break-all font-mono text-xs">{client.metadataHost}</code>
                <StatusPill tone={client.trusted ? 'success' : 'warning'}>
                  {client.trusted ? 'Trusted' : 'Not trusted'}
                </StatusPill>
              </span>
            ) : (
              <span className="text-muted-foreground">None (not a metadata client)</span>
            )}
          </Fact>
          <Fact term="Created">
            <RelativeTime value={client.createdAt} now={now} timeZone={timeZone} />
          </Fact>
          <Fact term="First authorized">
            <RelativeTime
              value={client.firstAuthorizedAt}
              now={now}
              timeZone={timeZone}
              empty="Nobody has connected yet"
            />
          </Fact>
          <Fact term="Scope ceiling">
            <McpScopeSummary
              context={client.name}
              scopes={client.scopes.map(scope => ({ scope, label: describeScope(scope) }))}
              usable={client.revokedAt ? undefined : client.effectiveScopes}
            />
          </Fact>
          {client.redirectUris.length > 0 && (
            <Fact term="Redirect URIs">
              <ul className="space-y-0.5">
                {client.redirectUris.map(uri => (
                  <li key={uri} className="break-all font-mono text-xs">
                    {uri}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
        </dl>
      </SettingsSection>

      <SettingsSection
        title="Connections"
        description="People who approved this assistant, newest first."
        action={
          connectionsTotal > connections.length ? (
            <Link
              href={mcpHref({ tab: 'connections', client: client.id, status: 'all' })}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              All {connectionsTotal} connections
            </Link>
          ) : undefined
        }
      >
        <div className="-mx-4 md:-mx-6">
          {connections.length === 0 ? (
            <ListEmpty
              icon={<Users className="h-5 w-5" aria-hidden="true" />}
              title="No connections"
            >
              Nobody has connected this assistant yet.
            </ListEmpty>
          ) : (
            <McpGrantList
              rows={connections}
              show="person"
              caption={`Connections to ${client.name}`}
              now={now}
              timeZone={timeZone}
              describeScope={describeScope}
              revokeAction={revokeAction}
              activityAction={activityAction}
            />
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Usage"
        description="Calls from this assistant, across every connection, from the request log."
      >
        <div className="-mx-4 md:-mx-6">
          <ResponsiveTable
            caption={`Usage of ${client.name}`}
            columns={[
              { label: 'Window' },
              { label: 'Calls', className: 'text-right' },
              { label: 'Failed', className: 'text-right' },
              { label: 'Slowest 5%', className: 'text-right' },
            ]}
          >
            {usage.map(entry => (
              <ResponsiveRow key={entry.window}>
                <ResponsiveCell label="Window" primary>
                  {WINDOW_LABEL[entry.window]}
                </ResponsiveCell>
                <ResponsiveCell label="Calls" align="end">
                  <span className="tabular-nums">{entry.totals.calls.toLocaleString()}</span>
                </ResponsiveCell>
                <ResponsiveCell label="Failed" align="end">
                  <span className="tabular-nums">{entry.totals.failed.toLocaleString()}</span>
                </ResponsiveCell>
                <ResponsiveCell label="Slowest 5%" align="end">
                  <span className="tabular-nums">
                    {entry.totals.p95Ms === null
                      ? '—'
                      : `${entry.totals.p95Ms.toLocaleString()} ms`}
                  </span>
                </ResponsiveCell>
              </ResponsiveRow>
            ))}
          </ResponsiveTable>
        </div>
        {busiest && busiest.rows.length > 0 && (
          <div className="space-y-2 py-4">
            <h4 className="font-display text-sm font-semibold">Most used tools, last 30 days</h4>
            <ul className="flex flex-wrap gap-1.5">
              {busiest.rows.slice(0, 8).map(row => (
                <li key={row.key ?? 'none'}>
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs">
                    <code className="break-all font-mono">{row.label}</code>
                    <span className="tabular-nums text-muted-foreground">
                      {row.calls.toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Recent activity"
        description="The latest requests from this assistant. Arguments and results are never logged."
      >
        {calls.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No requests recorded yet.</p>
        ) : (
          <ol aria-label="Recent requests" className="divide-y divide-border">
            {calls.map(call => {
              const meta = outcomeMeta(call.outcome);
              return (
                <li
                  key={call.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="min-w-0 space-y-0.5">
                    <code className="block break-all font-mono text-xs text-foreground">
                      {call.tool === 'none' ? 'Discovery' : call.tool}
                    </code>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(new Date(call.at), timeZone)}
                      {call.person ? ` · ${call.person}` : ''} · {call.durationMs} ms
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    {call.errorCode && (
                      <code className="break-all font-mono text-[11px] text-muted-foreground">
                        {call.errorCode}
                      </code>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </SettingsSection>
    </div>
  );
}
