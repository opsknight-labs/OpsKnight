import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Check,
  ClipboardCheck,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { Card } from '@/components/ui/shadcn/card';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import McpCopyField from '@/components/settings/mcp/McpCopyField';
import McpQuickSetup from '@/components/settings/mcp/McpQuickSetup';
import McpConnectionTest from '@/components/settings/mcp/McpConnectionTest';
import { StatusPill } from '@/components/settings/mcp/McpListKit';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';

type SetupReport = Awaited<ReturnType<Parameters<typeof McpConnectionTest>[0]['action']>>;

function StatTile({
  href,
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  href: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint: string;
  tone?: 'default' | 'attention' | 'success';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex min-w-0 flex-col rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all sm:p-4 hover:border-primary/40 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        tone === 'attention' && 'border-amber-300/80 dark:border-amber-800/70'
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            'rounded-lg p-1.5 [&_svg]:h-4 [&_svg]:w-4',
            tone === 'attention'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : tone === 'success'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'bg-primary/10 text-primary'
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      </span>
      <span className="mt-2 font-display text-2xl font-bold tabular-nums tracking-tight text-foreground">
        {value}
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground sm:text-xs">
        <span className="truncate">{hint}</span>
        <ArrowRight
          className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export default function McpOverviewSection({
  isAdmin,
  enabled,
  ready,
  automaticReady,
  endpoint,
  originSource,
  sessionIdleDays,
  writesEnabled,
  counts,
  hrefs,
  enableAction,
  testAction,
}: {
  isAdmin: boolean;
  enabled: boolean;
  ready: boolean;
  automaticReady: boolean;
  endpoint: string | null;
  originSource: string | null;
  sessionIdleDays: number;
  writesEnabled: boolean;
  counts: {
    activeConnections: number;
    activeClients: number | null;
    pendingApprovals: number | null;
  };
  hrefs: {
    connect: string;
    connections: string;
    assistants: string;
    approvals: string;
    policy: string;
  };
  enableAction: () => Promise<void>;
  testAction: () => Promise<SetupReport>;
}) {
  const needsSetup = isAdmin && !enabled;
  const live = enabled && ready;
  return (
    <div className="space-y-6">
      {needsSetup && (
        <Card className="overflow-hidden border-primary/30">
          <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-primary/10 p-1.5 text-primary" aria-hidden="true">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h2 className="font-display text-lg font-bold tracking-tight">
                  Turn on AI assistant access
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Let your team connect Claude, ChatGPT, Cursor and other assistants to OpsKnight.
              </p>
              <ul className="grid gap-2 text-sm sm:grid-cols-3">
                {[
                  'Read-only to start: incidents, services and on-call schedules.',
                  'Each person signs in and approves once. Their OpsKnight permissions always apply.',
                  'Disconnect anyone, or everyone, at any time. No extra secrets to manage.',
                ].map(point => (
                  <li key={point} className="flex gap-2 py-0 pl-0 text-muted-foreground">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2 md:text-right">
              <McpQuickSetup action={enableAction} blocked={!ready} />
              {!ready && (
                <p className="max-w-xs text-xs text-muted-foreground">
                  Fix the configuration problems above first. This button unlocks as soon as they
                  are resolved.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {!isAdmin && !enabled && (
        <InlineNotice tone="info" title="AI assistant access is not turned on yet">
          <p>
            Ask an OpsKnight administrator to enable it in Settings → Integrations → MCP (AI
            Assistants).
          </p>
        </InlineNotice>
      )}

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          href={hrefs.connections}
          icon={<Users />}
          label={isAdmin ? 'Active connections' : 'Your connections'}
          value={counts.activeConnections}
          hint={isAdmin ? 'People signed in with an assistant' : 'Assistants you have approved'}
        />
        {isAdmin && counts.activeClients !== null && (
          <StatTile
            href={hrefs.assistants}
            icon={<Bot />}
            label="Assistants"
            value={counts.activeClients}
            hint="Registered and allowed"
          />
        )}
        {isAdmin && counts.pendingApprovals !== null && (
          <StatTile
            href={hrefs.approvals}
            icon={<ClipboardCheck />}
            label="Pending approvals"
            value={counts.pendingApprovals}
            hint={counts.pendingApprovals ? 'Waiting for a reviewer' : 'Nothing waiting'}
            tone={counts.pendingApprovals ? 'attention' : 'default'}
          />
        )}
        {isAdmin && (
          <StatTile
            href={hrefs.policy}
            icon={<ShieldCheck />}
            label="Assistant permissions"
            value={
              <span className="text-lg">{writesEnabled ? 'Reviewed changes' : 'Read only'}</span>
            }
            hint={
              writesEnabled
                ? 'Each change needs administrator approval'
                : 'Assistants cannot change anything'
            }
            tone={writesEnabled ? 'default' : 'success'}
          />
        )}
      </section>

      {endpoint && (enabled || isAdmin) && (
        <div className={cn('grid gap-6', isAdmin && 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
          <SettingsSection
            title="Server endpoint"
            description="The one URL people add to their assistant. They sign in once and approve."
            action={
              <StatusPill tone={live ? 'success' : enabled ? 'warning' : 'neutral'} dot>
                {live ? 'Accepting connections' : enabled ? 'Needs attention' : 'Off'}
              </StatusPill>
            }
          >
            <div className="space-y-5 py-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">MCP server URL</p>
                <McpCopyField value={endpoint} label="MCP endpoint" />
              </div>
              {enabled && !automaticReady && isAdmin && (
                <InlineNotice tone="warning" title="Automatic connections are off">
                  <p>
                    Assistants cannot connect by URL alone yet. Turn on Automatic connections in{' '}
                    <Link href={hrefs.policy} className="font-medium underline underline-offset-2">
                      Access policy
                    </Link>{' '}
                    and save.
                  </p>
                </InlineNotice>
              )}
              <dl className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <Fact label="Address from">{originSource ?? 'Not configured'}</Fact>
                <Fact label="Stay signed in">
                  {sessionIdleDays} {sessionIdleDays === 1 ? 'day' : 'days'} of inactivity
                </Fact>
              </dl>
            </div>
            <div className="-mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 md:-mx-6 md:px-6">
              <p className="text-xs text-muted-foreground">
                Step-by-step setup for Claude, ChatGPT, Cursor and VS Code.
              </p>
              <Link
                href={hrefs.connect}
                className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plug className="h-3.5 w-3.5" aria-hidden="true" />
                Connect an assistant
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </SettingsSection>

          {isAdmin && (
            <SettingsSection
              title="Check your setup"
              description="Runs the same read-only checks an assistant performs when it connects."
            >
              <div className="space-y-4 py-5 text-sm">
                <McpConnectionTest action={testAction} />
                <details className="group rounded-lg border border-border px-3 py-2.5">
                  <summary className="cursor-pointer text-sm font-medium text-foreground marker:text-muted-foreground">
                    Test from another machine
                  </summary>
                  <div className="space-y-2 pt-3 text-muted-foreground">
                    <p>
                      Run this read-only check anywhere that can reach your server, for example a
                      laptop on the public internet. It creates no clients, tokens or grants.
                    </p>
                    <McpCopyField
                      value={mcpSetupCommands(endpoint).doctor}
                      label="MCP setup check command"
                    />
                  </div>
                </details>
              </div>
            </SettingsSection>
          )}
        </div>
      )}
    </div>
  );
}
