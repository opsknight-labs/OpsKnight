import Link from 'next/link';
import { KeyRound, Plug, SearchX, Unplug, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
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
        {client && (
          <div className="flex flex-wrap items-center gap-2 pb-4 text-xs text-muted-foreground">
            <span>Assistant:</span>
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 py-0.5 pl-2 pr-1 font-medium text-foreground">
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
                <X className="h-3 w-3" aria-hidden="true" />
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
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{who}</p>
                          {row.user.name && row.user.email && (
                            <p className="truncate text-xs text-muted-foreground">
                              {row.user.email}
                            </p>
                          )}
                        </div>
                      </ResponsiveCell>
                    )}
                    <ResponsiveCell label="Assistant" primary={!isAdmin}>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{row.client.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {CLIENT_TYPE_LABEL[row.client.type]}
                          {row.client.revoked && ' · assistant revoked'}
                        </p>
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
                          accessibleLabel={`Revoke ${context}`}
                          title="Revoke this connection?"
                          confirmLabel="Revoke connection"
                          successMessage="Connection revoked"
                          className="w-full md:w-auto"
                          description={
                            <>
                              <p>
                                <span className="font-medium text-foreground">
                                  {row.client.name}
                                </span>{' '}
                                {isAdmin ? (
                                  <>
                                    loses access for{' '}
                                    <span className="font-medium text-foreground">{who}</span>
                                  </>
                                ) : (
                                  'loses access to your account'
                                )}{' '}
                                on its next request.
                              </p>
                              <p>
                                {isAdmin ? 'They' : 'You'} can connect again later by signing in and
                                approving.
                              </p>
                            </>
                          }
                        />
                      ) : (
                        <span className="sr-only">No actions</span>
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
            href={n => mcpHref({ ...base, status: status === 'active' ? null : status, page: n })}
          />
        </div>
      </SettingsSection>

      {isAdmin && (
        <p className="px-1 text-xs text-muted-foreground">
          Changes to MCP settings and connections are recorded in the{' '}
          <Link className="font-medium text-foreground underline underline-offset-2" href="/audit">
            audit log
          </Link>
          .
        </p>
      )}

      {isAdmin && (
        <form action={revokeAllAction}>
          <SettingsSection
            title="Credential security"
            description="MCP tokens are stored only as hashes keyed from the application encryption key; there is no separate MCP secret to configure."
            className="border-destructive/30"
            footer={
              <div className="flex justify-end">
                <Button type="submit" variant="destructive" size="sm" className="gap-1.5">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  Revoke all MCP connections
                </Button>
              </div>
            }
          >
            <div className="space-y-3 py-4 text-sm">
              <p className="text-muted-foreground">
                Rotating the application encryption key also invalidates every MCP connection, so
                people reconnect their assistants. Use this to disconnect everyone immediately, for
                example after a suspected credential exposure.
              </p>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="confirm"
                  required
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span>I understand every user must reconnect their assistants.</span>
              </label>
            </div>
          </SettingsSection>
        </form>
      )}
    </div>
  );
}
