import Link from 'next/link';
import { Bot, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  McpRegisterClientForm,
  McpRestoreClientButton,
} from '@/components/settings/mcp/McpClientForms';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpScopeSummary from '@/components/settings/mcp/McpScopeSummary';
import { getAssistantIcon } from '@/components/common/BrandLogos';
import {
  FilterChips,
  ListEmpty,
  ListSearch,
  Pagination,
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
  type PillTone,
} from '@/components/settings/mcp/McpListKit';
import { CLIENT_TYPE_LABEL } from '@/components/settings/mcp/sections/McpConnectionsSection';
import type { McpClientRow } from '@/app/(app)/settings/integrations/mcp/queries';
import type { McpClientFormResult } from '@/app/(app)/settings/integrations/mcp/actions';
import {
  MCP_PAGE_SIZE,
  mcpHref,
  type ClientStatus,
  type ClientType,
} from '@/app/(app)/settings/integrations/mcp/list-params';

const TYPE_TONE: Record<McpClientRow['type'], PillTone> = {
  automatic: 'info',
  metadata: 'violet',
  manual: 'neutral',
};

const CLIENT_BLOCK_HINT: Record<NonNullable<McpClientRow['blockedReason']>, string> = {
  mcp_disabled: 'MCP is turned off, so no assistant can connect.',
  client_untrusted:
    'The access policy no longer trusts this assistant: automatic connections are off, or its metadata host is not in the trusted list.',
};

const TYPE_HINT: Record<McpClientRow['type'], string> = {
  automatic: 'Registered itself with just the URL',
  metadata: 'Identified by an HTTPS metadata document',
  manual: 'Registered by an administrator',
};

