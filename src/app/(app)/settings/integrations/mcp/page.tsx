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
import { DEFAULT_ASSISTANT_SCOPES } from '@/lib/mcp/auth/client-policy';
import {
  registerMcpClient,
  revokeAllMcpConnections,
  revokeMcpAccess,
  updateMcpPolicy,
} from './actions';

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
  const [configuration, policy, clients, grants, activeGrants] = await Promise.all([
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
  ]);
  const enabled = policy?.enabled ?? false;
  const ready = configuration.issues.length === 0;
  const automaticReady = ready && enabled && Boolean(policy?.dcrEnabled && policy.dcrScopes.length);
  const endpoint = configuration.origin ? `${configuration.origin}/mcp` : null;
  const claudeCommand = endpoint
    ? `claude mcp add --scope user --transport http opsknight '${endpoint.replaceAll("'", "'\\''")}'`
    : null;
  const doctorCommand = endpoint
    ? `node scripts/mcp/doctor.cjs '${endpoint.replaceAll("'", "'\\''")}'`
    : null;
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
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/system">Open System settings</Link>
          </Button>
        </section>
      )}

      <section aria-label="Connection status">
        <SettingsSection
          title="Connection"
          description="Give assistants this endpoint. They sign users in with OAuth (authorization code with PKCE) and receive only the scopes each user approves."
        >
          <dl className="divide-y divide-border">
            <div className="grid gap-2 py-4 md:grid-cols-[40%_1fr] md:gap-6">
              <dt className="text-sm font-medium">Status</dt>
              <dd className="text-sm">
                <strong>Status:</strong> {enabled ? 'Enabled' : 'Disabled'}
              </dd>
            </div>
            <div className="grid gap-2 py-4 md:grid-cols-[40%_1fr] md:gap-6">
              <dt className="space-y-1">
                <span className="block text-sm font-medium">Remote endpoint</span>
                <span className="block text-sm text-muted-foreground">
                  Built from the App URL in{' '}
                  <Link className="underline" href="/settings/system">
                    Settings → System
                  </Link>
                  . No environment variables are needed.
                </span>
              </dt>
              <dd className="min-w-0">
                {endpoint ? (
                  <McpCopyField value={endpoint} label="MCP endpoint" />
                ) : (
                  <span className="text-sm text-muted-foreground">Not configured</span>
                )}
              </dd>
            </div>
            <div className="grid gap-2 py-4 md:grid-cols-[40%_1fr] md:gap-6">
              <dt className="text-sm font-medium">Protocol</dt>
              <dd className="text-sm text-muted-foreground">
                MCP 2026-07-28 over streamable HTTP. Credentials belong only in the assistant&apos;s
                secure credential store. Compatibility with specific assistants is still being
                certified.
              </dd>
            </div>
          </dl>
        </SettingsSection>
      </section>

      {endpoint && (
        <SettingsSection
          title="Connect your assistant"
          description="Add this server, then sign in with your own OpsKnight account."
        >
          <div className="space-y-4 py-4 text-sm">
            <InlineNotice
              tone={automaticReady ? 'success' : 'warning'}
              title={
                automaticReady
                  ? 'Automatic connections are configured'
                  : 'Finish administrator setup first'
              }
            >
              {automaticReady ? (
                <p>
                  Users can add the MCP URL, sign in and approve their own access. Their existing
                  OpsKnight permissions still apply.
                </p>
              ) : (
                <p>
                  Configure the App URL in Settings → System, then enable MCP and automatic
                  assistant registration with at least one allowed scope and save the policy. No
                  separate MCP secret is needed.
                </p>
              )}
            </InlineNotice>
            <div className="space-y-2">
              <p className="font-medium">Claude Code</p>
              <McpCopyField value={claudeCommand!} label="Claude Code setup command" />
              <p>
                Run the command in your terminal, then use <code>/mcp</code> in Claude Code to sign
                in.
              </p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">ChatGPT and other HTTP MCP clients</p>
              <p>
                Add the remote endpoint above and select OAuth authentication. Automatic
                registration handles the client ID and callback address; you approve the requested
                access after signing in.
              </p>
            </div>
            <p className="text-muted-foreground">
              Manage access below under {permissions.isAdmin ? 'Client grants' : 'Your grants'}.
              Revoking a connection blocks its tokens; reconnecting requires sign-in and consent
              again.
            </p>
            <p className="text-muted-foreground">
              Each user gets a separate, revocable connection with their own current permissions. No
              separate MCP secret is required.
            </p>
            {permissions.isAdmin && (
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer font-medium">Connection troubleshooting</summary>
                <div className="space-y-2 pt-3">
                  <p>
                    From your OpsKnight checkout or application container, run this read-only setup
                    check. It uses your configured URL and creates no clients, tokens or grants.
                  </p>
                  <McpCopyField value={doctorCommand!} label="MCP setup check command" />
                  <p className="text-muted-foreground">
                    For assistants hosted outside your network, the URL must be reachable from that
                    assistant. Keep HTTPS enabled and preserve the public Host and OAuth headers
                    through your reverse proxy.
                  </p>
                </div>
              </details>
            )}
          </div>
        </SettingsSection>
      )}

      {permissions.isAdmin && (
        <>
          <McpPolicyForm action={updateMcpPolicy}>
            <ToggleRow
              name="enabled"
              label="Enable MCP"
              description="Uncheck for an immediate MCP-only shutdown; the rest of OpsKnight is unaffected."
              defaultChecked={enabled}
            />
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
            <fieldset className="space-y-4 border-b border-border py-4">
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
            <fieldset className="space-y-4 py-4">
              <legend className="text-sm font-medium">Automatic assistant connections</legend>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="dcrEnabled"
                  defaultChecked={policy?.dcrEnabled ?? true}
                  className={checkboxClass}
                />
                <span className="text-sm">Allow assistants to register automatically</span>
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-dcr-scopes">
                  Maximum scopes for automatically registered assistants
                </Label>
                <Input
                  id="mcp-dcr-scopes"
                  name="dcrScopes"
                  maxLength={2048}
                  defaultValue={(policy?.dcrScopes.length
                    ? policy.dcrScopes
                    : DEFAULT_ASSISTANT_SCOPES
                  ).join(' ')}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Users add the server URL and sign in with their own OpsKnight account. No manual
                client ID or callback setup is needed. Registration alone grants no access. Users
                must consent, and current roles, scopes and approval rules still apply. Turn this
                off to disconnect automatically registered assistants immediately.
              </p>
            </fieldset>
            <fieldset className="space-y-4 py-4">
              <legend className="text-sm font-medium">Client ID metadata documents</legend>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="cimdEnabled"
                  defaultChecked={policy?.cimdEnabled ?? false}
                  className={checkboxClass}
                />
                <span className="text-sm">
                  Allow clients identified by an HTTPS metadata document URL
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-cimd-hosts">
                    Trusted hosts (one exact DNS name per line)
                  </Label>
                  <textarea
                    id="mcp-cimd-hosts"
                    className={textareaClass}
                    name="cimdAllowedHosts"
                    rows={3}
                    maxLength={4096}
                    defaultValue={(policy?.cimdAllowedHosts ?? []).join('\n')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-cimd-scopes">
                    Maximum scopes for these clients (space separated)
                  </Label>
                  <Input
                    id="mcp-cimd-scopes"
                    name="cimdScopes"
                    maxLength={2048}
                    defaultValue={(policy?.cimdScopes ?? []).join(' ')}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Documents are fetched only from listed hosts over HTTPS to public addresses, without
                redirects, and cannot request more than these scopes. Users still consent to each
                grant; removing a host revokes its clients immediately.
              </p>
            </fieldset>
          </McpPolicyForm>

          <form action={registerMcpClient}>
            <SettingsSection
              title="Manual client registration (advanced)"
              description="For clients that require a preconfigured OAuth identity. Most assistants can use automatic connections above."
              footer={
                <div className="flex justify-end">
                  <Button type="submit" size="sm">
                    Register client
                  </Button>
                </div>
              }
            >
              <div className="grid gap-4 py-4 sm:grid-cols-2">
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
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="mcp-client-scopes">Allowed scopes (space separated)</Label>
                  <Input
                    id="mcp-client-scopes"
                    name="scopes"
                    required
                    placeholder="incidents:read services:read schedules:read"
                  />
                </div>
              </div>
            </SettingsSection>
          </form>
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
          <div className="space-y-3 py-4">
            {grants.length === 0 && <p className="text-sm text-muted-foreground">No grants.</p>}
            {grants.slice(0, 25).map(grant => (
              <article key={grant.id} className="space-y-2 rounded-lg border border-border p-3">
                <h3 className="text-sm font-semibold">{grant.client.name}</h3>
                <p className="break-all text-xs text-muted-foreground">
                  Principal ID: {grant.userId} · Expires {grant.expiresAt.toISOString()}
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
