import type { ReactNode } from 'react';
import Link from 'next/link';
import { KeyRound, Plug, SearchX, Unplug, X } from 'lucide-react';
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
import type {
  McpConnectionBlock,
  McpGrantRow,
} from '@/app/(app)/settings/integrations/mcp/queries';
import { MCP_CREDENTIAL_SECURITY_COPY } from '@/components/settings/mcp/credential-security';
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

/** Why a connection that has not ended still gives no access: shown in place of "Active". */
export const BLOCK_LABEL = {
  mcp_disabled: { label: 'Blocked by policy', hint: 'MCP is turned off for OpsKnight.' },
  client_untrusted: {
    label: 'Blocked by policy',
    hint: 'The access policy no longer trusts this assistant (automatic connections off, or its host is not trusted).',
  },
  client_revoked: { label: 'No longer allowed', hint: 'An administrator revoked this assistant.' },
  user_inactive: { label: 'No longer allowed', hint: 'This person is not an active user.' },
  access_changed: {
    label: 'No longer allowed',
    hint: 'A security change (password, sign-out everywhere or a change of administrator role) ended this connection. Sign in again from the assistant.',
  },
  admin_scope: {
    label: 'No longer allowed',
    hint: 'The connection carries a scope MCP never honours.',
  },
  ended: {
    label: 'No longer allowed',
    hint: 'The connection was issued for another server address.',
  },
} as const satisfies Record<McpConnectionBlock, { label: string; hint: string }>;

const PAT_BLOCK_LABEL = {
  label: 'Blocked by policy',
  hint: 'Personal access tokens are turned off in the access policy.',
} as const;

/** Why a blocked connection gives no access, worded for its kind. */
export function blockCopy(row: Pick<McpGrantRow, 'kind' | 'blockedReason'>) {
  if (row.kind === 'pat' && row.blockedReason === 'client_untrusted') return PAT_BLOCK_LABEL;
  return BLOCK_LABEL[row.blockedReason ?? 'ended'];
}