export default function McpAssistantsSection({
  rows,
  counts,
  total,
  page,
  status,
  type,
  q,
  now,
  timeZone,
  scopeChoices,
  defaultScopes,
  describeScope,
  revokeAction,
  restoreAction,
  registerAction,
}: {
  rows: McpClientRow[];
  counts: Record<ClientStatus, number>;
  total: number;
  page: number;
  status: ClientStatus;
  type: ClientType;
  q: string;
  now: Date;
  timeZone: string;
  scopeChoices: string[];
  defaultScopes: string[];
  describeScope: (scope: string) => string;
  revokeAction: (form: FormData) => Promise<void>;
  restoreAction: (form: FormData) => Promise<McpClientFormResult>;
  registerAction: (form: FormData) => Promise<McpClientFormResult>;
}) {
  const statusParam = status === 'all' ? null : status;
  const typeParam = type === 'all' ? null : type;
  const base = { tab: 'assistants', status: statusParam, type: typeParam, q };
  const filtered = Boolean(q || typeParam || statusParam);

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Assistants"
        description="Assistant apps that may ask people for access, and the most each one may request. People still approve each connection themselves."
      >
        <div className="flex flex-col gap-3 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <FilterChips
              label="Filter assistants by status"
              selected={status}
              options={[
                {
                  value: 'all',
                  label: 'All',
                  count: counts.all,
                  href: mcpHref({ ...base, status: null }),
                },
                {
                  value: 'active',
                  label: 'Allowed',
                  count: counts.active,
                  href: mcpHref({ ...base, status: 'active' }),
                },
                {
                  value: 'revoked',
                  label: 'Revoked',
                  count: counts.revoked,
                  href: mcpHref({ ...base, status: 'revoked' }),
                },
              ]}
            />
            <FilterChips
              label="Filter assistants by type"
              selected={type}
              options={[
                { value: 'all', label: 'Any type', href: mcpHref({ ...base, type: null }) },
                {
                  value: 'automatic',
                  label: CLIENT_TYPE_LABEL.automatic,
                  href: mcpHref({ ...base, type: 'automatic' }),
                },
                {
                  value: 'metadata',
                  label: CLIENT_TYPE_LABEL.metadata,
                  href: mcpHref({ ...base, type: 'metadata' }),
                },
                {
                  value: 'manual',
                  label: CLIENT_TYPE_LABEL.manual,
                  href: mcpHref({ ...base, type: 'manual' }),
                },
              ]}
            />
          </div>
          <ListSearch
            id="mcp-assistants-search"
            label="Search assistants by name"
            placeholder="Search assistant name"
            value={q}
            keep={{ tab: 'assistants', status: statusParam, type: typeParam }}
            clearHref={mcpHref({ ...base, q: null })}
          />
        </div>
        <div className="-mx-4 border-t border-border md:-mx-6">
          {rows.length === 0 ? (
            filtered ? (
              <ListEmpty
                icon={<SearchX className="h-5 w-5" />}
                title="No assistants match"
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={mcpHref({ tab: 'assistants' })}>Clear filters</Link>
                  </Button>
                }
              >
                Try another name or type.
              </ListEmpty>
            ) : (
              <ListEmpty icon={<Bot className="h-5 w-5" />} title="No assistants yet">
                With automatic connections on, an assistant appears here the first time someone adds
                the OpsKnight URL to it. For clients that need a fixed OAuth identity, use manual
                registration below.
              </ListEmpty>
            )
          ) : (
            <ResponsiveTable
              caption="Registered assistants"
              columns={[
                { label: 'Assistant' },
                { label: 'Type' },
                { label: 'Scope ceiling' },
                { label: 'Connections' },
                { label: 'Last call' },
                { label: 'Registered' },
                { label: 'Status' },
                { label: 'Actions', srOnly: true, className: 'text-right' },
              ]}
            >
              {rows.map(row => (
                <ResponsiveRow key={row.id} muted={Boolean(row.revokedAt)}>
                  <ResponsiveCell label="Assistant" primary className="md:max-w-[20rem]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/40 shadow-2xs">
                        {getAssistantIcon(row.name, 'h-4 w-4', row.metadataHost)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{row.name}</p>
                        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <span className="shrink-0">ID</span>
                          <code
                            className="min-w-0 truncate font-mono text-[11px] text-foreground/80"
                            title={row.id}
                          >
                            {row.id}
                          </code>
                        </p>
                      </div>
                    </div>
                  </ResponsiveCell>
                  <ResponsiveCell label="Type">
                    <span title={TYPE_HINT[row.type]} className="inline-flex flex-col gap-0.5">
                      <StatusPill tone={TYPE_TONE[row.type]}>
                        {CLIENT_TYPE_LABEL[row.type]}
                      </StatusPill>
                      {row.metadataHost && (
                        <span className="text-[11px] text-muted-foreground">
                          {row.metadataHost}
                        </span>
                      )}
                    </span>
                  </ResponsiveCell>
                  <ResponsiveCell label="Scope ceiling">
                    <McpScopeSummary
                      context={row.name}
                      scopes={row.scopes.map(scope => ({ scope, label: describeScope(scope) }))}
                      usable={row.revokedAt ? undefined : row.effectiveScopes}
                    />
                    {row.restrictedCapabilities > 0 && (
                      <Link
                        href={mcpHref({ tab: 'capabilities' })}
                        className="mt-1 block text-xs font-medium text-primary underline-offset-2 hover:underline"
                        aria-label={`${row.name} has its own capability restrictions`}
                      >
                        Own restrictions ({row.restrictedCapabilities})
                      </Link>
                    )}
                  </ResponsiveCell>
                  <ResponsiveCell label="Connections">
                    {row.activeConnections > 0 ? (
                      <Link
                        href={mcpHref({ tab: 'connections', client: row.id })}
                        className="font-medium tabular-nums text-primary underline-offset-2 hover:underline"
                        aria-label={`${row.activeConnections} active connections for ${row.name}`}
                      >
                        {row.activeConnections} active
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">None active</span>
                    )}
                  </ResponsiveCell>
                  <ResponsiveCell label="Last call">
                    <RelativeTime
                      value={row.lastCallAt}
                      now={now}
                      timeZone={timeZone}
                      empty="No calls yet"
                    />
                  </ResponsiveCell>
                  <ResponsiveCell label="Registered">
                    <RelativeTime value={row.createdAt} now={now} timeZone={timeZone} />
                  </ResponsiveCell>
                  <ResponsiveCell label="Status">
                    {row.revokedAt ? (
                      <StatusPill tone="danger" dot>
                        Revoked
                      </StatusPill>
                    ) : row.blockedReason ? (
                      <span className="flex flex-col gap-0.5">
                        <StatusPill tone="warning" dot>
                          Blocked by policy
                        </StatusPill>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {CLIENT_BLOCK_HINT[row.blockedReason]}
                        </span>
                      </span>
                    ) : (
                      <StatusPill tone="success" dot>
                        Allowed
                      </StatusPill>
                    )}
                  </ResponsiveCell>
                  <ResponsiveCell label="Actions" primary align="end">
                    {row.revokedAt ? (
                      <McpRestoreClientButton action={restoreAction} id={row.id} name={row.name} />
                    ) : (
                      <McpConfirmAction
                        action={revokeAction}
                        fields={{ kind: 'client', id: row.id }}
                        label="Revoke"
                        accessibleLabel={`Revoke ${row.name}`}
                        title={`Revoke ${row.name}?`}
                        confirmLabel="Revoke assistant"
                        successMessage="Assistant revoked"
                        className="w-full md:w-auto"
                        description={
                          <>
                            <p>
                              This blocks the assistant and revokes{' '}
                              {row.activeConnections === 1
                                ? 'its 1 active connection'
                                : `all ${row.activeConnections} of its active connections`}
                              . It stops working on the next request.
                            </p>
                            <p>
                              You can allow it again later. People then sign in and approve again;
                              old connections stay revoked.
                            </p>
                          </>
                        }
                      />
                    )}
                  </ResponsiveCell>
                </ResponsiveRow>
              ))}
            </ResponsiveTable>
          )}
        </div>
        <div className="-mx-4 md:-mx-6">
          <Pagination
            label="Assistants pages"
            page={page}
            pageSize={MCP_PAGE_SIZE}
            total={total}
            href={n => mcpHref({ ...base, page: n })}
          />
        </div>
      </SettingsSection>

      <details className="group rounded-xl border border-border bg-card shadow-2xs">
        <summary className="cursor-pointer list-none rounded-xl px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-6 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-foreground">
                Manual client registration (advanced)
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Only for clients that need a preconfigured OAuth identity. Most assistants use
                automatic connections.
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </span>
        </summary>
        <McpRegisterClientForm
          action={registerAction}
          scopeChoices={scopeChoices}
          defaultScopes={defaultScopes}
        />
      </details>
    </div>
  );
}
