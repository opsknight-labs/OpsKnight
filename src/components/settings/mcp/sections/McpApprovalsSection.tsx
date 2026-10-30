import Link from 'next/link';
import { ArrowRight, ClipboardCheck, History } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  FilterChips,
  ListEmpty,
  Pagination,
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
  type PillTone,
} from '@/components/settings/mcp/McpListKit';
import { personLabel } from '@/components/settings/mcp/sections/McpConnectionsSection';
import type {
  McpApprovalRow,
  McpApprovalStatus,
} from '@/app/(app)/settings/integrations/mcp/queries';
import {
  MCP_PAGE_SIZE,
  mcpHref,
  type ApprovalKind,
  type ApprovalState,
} from '@/app/(app)/settings/integrations/mcp/list-params';

const STATUS: Record<McpApprovalStatus, { label: string; tone: PillTone }> = {
  pending: { label: 'Awaiting review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  executing: { label: 'Running', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** R0–R3 risk classes from the operation catalogue; R3 is destructive. */
function riskTone(risk: string): PillTone {
  if (risk === 'R3') return 'danger';
  if (risk === 'R2') return 'warning';
  return 'info';
}

export default function McpApprovalsSection({
  rows,
  total,
  page,
  kind,
  state,
  pending,
  writesEnabled,
  now,
  timeZone,
}: {
  rows: McpApprovalRow[];
  total: number;
  page: number;
  kind: ApprovalKind;
  state: ApprovalState;
  pending: { operations: number; runbooks: number };
  writesEnabled: boolean;
  now: Date;
  timeZone: string;
}) {
  const base = {
    tab: 'approvals',
    kind: kind === 'operations' ? null : kind,
    state: state === 'pending' ? null : state,
  };
  const noun = kind === 'operations' ? 'change' : 'runbook run';
  return (
    <SettingsSection
      title="Approvals"
      description="Changes and runbook runs that assistants proposed. Each one waits for a different person than the requester to review the exact, frozen request."
    >
      <div className="flex flex-col gap-2 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <FilterChips
          label="Approval type"
          selected={kind}
          options={[
            {
              value: 'operations',
              label: 'Configuration changes',
              count: pending.operations,
              href: mcpHref({ ...base, kind: null, page: null }),
            },
            {
              value: 'runbooks',
              label: 'Runbook runs',
              count: pending.runbooks,
              href: mcpHref({ ...base, kind: 'runbooks', page: null }),
            },
          ]}
        />
        <FilterChips
          label="Approval state"
          selected={state}
          options={[
            {
              value: 'pending',
              label: 'Pending',
              href: mcpHref({ ...base, state: null, page: null }),
            },
            {
              value: 'decided',
              label: 'History',
              href: mcpHref({ ...base, state: 'decided', page: null }),
            },
          ]}
        />
      </div>
      <div className="-mx-4 border-t border-border md:-mx-6">
        {rows.length === 0 ? (
          state === 'pending' ? (
            <ListEmpty
              icon={<ClipboardCheck className="h-5 w-5" />}
              title={`No ${noun}s waiting for review`}
            >
              {writesEnabled
                ? `When an assistant proposes a ${noun}, it appears here and in the assistant's reply as a review link. An administrator must approve it; the requester can approve only if they are an administrator and confirm.`
                : 'Assistants are read only, so nothing can be proposed. Turn on reviewed changes in Access policy to allow proposals.'}
            </ListEmpty>
          ) : (
            <ListEmpty icon={<History className="h-5 w-5" />} title={`No reviewed ${noun}s yet`}>
              Approved, rejected and expired requests are listed here.
            </ListEmpty>
          )
        ) : (
          <ResponsiveTable
            caption={
              kind === 'operations' ? 'Configuration change approvals' : 'Runbook run approvals'
            }
            columns={[
              { label: 'Request' },
              ...(kind === 'operations' ? [{ label: 'Risk' }] : []),
              { label: 'Requested by' },
              { label: 'Requested' },
              { label: state === 'pending' ? 'Expires' : 'Decided' },
              { label: 'Status' },
              { label: 'Actions', srOnly: true, className: 'text-right' },
            ]}
          >
            {rows.map(row => {
              const status = STATUS[row.status];
              const who = personLabel(row.requester);
              return (
                <ResponsiveRow key={row.id}>
                  <ResponsiveCell label="Request" primary className="md:max-w-[22rem]">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground" title={row.title}>
                        {row.title}
                      </p>
                      {row.detail && (
                        <p
                          className="truncate font-mono text-[11px] text-muted-foreground"
                          title={row.detail}
                        >
                          {row.detail}
                        </p>
                      )}
                    </div>
                  </ResponsiveCell>
                  {kind === 'operations' && (
                    <ResponsiveCell label="Risk">
                      {row.risk ? (
                        <StatusPill tone={riskTone(row.risk)}>{row.risk}</StatusPill>
                      ) : (
                        '—'
                      )}
                    </ResponsiveCell>
                  )}
                  <ResponsiveCell label="Requested by">
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{who}</p>
                      {row.assistant && (
                        <p className="truncate text-xs text-muted-foreground">
                          via {row.assistant}
                        </p>
                      )}
                    </div>
                  </ResponsiveCell>
                  <ResponsiveCell label="Requested">
                    <RelativeTime value={row.createdAt} now={now} timeZone={timeZone} />
                  </ResponsiveCell>
                  <ResponsiveCell label={state === 'pending' ? 'Expires' : 'Decided'}>
                    <RelativeTime
                      value={state === 'pending' ? row.expiresAt : row.decidedAt}
                      now={now}
                      timeZone={timeZone}
                      empty="Not reviewed"
                    />
                    {state === 'decided' && row.reviewer && (
                      <span className="block truncate text-xs text-muted-foreground">
                        by {personLabel(row.reviewer)}
                      </span>
                    )}
                  </ResponsiveCell>
                  <ResponsiveCell label="Status">
                    <StatusPill tone={status.tone} dot>
                      {status.label}
                    </StatusPill>
                  </ResponsiveCell>
                  <ResponsiveCell label="Actions" primary align="end">
                    {row.href ? (
                      <Link
                        href={row.href}
                        aria-label={`${row.status === 'pending' ? 'Review' : 'View'} ${row.title} requested by ${who}`}
                        className={
                          row.status === 'pending'
                            ? 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-auto'
                            : 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-auto'
                        }
                      >
                        {row.status === 'pending' ? 'Review' : 'View'}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Closed</span>
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
          label="Approvals pages"
          page={page}
          pageSize={MCP_PAGE_SIZE}
          total={total}
          href={n => mcpHref({ ...base, page: n })}
        />
      </div>
    </SettingsSection>
  );
}
