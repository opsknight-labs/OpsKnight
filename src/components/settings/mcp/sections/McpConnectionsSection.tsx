import Link from 'next/link';
import { Plug, SearchX, Unplug, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpScopeSummary from '@/components/settings/mcp/McpScopeSummary';
import AssistantFilterSelect from '@/components/settings/mcp/AssistantFilterSelect';
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
} from '@/components/settings/mcp/McpListKit';
import type { McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';
import {
  MCP_PAGE_SIZE,
  mcpHref,
  type GrantStatus,
} from '@/app/(app)/settings/integrations/mcp/list-params';

export const CLIENT_TYPE_LABEL = {
  automatic: 'Automatic',
  metadata: 'Metadata document',
  manual: 'Manual',
} as const;

const STATUS_LABEL = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  all: 'All',
} as const satisfies Record<GrantStatus, string>;

export function personLabel(person: { id: string; name: string | null; email: string | null }) {
  return person.name ?? person.email ?? 'Unknown user';
}

export default function McpConnectionsSection({
  isAdmin,
  rows,
  counts,
  total,
  page,
  status,
  q,
  client,
  availableClients = [],
  now,
  timeZone,
  describeScope,
  revokeAction,
  revokeAllAction,
}: {
  isAdmin: boolean;
  rows: McpGrantRow[];
  counts: Record<GrantStatus, number>;
  total: number;
  page: number;
  status: GrantStatus;
  q: string;
  client: { id: string; name: string } | null;
  availableClients?: { id: string; name: string }[];
  now: Date;
  timeZone: string;
  describeScope: (scope: string) => string;
  revokeAction: (form: FormData) => Promise<void>;
  revokeAllAction: (form: FormData) => Promise<void>;
}) {
  const base = { tab: 'connections', status, q, client: client?.id ?? null };
  const filtered = Boolean(q || client);
  const columns = [
    ...(isAdmin ? [{ label: 'Person' }] : []),
    { label: 'Assistant' },
    { label: 'Scopes' },
    { label: 'Connected' },
    { label: 'Last used' },
    { label: status === 'revoked' ? 'Revoked' : 'Expires' },
    { label: 'Status' },
    { label: 'Actions', srOnly: true, className: 'text-right' },
  ];

  return (
    <div className="space-y-6">
      <SettingsSection
        title={isAdmin ? 'Connections' : 'Your connections'}
        description={
          isAdmin
            ? "Each connection is one person's consent for one assistant. Revoking takes effect on the assistant's next request."
            : 'Assistants you have approved. Revoking takes effect on the next request.'
        }
      >
        <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
          <FilterChips
            label="Filter connections by status"
            selected={status}
            options={[
              {
                value: 'active',
                label: 'Active',
                count: counts.active,
                href: mcpHref({ ...base, status: null }),
              },
              {
                value: 'expired',
                label: 'Expired',
                count: counts.expired,
                href: mcpHref({ ...base, status: 'expired' }),
              },
              {
                value: 'revoked',
                label: 'Revoked',
                count: counts.revoked,
                href: mcpHref({ ...base, status: 'revoked' }),
              },
              {
                value: 'all',
                label: 'All',
                count: counts.all,
                href: mcpHref({ ...base, status: 'all' }),
              },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && availableClients.length > 0 && (
              <AssistantFilterSelect
                clients={availableClients}
                selectedClientId={client?.id ?? null}
                status={status}
                q={q}
              />
            )}
            <ListSearch
              id="mcp-connections-search"
              label={isAdmin ? 'Search by person or assistant' : 'Search by assistant'}
              placeholder={isAdmin ? 'Search person or assistant' : 'Search assistant'}
              value={q}
              keep={{
                tab: 'connections',
                status: status === 'active' ? null : status,
                client: client?.id,
              }}
              clearHref={mcpHref({ ...base, q: null, status: status === 'active' ? null : status })}
            />
          </div>
        </div>
        {client && (
          <div className="flex flex-wrap items-center gap-2 pb-4 text-xs text-muted-foreground">
            <span>Filtered by assistant:</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 py-1 pl-2.5 pr-1.5 font-medium text-foreground">
              {getAssistantIcon(client.name, 'h-3.5 w-3.5')}
              {client.name}
              <Link
                href={mcpHref({
                  ...base,
                  client: null,
                  status: status === 'active' ? null : status,
                })}
                aria-label={`Remove assistant filter ${client.name}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </span>
          </div>
        )}
        <div className="-mx-4 border-t border-border md:-mx-6">
          {rows.length === 0 ? (
            filtered || status !== 'active' ? (
              <ListEmpty
                icon={<SearchX className="h-5 w-5" />}
                title={`No ${status === 'all' ? '' : `${status} `}connections match`}
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={mcpHref({ tab: 'connections' })}>Show active connections</Link>
                  </Button>
                }
              >
                {filtered
                  ? 'Try another name, email or assistant, or clear the filters.'
                  : status === 'expired'
                    ? 'Connections expire after the inactivity period in Access policy. None have expired.'
                    : status === 'revoked'
                      ? 'Nobody has revoked a connection yet.'
                      : 'Nothing here yet.'}
              </ListEmpty>
            ) : (
              <ListEmpty
                icon={<Unplug className="h-5 w-5" />}
                title={isAdmin ? 'No one is connected yet' : 'You have not connected an assistant'}
                action={
                  <Button asChild size="sm" className="gap-1.5">
                    <Link href={mcpHref({ tab: 'connect' })}>
                      <Plug className="h-4 w-4" aria-hidden="true" />
                      Connect an assistant
                    </Link>
                  </Button>
                }
              >
                {isAdmin
                  ? 'When someone adds the OpsKnight URL to their assistant and approves access, the connection appears here.'
                  : 'Add the OpsKnight URL to Claude, ChatGPT, Cursor or VS Code and approve access. It will appear here.'}
              </ListEmpty>
            )
          ) : (
            <ResponsiveTable
              caption={isAdmin ? 'Assistant connections' : 'Your assistant connections'}
              columns={columns}
            >
              {rows.map(row => {
                const who = personLabel(row.user);
                const context = isAdmin ? `${row.client.name} for ${who}` : row.client.name;
                return (
                  <ResponsiveRow key={row.id} muted={row.status !== 'active'}>
                    {isAdmin && (
                      <ResponsiveCell label="Person" primary>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                            {(who.charAt(0) || 'U').toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{who}</p>
                            {row.user.name && row.user.email && (
                              <p className="truncate text-xs text-muted-foreground">
                                {row.user.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </ResponsiveCell>
                    )}
                    <ResponsiveCell label="Assistant" primary={!isAdmin}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/40 shadow-2xs">
                          {getAssistantIcon(row.client.name, 'h-4 w-4')}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{row.client.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CLIENT_TYPE_LABEL[row.client.type]}
                            {row.client.revoked && ' · assistant revoked'}
                          </p>
                        </div>
                      </div>
                    </ResponsiveCell>
                    <ResponsiveCell label="Scopes">
                      <McpScopeSummary
                        context={context}
                        scopes={row.scopes.map(scope => ({ scope, label: describeScope(scope) }))}
                      />
                    </ResponsiveCell>
                    <ResponsiveCell label="Connected">
                      <RelativeTime value={row.createdAt} now={now} timeZone={timeZone} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Last used">
                      <RelativeTime
                        value={row.lastUsedAt}
                        now={now}
                        timeZone={timeZone}
                        empty="Not used yet"
                      />
                    </ResponsiveCell>
                    <ResponsiveCell label={row.status === 'revoked' ? 'Revoked' : 'Expires'}>
                      <RelativeTime
                        value={row.status === 'revoked' ? row.revokedAt : row.expiresAt}
                        now={now}
                        timeZone={timeZone}
                      />
                    </ResponsiveCell>
                    <ResponsiveCell label="Status">
                      <StatusPill
                        tone={
                          row.status === 'active'
                            ? 'success'
                            : row.status === 'expired'
                              ? 'warning'
                              : 'neutral'
                        }
                        dot
                      >
                        {STATUS_LABEL[row.status]}
                      </StatusPill>
                    </ResponsiveCell>
                    <ResponsiveCell label="Actions" primary align="end">
                      {row.status === 'active' ? (
                        <McpConfirmAction
                          action={revokeAction}
                          fields={{ kind: 'grant', id: row.id }}
                          label="Revoke"
                          accessibleLabel={
                            isAdmin
                              ? `Revoke connection for ${row.client.name} and ${who}`
                              : `Revoke connection for ${row.client.name}`
                          }
                          title={`Revoke connection for ${row.client.name}?`}
                          confirmLabel="Revoke connection"
                          successMessage="Connection revoked"
                          className="w-full md:w-auto"
                          description={
                            isAdmin ? (
                              <p>
                                This revokes {who}&apos;s access for {row.client.name}. The
                                assistant stops working on its next request. They can connect again
                                any time.
                              </p>
                            ) : (
                              <p>
                                This revokes your access for {row.client.name}. The assistant stops
                                working on its next request. You can connect again any time.
                              </p>
                            )
                          }
                        />
                      ) : (
                        <span
                          className="text-xs text-muted-foreground/60 md:inline-block"
                          aria-hidden="true"
                        >
                          —
                        </span>
                      )}
                    </ResponsiveCell>
                  </ResponsiveRow>
                );
              })}
            </ResponsiveTable>
          )}
        </div>
        <div className="-mx-4 md:-mx-6">
          <Pagination
            label="Connections pages"
            page={page}
            pageSize={MCP_PAGE_SIZE}
            total={total}
            href={n => mcpHref({ ...base, page: n })}
          />
        </div>
      </SettingsSection>

      <section
        aria-labelledby="mcp-credentials-title"
        className="rounded-xl border border-border bg-card p-4 shadow-2xs md:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 id="mcp-credentials-title" className="text-sm font-semibold text-foreground">
              Credential security
            </h3>
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Tokens use PKCE with SHA-256 and are salted with scrypt in the database, matching user
              passwords. They cannot be retrieved after registration, only replaced or revoked.
            </p>
          </div>
          {isAdmin && counts.active > 0 && (
            <McpConfirmAction
              action={revokeAllAction}
              fields={{}}
              label="Revoke all active connections"
              accessibleLabel="Revoke all active MCP connections across OpsKnight"
              title="Revoke all active MCP connections?"
              confirmLabel="Revoke all connections"
              successMessage="All MCP connections revoked"
              description={
                <p>
                  This disconnects every assistant immediately. People will need to sign in and
                  approve again. Use this if a shared credential or laptop was compromised.
                </p>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
