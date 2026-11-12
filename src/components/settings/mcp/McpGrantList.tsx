import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { getAssistantIcon } from '@/components/common/BrandLogos';
import McpActivityDrawer from '@/components/settings/mcp/McpActivityDrawer';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpScopeSummary from '@/components/settings/mcp/McpScopeSummary';
import {
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
} from '@/components/settings/mcp/McpListKit';
import {
  blockCopy,
  connectionName,
  personLabel,
} from '@/components/settings/mcp/sections/McpConnectionsSection';
import type { McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';
import type { McpConnectionActivity } from '@/app/(app)/settings/integrations/mcp/activity';

const STATUS = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  revoked: { label: 'Revoked', tone: 'neutral' },
} as const;

/**
 * An administrator's compact list of connections, for one assistant (`show="person"`) or one
 * person (`show="assistant"`): who or what, scopes, last call, status, activity and revoke. The
 * revoke goes through the existing per-connection action, which keeps every check.
 */
export default function McpGrantList({
  rows,
  show,
  caption,
  now,
  timeZone,
  describeScope,
  revokeAction,
  activityAction,
}: {
  rows: McpGrantRow[];
  show: 'person' | 'assistant';
  caption: string;
  now: Date;
  timeZone: string;
  describeScope: (scope: string) => string;
  revokeAction: (form: FormData) => Promise<void>;
  activityAction: (input: {
    grantId: string;
    cursor?: { at: string; id: string };
  }) => Promise<McpConnectionActivity>;
}) {
  const label = show === 'person' ? 'Person' : 'Assistant';
  return (
    <ResponsiveTable
      caption={caption}
      columns={[
        { label },
        { label: 'Scopes' },
        { label: 'Last call' },
        { label: 'Status' },
        { label: 'Actions', srOnly: true, className: 'text-right' },
      ]}
    >
      {rows.map(row => {
        const name = connectionName(row);
        const who = personLabel(row.user);
        const context = `${name} for ${who}`;
        return (
          <ResponsiveRow key={row.id} muted={row.status !== 'active'}>
            <ResponsiveCell label={label} primary>
              {show === 'person' ? (
                <Link
                  href={`/users/${row.user.id}`}
                  className="block min-w-0 break-words font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {who}
                  {row.user.name && row.user.email && (
                    <span className="block break-all text-xs font-normal text-muted-foreground">
                      {row.user.email}
                    </span>
                  )}
                </Link>
              ) : (
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/40">
                    {row.kind === 'pat' ? (
                      <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      getAssistantIcon(row.client.name, 'h-4 w-4', row.client.metadataHost)
                    )}
                  </span>
                  <span className="min-w-0">
                    {row.kind === 'oauth' ? (
                      <Link
                        href={`/settings/integrations/mcp/assistants/${encodeURIComponent(row.client.id)}`}
                        className="block break-words font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="block break-words font-medium text-foreground">{name}</span>
                    )}
                    <StatusPill tone={row.kind === 'pat' ? 'warning' : 'neutral'}>
                      {row.kind === 'pat' ? 'Personal token' : 'OAuth'}
                    </StatusPill>
                  </span>
                </span>
              )}
            </ResponsiveCell>
            <ResponsiveCell label="Scopes">
              <McpScopeSummary
                context={context}
                scopes={row.scopes.map(scope => ({ scope, label: describeScope(scope) }))}
                usable={row.status === 'active' ? row.effectiveScopes : undefined}
              />
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
                  <code className="break-all font-mono text-[11px] text-muted-foreground">
                    {row.lastTool}
                  </code>
                )}
              </span>
            </ResponsiveCell>
            <ResponsiveCell label="Status">
              {row.blockedReason ? (
                <span className="flex flex-col gap-0.5">
                  <StatusPill tone="danger" dot>
                    {blockCopy(row).label}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">{blockCopy(row).hint}</span>
                </span>
              ) : (
                <StatusPill tone={STATUS[row.status].tone} dot>
                  {STATUS[row.status].label}
                </StatusPill>
              )}
            </ResponsiveCell>
            <ResponsiveCell label="Actions" primary align="end">
              <span className="flex flex-wrap items-center gap-1.5 md:justify-end">
                <McpActivityDrawer
                  grantId={row.id}
                  label={context}
                  timeZone={timeZone}
                  load={activityAction}
                />
                {row.status === 'active' && (
                  <McpConfirmAction
                    action={revokeAction}
                    fields={{ kind: 'grant', id: row.id }}
                    label="Revoke"
                    accessibleLabel={`Revoke connection for ${name} and ${who}`}
                    title={`Revoke connection for ${name}?`}
                    confirmLabel="Revoke connection"
                    successMessage="Connection revoked"
                    description={
                      <p>
                        This revokes {who}&apos;s access for {name}. It stops working on its next
                        request. They can connect again any time.
                      </p>
                    }
                  />
                )}
              </span>
            </ResponsiveCell>
          </ResponsiveRow>
        );
      })}
    </ResponsiveTable>
  );
}