/** The connection's name: a personal token's label, or its assistant. */
export function connectionName(row: Pick<McpGrantRow, 'kind' | 'label' | 'client'>) {
  return row.kind === 'pat' ? (row.label ?? 'Personal access token') : row.client.name;
}

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
  availableClientsTruncated = false,
  revocable = 0,
  now,
  timeZone,
  describeScope,
  revokeAction,
  revokeAllAction,
  personalTokens,
}: {
  isAdmin: boolean;
  rows: McpGrantRow[];
  counts: Record<GrantStatus, number>;
  total: number;
  page: number;
  status: GrantStatus;
  q: string;
  client: { id: string; name: string; metadataHost?: string | null } | null;
  availableClients?: { id: string; name: string; metadataHost?: string | null }[];
  /** More assistants exist than the filter lists. */
  availableClientsTruncated?: boolean;
  /** Every connection "Revoke all" would revoke, ignoring the current filter. */
  revocable?: number;
  now: Date;
  timeZone: string;
  describeScope: (scope: string) => string;
  revokeAction: (form: FormData) => Promise<void>;
  revokeAllAction: (form: FormData) => Promise<void>;
  /** The personal access token panel, when the policy allows personal tokens. */
  personalTokens?: ReactNode;
}) {
  const base = { tab: 'connections', status, q, client: client?.id ?? null };
  const filtered = Boolean(q || client);
  const columns = [
    ...(isAdmin ? [{ label: 'Person' }] : []),
    { label: 'Assistant' },
    { label: 'Scopes' },
    { label: 'Connected' },
    { label: 'Last call' },
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
            ? "Each connection is one person's consent for one assistant, or a personal access token. Revoking takes effect on the next request."
            : 'Assistants you have approved and your personal access tokens. Revoking takes effect on the next request.'
        }
      >
        {personalTokens}
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
                truncated={availableClientsTruncated}
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
              {getAssistantIcon(client.name, 'h-3.5 w-3.5', client.metadataHost)}
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
                const name = connectionName(row);
                const context = isAdmin ? `${name} for ${who}` : name;
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
                          {row.kind === 'pat' ? (
                            <KeyRound
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          ) : (
                            getAssistantIcon(row.client.name, 'h-4 w-4', row.client.metadataHost)
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{name}</p>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <StatusPill tone={row.kind === 'pat' ? 'warning' : 'neutral'}>
                              {row.kind === 'pat' ? 'Personal token' : 'OAuth'}
                            </StatusPill>
                            {row.kind === 'oauth' && CLIENT_TYPE_LABEL[row.client.type]}
                            {row.kind === 'oauth' && row.client.revoked && ' · assistant revoked'}
                          </p>
                        </div>
                      </div>
                    </ResponsiveCell>
                    <ResponsiveCell label="Scopes">
                      <McpScopeSummary
                        context={context}
                        scopes={row.scopes.map(scope => ({ scope, label: describeScope(scope) }))}
                        usable={row.status === 'active' ? row.effectiveScopes : undefined}
                      />
                    </ResponsiveCell>
                    <ResponsiveCell label="Connected">
                      <RelativeTime value={row.createdAt} now={now} timeZone={timeZone} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Last call">
                      <span className="inline-flex flex-col gap-0.5">
                        <RelativeTime
                          value={row.lastCallAt}
                          now={now}
                          timeZone={timeZone}
                          empty="No calls yet"
                        />
                        {row.lastCallAt && row.lastTool && (
                          <code className="font-mono text-[11px] text-muted-foreground">
                            {row.lastTool}
                          </code>
                        )}
                      </span>
                    </ResponsiveCell>
                    <ResponsiveCell label={row.status === 'revoked' ? 'Revoked' : 'Expires'}>
                      <RelativeTime
                        value={row.status === 'revoked' ? row.revokedAt : row.expiresAt}
                        now={now}
                        timeZone={timeZone}
                      />
                    </ResponsiveCell>
                    <ResponsiveCell label="Status">
                      {row.blockedReason ? (
                        <span title={blockCopy(row).hint}>
                          <StatusPill tone="danger" dot>
                            {blockCopy(row).label}
                          </StatusPill>
                          <span className="sr-only">. {blockCopy(row).hint}</span>
                        </span>
                      ) : (
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
                      )}
                    </ResponsiveCell>
                    <ResponsiveCell label="Actions" primary align="end">
                      {row.status === 'active' ? (
                        <McpConfirmAction
                          action={revokeAction}
                          fields={{ kind: 'grant', id: row.id }}
                          label="Revoke"
                          accessibleLabel={
                            isAdmin
                              ? `Revoke connection for ${name} and ${who}`
                              : `Revoke connection for ${name}`
                          }
                          title={`Revoke connection for ${name}?`}
                          confirmLabel="Revoke connection"
                          successMessage="Connection revoked"
                          className="w-full md:w-auto"
                          description={
                            isAdmin ? (
                              <p>
                                This revokes {who}&apos;s access for {name}. It stops working on its
                                next request. They can connect again any time.
                              </p>
                            ) : (
                              <p>
                                This revokes your access for {name}. It stops working on its next
                                request. You can connect again any time.
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
              {MCP_CREDENTIAL_SECURITY_COPY}
            </p>
          </div>
          {isAdmin && revocable > 0 && (
            <McpConfirmAction
              action={revokeAllAction}
              fields={{}}
              acknowledgement={`I understand this disconnects every assistant for everyone (${revocable === 1 ? '1 connection' : `${revocable} connections`}).`}
              label="Revoke all active connections"
              accessibleLabel="Revoke all active MCP connections across OpsKnight"
              title="Revoke all active MCP connections?"
              confirmLabel="Revoke all connections"
              successMessage="All MCP connections revoked"
              description={
                <>
                  <p>
                    This disconnects every assistant immediately. People will need to sign in and
                    approve again. Use this if a shared credential or laptop was compromised.
                  </p>
                  {filtered && (
                    <p className="font-medium text-foreground">
                      It ignores the current filter: all {revocable} connections across OpsKnight
                      are revoked, not only the ones shown.
                    </p>
                  )}
                </>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
