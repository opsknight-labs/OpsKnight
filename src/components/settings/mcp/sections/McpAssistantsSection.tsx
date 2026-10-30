import Link from 'next/link';
import { Bot, RotateCcw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpScopeSummary from '@/components/settings/mcp/McpScopeSummary';
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
  restoreAction: (form: FormData) => Promise<void>;
  registerAction: (form: FormData) => Promise<void>;
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
                { label: 'Last used' },
                { label: 'Registered' },
                { label: 'Status' },
                { label: 'Actions', srOnly: true, className: 'text-right' },
              ]}
            >
              {rows.map(row => (
                <ResponsiveRow key={row.id} muted={Boolean(row.revokedAt)}>
                  <ResponsiveCell label="Assistant" primary className="md:max-w-[18rem]">
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
                    />
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
                  <ResponsiveCell label="Last used">
                    <RelativeTime
                      value={row.lastUsedAt}
                      now={now}
                      timeZone={timeZone}
                      empty="Not used yet"
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
                    ) : (
                      <StatusPill tone="success" dot>
                        Allowed
                      </StatusPill>
                    )}
                  </ResponsiveCell>
                  <ResponsiveCell label="Actions" primary align="end">
                    {row.revokedAt ? (
                      <form action={restoreAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          aria-label={`Allow ${row.name} again`}
                          className="h-8 w-full gap-1.5 px-2.5 text-xs md:w-auto"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Allow again
                        </Button>
                      </form>
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
        <form
          action={registerAction}
          className="space-y-5 border-t border-border px-4 py-5 md:px-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-client-name">Display name</Label>
              <Input id="mcp-client-name" name="name" required maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-client-redirect">Exact redirect URI</Label>
              <Input
                id="mcp-client-redirect"
                name="redirectUri"
                type="url"
                required
                placeholder="http://127.0.0.1:8765/callback"
              />
              <p className="text-xs text-muted-foreground">
                HTTPS, or http on 127.0.0.1, localhost or [::1].
              </p>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Allowed scopes</legend>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {scopeChoices.map(scope => (
                <label key={scope} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope}
                    defaultChecked={defaultScopes.includes(scope)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>{describeScope(scope)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              Register client
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}
