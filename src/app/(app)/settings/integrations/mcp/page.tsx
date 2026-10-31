import Link from 'next/link';
import {
  Bot,
  CheckCircle2,
  Globe,
  KeyRound,
  PencilLine,
  Search,
  Shield,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { getMcpConfigurationStatus } from '@/lib/mcp/auth/config';
import { requireMcp } from '@/lib/mcp/core/errors';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import McpCopyField from '@/components/settings/mcp/McpCopyField';
import McpPolicyForm from '@/components/settings/mcp/McpPolicyForm';
import McpAppUrlSetup from '@/components/settings/mcp/McpAppUrlSetup';
import McpQuickSetup from '@/components/settings/mcp/McpQuickSetup';
import McpConnectionTest from '@/components/settings/mcp/McpConnectionTest';
import { DEFAULT_ASSISTANT_SCOPES } from '@/lib/mcp/auth/client-policy';
import { describeMcpScope, supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import {
  enableMcpQuickSetup,
  registerMcpClient,
  restoreMcpClient,
  revokeAllMcpConnections,
  revokeMcpAccess,
  testMcpConnection,
  updateMcpPolicy,
} from './actions';
import McpCapabilityControls from './components/McpCapabilityControls';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const checkboxClass = 'mt-0.5 h-4 w-4 shrink-0 accent-primary';

const ORIGIN_SOURCE_LABEL = {
  'app-url': 'App URL (Settings → System)',
  'app-environment': 'Application URL configuration',
  override: 'Deployment override',
  development: 'Local development default',
} as const;

function ToggleRow({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border-b border-border py-4 last:border-0">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className={checkboxClass}
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function ScopeBadges({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map(scope => (
        <Badge key={scope} variant="outline" className="font-mono text-[10px]">
          {scope}
        </Badge>
      ))}
    </div>
  );
}

export default async function McpSettings({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; q?: string }>;
}) {
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const { cursor, q = '' } = await searchParams;
  requireMcp(!cursor || /^[A-Za-z0-9_-]{1,128}$/.test(cursor), 'MCP_INVALID_CURSOR');
  requireMcp(q.length <= 100, 'MCP_INVALID_SEARCH');
  const [configuration, policy, clients, grants, activeGrants, systemSettings] = await Promise.all([
    getMcpConfigurationStatus(),
    prisma.mcpPolicy.findUnique({ where: { id: 'default' } }),
    permissions.isAdmin
      ? prisma.mcpClient.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          take: 50,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            revokedAt: true,
            scopes: true,
            metadataUrl: true,
            dynamicRegistration: true,
          },
        })
      : Promise.resolve([]),
    prisma.mcpGrant.findMany({
      where: {
        ...(permissions.isAdmin ? {} : { userId: permissions.id }),
        client: { name: { contains: q, mode: 'insensitive' } },
      },
      take: 26,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        scopes: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        client: { select: { name: true } },
      },
    }),
    prisma.mcpGrant.count({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(permissions.isAdmin ? {} : { userId: permissions.id }),
      },
    }),
    permissions.isAdmin
      ? prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { updatedAt: true } })
      : Promise.resolve(null),
  ]);
  const people = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(grants.map(grant => grant.userId))] } },
        select: { id: true, name: true, email: true },
      })
    ).map(person => [person.id, person])
  );
  const enabled = policy?.enabled ?? false;
  const ready = configuration.issues.length === 0;
  const automaticReady = ready && enabled && Boolean(policy?.dcrEnabled && policy.dcrScopes.length);
  const endpoint = configuration.origin ? `${configuration.origin}/mcp` : null;
  const cursorConfig = endpoint
    ? JSON.stringify({ mcpServers: { opsknight: { url: endpoint } } }, null, 2)
    : null;
  const vscodeCommand = endpoint
    ? `code --add-mcp '${JSON.stringify({ name: 'opsknight', type: 'http', url: endpoint }).replaceAll("'", "'\\''")}'`
    : null;
  const selectedScopes = new Set(
    policy?.dcrScopes.length ? policy.dcrScopes : DEFAULT_ASSISTANT_SCOPES
  );
  const scopeChoices = [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage').sort();
  const claudeCommand = endpoint
    ? `claude mcp add --scope user --transport http opsknight '${endpoint.replaceAll("'", "'\\''")}'`
    : null;
  const doctorCommand = endpoint
    ? `node scripts/mcp/doctor.cjs '${endpoint.replaceAll("'", "'\\''")}'`
    : null;
  const needsSetup = permissions.isAdmin && !enabled;
  const grantsTitle = permissions.isAdmin ? 'Client grants' : 'Your grants';

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        tag="AI ASSISTANT INTEGRATION"
        title="MCP integration"
        subtitle="Let AI assistants read OpsKnight and propose changes, with explicit user consent, each user's current permissions, and independent approval for every change."
        badges={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground text-[10px] font-semibold"
            >
              <Shield className="h-3 w-3 mr-1" />
              {permissions.isAdmin ? 'Admin managed' : 'Your access'}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold ${
                enabled && ready
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                  : 'border-white/20 bg-white/10 text-primary-foreground/80'
              }`}
            >
              {enabled && ready ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Enabled
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 mr-1" />
                  {enabled ? 'Needs attention' : 'Disabled'}
                </>
              )}
            </Badge>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Endpoint',
            value: endpoint ?? 'Not configured',
            icon: <Globe className="h-4 w-4" />,
            tooltip: endpoint ?? undefined,
            valueClassName: endpoint
              ? 'text-primary-foreground font-semibold text-xs sm:text-sm font-mono truncate max-w-full'
              : 'text-amber-300',
            subtext: configuration.originSource
              ? ORIGIN_SOURCE_LABEL[configuration.originSource]
              : 'Set the App URL',
          },
          {
            label: 'Changes',
            value: policy?.writesEnabled ? 'Approval required' : 'Read only',
            icon: <PencilLine className="h-4 w-4" />,
            valueClassName: policy?.writesEnabled ? 'text-amber-300' : 'text-emerald-300',
            subtext: 'Reviewed by a second admin',
          },
          {
            label: 'Sensitive reads',
            value: policy?.sensitiveReadsEnabled ? 'Allowed' : 'Off',
            icon: <ShieldAlert className="h-4 w-4" />,
            valueClassName: policy?.sensitiveReadsEnabled
              ? 'text-amber-300'
              : 'text-primary-foreground/80',
            subtext: 'Redacted configuration',
          },
          {
            label: permissions.isAdmin ? 'Active connections' : 'Your connections',
            value: String(activeGrants),
            icon: <Bot className="h-4 w-4" />,
            valueClassName: 'text-primary-foreground font-semibold',
            subtext: 'Consented grants',
          },
        ]}
      />

      {permissions.isAdmin && configuration.issues.length > 0 && (
        <section
          role="alert"
          aria-label="MCP configuration problems"
          className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            MCP cannot be enabled yet
          </h2>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            {configuration.issues.map(issue => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {!configuration.origin ? (
            <McpAppUrlSetup revision={systemSettings?.updatedAt.toISOString() ?? null} />
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/system">Open System settings</Link>
            </Button>
          )}
        </section>
      )}

      {needsSetup && (
        <SettingsSection
          title="Turn on AI assistant access"
          description="Let your team connect Claude, ChatGPT, Cursor and other assistants to OpsKnight."
        >
          <div className="space-y-4 py-4 text-sm">
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              <li>Read-only to start: incidents, services and on-call schedules.</li>
              <li>
                Each person adds the URL, signs in with their own account and approves once. Their
                OpsKnight permissions always apply.
              </li>
              <li>
                You can disconnect anyone, or everyone, at any time. No extra secrets to manage.
              </li>
            </ul>
            <McpQuickSetup action={enableMcpQuickSetup} blocked={!ready} />
            {!ready && (
              <p className="text-muted-foreground">
                Fix the problems above first. This button unlocks as soon as they are resolved.
              </p>
            )}
          </div>
        </SettingsSection>
      )}

      {!permissions.isAdmin && !enabled && (
        <InlineNotice tone="info" title="AI assistant access is not turned on yet">
          <p>
            Ask an OpsKnight administrator to enable it in Settings → Integrations & ChatOps → MCP
            (AI Assistants).
          </p>
        </InlineNotice>
      )}

      {endpoint && (enabled || permissions.isAdmin) && (
        <SettingsSection
          title="Connect your assistant"
          description="Add this URL to your assistant, sign in once and approve. That is all."
        >
          <div className="space-y-4 py-4 text-sm">
            <div className="space-y-2">
              <p className="font-medium">MCP server URL</p>
              <McpCopyField value={endpoint} label="MCP endpoint" />
            </div>
            {enabled && !automaticReady && permissions.isAdmin && (
              <InlineNotice tone="warning" title="Automatic connections are off">
                <p>
                  Assistants cannot connect by URL alone yet. Turn on Automatic connections below
                  and save.
                </p>
              </InlineNotice>
            )}
            <div className="space-y-2">
              <details className="rounded-md border border-border p-3" open>
                <summary className="cursor-pointer font-medium">Claude Code</summary>
                <div className="space-y-2 pt-3">
                  <McpCopyField value={claudeCommand!} label="Claude Code setup command" />
                  <p className="text-muted-foreground">
                    Run it in your terminal, then use <code>/mcp</code> to sign in.
                  </p>
                </div>
              </details>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer font-medium">Claude and ChatGPT apps</summary>
                <p className="pt-3 text-muted-foreground">
                  Open the app&apos;s connectors or integrations settings, add a custom connector,
                  paste the URL above and choose OAuth. Menu names vary by app version, and some
                  plans require an administrator to allow custom connectors.
                </p>
              </details>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer font-medium">Cursor</summary>
                <div className="space-y-2 pt-3">
                  <p className="text-muted-foreground">
                    Add this to <code>~/.cursor/mcp.json</code>, then sign in when prompted.
                  </p>
                  <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
                    {cursorConfig}
                  </pre>
                </div>
              </details>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer font-medium">VS Code</summary>
                <div className="space-y-2 pt-3">
                  <McpCopyField value={vscodeCommand!} label="VS Code setup command" />
                </div>
              </details>
            </div>
            <p className="text-muted-foreground">
              You stay signed in while you use the assistant
              {policy ? ` (${policy.sessionIdleDays} days of inactivity signs you out)` : ''}.
              Manage or disconnect access under{' '}
              {permissions.isAdmin ? 'Client grants' : 'Your grants'} below.
            </p>
            {permissions.isAdmin && (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="font-medium">Check your setup</p>
                <McpConnectionTest action={testMcpConnection} />
                <details className="pt-1 text-muted-foreground">
                  <summary className="cursor-pointer">Test from another machine</summary>
                  <div className="space-y-2 pt-2">
                    <p>
                      Run this read-only check anywhere that can reach your server, for example a
                      laptop on the public internet. It creates no clients, tokens or grants.
                    </p>
                    <McpCopyField value={doctorCommand!} label="MCP setup check command" />
                  </div>
                </details>
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      {permissions.isAdmin && (
        <>
          <McpPolicyForm action={updateMcpPolicy}>
            <fieldset className="space-y-4 border-b border-border py-4">
              <legend className="text-sm font-medium">Assistant access</legend>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={enabled}
                  className={checkboxClass}
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Enable MCP</span>
                  <span className="block text-sm text-muted-foreground">
                    Uncheck for an immediate MCP-only shutdown; the rest of OpsKnight is unaffected.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="dcrEnabled"
                  defaultChecked={policy?.dcrEnabled ?? false}
                  className={checkboxClass}
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Automatic connections</span>
                  <span className="block text-sm text-muted-foreground">
                    Assistants connect with just the URL: no client ID, secret or callback setup.
                    Each person still signs in and approves, and their own permissions apply. Turn
                    off to disconnect every automatically connected assistant immediately.
                  </span>
                </span>
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium">What assistants may do</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {scopeChoices.map(scope => (
                    <label key={scope} className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="dcrScopes"
                        value={scope}
                        defaultChecked={selectedScopes.has(scope)}
                        className={checkboxClass}
                      />
                      <span>{describeMcpScope(scope)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="mcp-idle-days">Stay signed in for (days of inactivity)</Label>
                <Input
                  id="mcp-idle-days"
                  name="sessionIdleDays"
                  type="number"
                  min="1"
                  max="90"
                  defaultValue={policy?.sessionIdleDays ?? 30}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Using the assistant keeps it signed in, up to 90 days in total. Changing a
                  password or disconnecting always signs it out immediately.
                </p>
              </div>
            </fieldset>
            <details className="py-4">
              <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
              <div className="space-y-2 pt-2">
                <ToggleRow
                  name="writesEnabled"
                  label="Allow reviewed routine mutations and approved runbook executions"
                  description="Assistants can prepare changes; each one waits for approval by a different administrator."
                  defaultChecked={policy?.writesEnabled ?? false}
                />
                <ToggleRow
                  name="sensitiveReadsEnabled"
                  label="Allow reviewed sensitive configuration reads"
                  description="Redacted, read-only, and limited to what the signed-in user can already see."
                  defaultChecked={policy?.sensitiveReadsEnabled ?? false}
                />
                <div className="space-y-1.5 border-b border-border py-4">
                  <Label htmlFor="mcp-cimd-hosts">
                    Only trust these assistant hosts (optional, one DNS name per line)
                  </Label>
                  <textarea
                    id="mcp-cimd-hosts"
                    className={textareaClass}
                    name="cimdAllowedHosts"
                    rows={3}
                    maxLength={4096}
                    defaultValue={(policy?.cimdAllowedHosts ?? []).join('\n')}
                  />
                  <p className="text-sm text-muted-foreground">
                    Leave empty to allow any assistant that identifies with an HTTPS metadata
                    document. Documents are fetched without redirects from public addresses only.
                  </p>
                </div>
                <fieldset className="space-y-4 py-4">
                  <legend className="text-sm font-medium">Workload limits</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-max-in-flight">Concurrent requests per process</Label>
                      <Input
                        id="mcp-max-in-flight"
                        name="maxInFlight"
                        type="number"
                        min="1"
                        max="16"
                        defaultValue={policy?.maxInFlight ?? 4}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-max-operations">Operations per request</Label>
                      <Input
                        id="mcp-max-operations"
                        name="maxOperations"
                        type="number"
                        min="1"
                        max="16"
                        defaultValue={policy?.maxOperations ?? 8}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-rpm">Weighted operations per minute per grant</Label>
                      <Input
                        id="mcp-rpm"
                        name="requestsPerMinute"
                        type="number"
                        min="1"
                        max="600"
                        defaultValue={policy?.requestsPerMinute ?? 60}
                        required
                      />
                    </div>
                  </div>
                </fieldset>
              </div>
            </details>
          </McpPolicyForm>

          {/* Exposed capabilities: self-contained section (data, action and audit in its own files). */}
          <McpCapabilityControls />

          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Manual client registration (advanced)
            </summary>
            <form action={registerMcpClient} className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Only for clients that require a preconfigured OAuth identity. Most assistants use
                automatic connections.
              </p>
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
                </div>
                <fieldset className="space-y-2 sm:col-span-2">
                  <legend className="text-sm font-medium">Allowed scopes</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {scopeChoices.map(scope => (
                      <label key={scope} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="scopes"
                          value={scope}
                          defaultChecked={DEFAULT_ASSISTANT_SCOPES.includes(scope)}
                          className={checkboxClass}
                        />
                        <span>{describeMcpScope(scope)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  Register client
                </Button>
              </div>
            </form>
          </details>
        </>
      )}

      <form className="flex items-end gap-2" method="get" role="search">
        <div className="grow space-y-1.5">
          <Label htmlFor="mcp-search">Search clients and grants</Label>
          <Input id="mcp-search" name="q" maxLength={100} defaultValue={q} />
        </div>
        <Button type="submit" variant="outline" className="gap-1.5">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
      </form>

      {permissions.isAdmin && (
        <section aria-label="Clients">
          <SettingsSection
            title="Clients"
            description="Registered assistants and the most scopes each may request."
          >
            <div className="space-y-3 py-4">
              {clients.length === 0 && (
                <p className="text-sm text-muted-foreground">No clients registered.</p>
              )}
              {clients.length === 50 && (
                <p className="text-sm text-muted-foreground">
                  Showing the first 50 clients. Use the search above to find a specific one.
                </p>
              )}
              {clients.map(client => (
                <article key={client.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{client.name}</h3>
                    {client.dynamicRegistration && (
                      <Badge variant="outline">Automatically registered</Badge>
                    )}
                    {client.revokedAt ? (
                      <Badge variant="outline">Revoked</Badge>
                    ) : client.metadataUrl ? (
                      <Badge variant="outline">Metadata document</Badge>
                    ) : null}
                  </div>
                  <p className="break-all text-xs text-muted-foreground">
                    Client ID: <code className="font-mono text-foreground">{client.id}</code>
                  </p>
                  <ScopeBadges scopes={client.scopes} />
                  {client.revokedAt && (
                    <form action={restoreMcpClient}>
                      <input type="hidden" name="id" value={client.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Allow client again
                      </Button>
                    </form>
                  )}
                  {!client.revokedAt && (
                    <form action={revokeMcpAccess}>
                      <input type="hidden" name="kind" value="client" />
                      <input type="hidden" name="id" value={client.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                      >
                        Revoke client and all its grants
                      </Button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          </SettingsSection>
        </section>
      )}

      <section aria-label={grantsTitle}>
        <SettingsSection
          title={grantsTitle}
          description="Each grant is one user's consent to one assistant. Revoking takes effect on the next request."
        >
          {permissions.isAdmin && (
            <p className="pt-4 text-sm text-muted-foreground">
              Changes to MCP settings and connections are recorded in the{' '}
              <Link className="underline" href="/audit">
                audit log
              </Link>
              .
            </p>
          )}
          <div className="space-y-3 py-4">
            {grants.length === 0 && <p className="text-sm text-muted-foreground">No grants.</p>}
            {grants.slice(0, 25).map(grant => (
              <article key={grant.id} className="space-y-2 rounded-lg border border-border p-3">
                <h3 className="text-sm font-semibold">{grant.client.name}</h3>
                <p className="break-all text-xs text-muted-foreground">
                  {people.get(grant.userId)?.name ??
                    people.get(grant.userId)?.email ??
                    grant.userId}
                  {people.get(grant.userId)?.name && people.get(grant.userId)?.email
                    ? ` (${people.get(grant.userId)!.email})`
                    : ''}
                  {' · '}
                  {grant.lastUsedAt
                    ? `Last used ${grant.lastUsedAt.toLocaleDateString('en-US', { dateStyle: 'medium' })}`
                    : 'Not used yet'}
                  {' · '}Signed in until{' '}
                  {grant.expiresAt.toLocaleDateString('en-US', { dateStyle: 'medium' })}
                </p>
                <ScopeBadges scopes={grant.scopes} />
                {grant.revokedAt ? (
                  <p className="text-sm font-medium text-muted-foreground">Revoked</p>
                ) : (
                  <form action={revokeMcpAccess}>
                    <input type="hidden" name="kind" value="grant" />
                    <input type="hidden" name="id" value={grant.id} />
                    <Button type="submit" variant="outline" size="sm" className="text-destructive">
                      Revoke grant
                    </Button>
                  </form>
                )}
              </article>
            ))}
            {grants.length > 25 && (
              <Link
                className="text-sm underline"
                href={`?cursor=${grants[24].id}&q=${encodeURIComponent(q)}`}
              >
                Next grants
              </Link>
            )}
          </div>
        </SettingsSection>
      </section>

      {permissions.isAdmin && (
        <form action={revokeAllMcpConnections}>
          <SettingsSection
            title="Credential security"
            description="MCP tokens are stored only as hashes keyed from the application encryption key; there is no separate MCP secret to configure."
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
                users reconnect their assistants. Use the button below to disconnect everyone
                immediately, for example after a suspected credential exposure.
              </p>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" name="confirm" required className={checkboxClass} />
                <span>I understand every user must reconnect their assistants.</span>
              </label>
            </div>
          </SettingsSection>
        </form>
      )}
    </div>
  );
}
