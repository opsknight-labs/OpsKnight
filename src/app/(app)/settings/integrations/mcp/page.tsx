import { getUserPermissions } from '@/lib/rbac';
import Link from 'next/link';
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Globe,
  LayoutDashboard,
  Layers,
  PencilLine,
  Plug,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  XCircle,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { getMcpConfigurationStatus } from '@/lib/mcp/auth/config';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import McpAppUrlSetup from '@/components/settings/mcp/McpAppUrlSetup';
import McpSectionNav, { type McpNavItem } from '@/components/settings/mcp/McpSectionNav';
import McpOverviewSection from '@/components/settings/mcp/sections/McpOverviewSection';
import McpConnectSection from '@/components/settings/mcp/sections/McpConnectSection';
import McpConnectionsSection from '@/components/settings/mcp/sections/McpConnectionsSection';
import McpAssistantsSection from '@/components/settings/mcp/sections/McpAssistantsSection';
import McpApprovalsSection from '@/components/settings/mcp/sections/McpApprovalsSection';
import McpPolicySection from '@/components/settings/mcp/sections/McpPolicySection';
import McpCapabilityControls from './components/McpCapabilityControls';
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
import { mcpHref, parseMcpListParams, totalPages, type McpSection } from './list-params';
import {
  countActiveClients,
  countActiveConnections,
  countPendingApprovals,
  listMcpApprovals,
  listMcpClients,
  listMcpGrants,
  loadMcpViewer,
} from './queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ORIGIN_SOURCE_LABEL = {
  'app-url': 'App URL (Settings → System)',
  'app-environment': 'Application URL configuration',
  override: 'Deployment override',
  development: 'Local development default',
} as const;

const SECTION_LABEL = new Map<McpSection, string>(
  Object.entries({
    overview: 'Overview',
    connect: 'Connect',
    connections: 'Connections',
    assistants: 'Assistants',
    approvals: 'Approvals',
    policy: 'Access policy',
    capabilities: 'Exposed capabilities',
  }) as [McpSection, string][]
);

/** Requests past the last page show the last page instead of an empty list. */
function clampPage(page: number, total: number) {
  return Math.min(page, totalPages(total));
}

export default async function McpSettings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Signed-in users see their own MCP access; every admin-only read below is gated on isAdmin.
  const permissions = await getUserPermissions();
  const viewer = await loadMcpViewer(permissions);
  const isAdmin = permissions.isAdmin;
  const params = parseMcpListParams(await searchParams, isAdmin);
  const { section } = params;
  const now = new Date();

  const [configuration, policy, activeConnections, pending] = await Promise.all([
    getMcpConfigurationStatus(),
    prisma.mcpPolicy.findUnique({ where: { id: 'default' } }),
    countActiveConnections(viewer, now),
    isAdmin ? countPendingApprovals(viewer, now) : Promise.resolve(null),
  ]);
  const systemSettings =
    isAdmin && !configuration.origin
      ? await prisma.systemSettings.findUnique({
          where: { id: 'default' },
          select: { updatedAt: true },
        })
      : null;

  const enabled = policy?.enabled ?? false;
  const ready = configuration.issues.length === 0;
  const automaticReady = ready && enabled && Boolean(policy?.dcrEnabled && policy.dcrScopes.length);
  const endpoint = configuration.origin ? `${configuration.origin}/mcp` : null;
  const originSource = configuration.originSource
    ? ORIGIN_SOURCE_LABEL[configuration.originSource]
    : null;
  const ceiling = policy?.dcrScopes.length ? policy.dcrScopes : DEFAULT_ASSISTANT_SCOPES;
  const scopeChoices = [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage').sort();
  const hrefs = {
    overview: mcpHref({ tab: 'overview' }),
    connect: mcpHref({ tab: 'connect' }),
    connections: mcpHref({ tab: 'connections' }),
    assistants: mcpHref({ tab: 'assistants' }),
    approvals: mcpHref({ tab: 'approvals' }),
    policy: mcpHref({ tab: 'policy' }),
    capabilities: mcpHref({ tab: 'capabilities' }),
  };

  const navItems: McpNavItem[] = [
    { id: 'overview', label: 'Overview', href: hrefs.overview, icon: <LayoutDashboard /> },
    { id: 'connect', label: 'Connect', href: hrefs.connect, icon: <Plug /> },
    {
      id: 'connections',
      label: isAdmin ? 'Connections' : 'Your connections',
      href: hrefs.connections,
      icon: <Users />,
      count: activeConnections,
    },
    ...(isAdmin
      ? [
          { id: 'assistants', label: 'Assistants', href: hrefs.assistants, icon: <Bot /> },
          {
            id: 'approvals',
            label: 'Approvals',
            href: hrefs.approvals,
            icon: <ClipboardCheck />,
            count: pending?.total ?? 0,
            attention: true,
          },
          { id: 'policy', label: 'Access policy', href: hrefs.policy, icon: <SlidersHorizontal /> },
          {
            id: 'capabilities',
            label: 'Exposed capabilities',
            href: hrefs.capabilities,
            icon: <Layers />,
          },
        ]
      : []),
  ];

  return (
    // Matches the product's large-screen content widths: 1080px, and 1180px on 4K displays.
    <div className="w-full max-w-[1080px] space-y-6 min-[1920px]:max-w-[1180px]">
      <DetailHeroBanner
        tag="AI ASSISTANT INTEGRATION"
        title="MCP integration"
        subtitle="Let AI assistants read OpsKnight and propose changes, with explicit user consent, each user's current permissions, and administrator approval for every change."
        badges={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-white/20 bg-white/10 text-[10px] font-semibold text-slate-100"
            >
              <Shield className="mr-1 h-3 w-3" aria-hidden="true" />
              {isAdmin ? 'Admin managed' : 'Your access'}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold ${
                enabled && ready
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                  : 'border-white/20 bg-white/10 text-slate-200'
              }`}
            >
              {enabled && ready ? (
                <>
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                  Enabled
                </>
              ) : (
                <>
                  <XCircle className="mr-1 h-3 w-3" aria-hidden="true" />
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
              ? 'text-white font-semibold text-xs sm:text-sm font-mono truncate max-w-full'
              : 'text-amber-300',
            subtext: originSource ?? 'Set the App URL',
          },
          {
            label: 'Changes',
            value: policy?.writesEnabled ? 'Approval required' : 'Read only',
            icon: <PencilLine className="h-4 w-4" />,
            valueClassName: policy?.writesEnabled ? 'text-amber-300' : 'text-emerald-300',
            subtext: 'Approved by an administrator',
          },
          {
            label: 'Sensitive reads',
            value: policy?.sensitiveReadsEnabled ? 'Allowed' : 'Off',
            icon: <ShieldAlert className="h-4 w-4" />,
            valueClassName: policy?.sensitiveReadsEnabled ? 'text-amber-300' : 'text-slate-200',
            subtext: 'Redacted configuration',
          },
          {
            label: isAdmin ? 'Active connections' : 'Your connections',
            value: String(activeConnections),
            icon: <Bot className="h-4 w-4" />,
            valueClassName: 'text-white font-semibold',
            subtext: 'Consented grants',
          },
        ]}
      />

      {isAdmin && configuration.issues.length > 0 && (
        <section
          role="alert"
          aria-label="MCP configuration problems"
          className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 md:p-5"
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

      <McpSectionNav items={navItems} current={section} />

      <section aria-labelledby="mcp-section-title" className="min-w-0">
        <h2 id="mcp-section-title" className="sr-only">
          {SECTION_LABEL.get(section)}
        </h2>
        {await renderSection()}
      </section>
    </div>
  );

  async function renderSection() {
    switch (section) {
      case 'overview':
        return (
          <McpOverviewSection
            isAdmin={isAdmin}
            enabled={enabled}
            ready={ready}
            automaticReady={automaticReady}
            endpoint={endpoint}
            originSource={originSource}
            sessionIdleDays={policy?.sessionIdleDays ?? 30}
            writesEnabled={policy?.writesEnabled ?? false}
            counts={{
              activeConnections,
              activeClients: isAdmin ? await countActiveClients(viewer) : null,
              pendingApprovals: pending?.total ?? null,
            }}
            hrefs={hrefs}
            enableAction={enableMcpQuickSetup}
            testAction={testMcpConnection}
          />
        );
      case 'connect':
        return (
          <McpConnectSection
            isAdmin={isAdmin}
            enabled={enabled}
            automaticReady={automaticReady}
            endpoint={endpoint}
            sessionIdleDays={policy?.sessionIdleDays ?? null}
            hrefs={hrefs}
          />
        );
      case 'connections': {
        const input = { status: params.grantStatus, q: params.q, clientId: params.clientId };
        let result = await listMcpGrants(viewer, { ...input, page: params.page }, now);
        const page = clampPage(params.page, result.total);
        if (page !== params.page) result = await listMcpGrants(viewer, { ...input, page }, now);
        return (
          <McpConnectionsSection
            isAdmin={isAdmin}
            rows={result.rows}
            counts={result.counts}
            total={result.total}
            page={page}
            status={params.grantStatus}
            q={params.q}
            client={result.client}
            now={now}
            timeZone={viewer.timeZone}
            describeScope={describeMcpScope}
            revokeAction={revokeMcpAccess}
            revokeAllAction={revokeAllMcpConnections}
          />
        );
      }
      case 'assistants': {
        const input = { status: params.clientStatus, type: params.clientType, q: params.q };
        let result = await listMcpClients(viewer, { ...input, page: params.page }, now);
        const page = clampPage(params.page, result.total);
        if (page !== params.page) result = await listMcpClients(viewer, { ...input, page }, now);
        return (
          <McpAssistantsSection
            rows={result.rows}
            counts={result.counts}
            total={result.total}
            page={page}
            status={params.clientStatus}
            type={params.clientType}
            q={params.q}
            now={now}
            timeZone={viewer.timeZone}
            scopeChoices={scopeChoices}
            defaultScopes={DEFAULT_ASSISTANT_SCOPES}
            describeScope={describeMcpScope}
            revokeAction={revokeMcpAccess}
            restoreAction={restoreMcpClient}
            registerAction={registerMcpClient}
          />
        );
      }
      case 'approvals': {
        const input = { kind: params.approvalKind, state: params.approvalState };
        let result = await listMcpApprovals(viewer, { ...input, page: params.page }, now);
        const page = clampPage(params.page, result.total);
        if (page !== params.page) result = await listMcpApprovals(viewer, { ...input, page }, now);
        return (
          <McpApprovalsSection
            rows={result.rows}
            total={result.total}
            page={page}
            kind={params.approvalKind}
            state={params.approvalState}
            pending={result.pending}
            writesEnabled={policy?.writesEnabled ?? false}
            now={now}
            timeZone={viewer.timeZone}
          />
        );
      }
      case 'policy':
        return (
          <McpPolicySection
            policy={{
              enabled,
              dcrEnabled: policy?.dcrEnabled ?? false,
              dcrScopes: policy?.dcrScopes ?? [],
              sessionIdleDays: policy?.sessionIdleDays ?? 30,
              writesEnabled: policy?.writesEnabled ?? false,
              sensitiveReadsEnabled: policy?.sensitiveReadsEnabled ?? false,
              cimdAllowedHosts: policy?.cimdAllowedHosts ?? [],
              maxInFlight: policy?.maxInFlight ?? 4,
              maxOperations: policy?.maxOperations ?? 8,
              requestsPerMinute: policy?.requestsPerMinute ?? 60,
            }}
            scopeChoices={scopeChoices}
            selectedScopes={ceiling}
            describeScope={describeMcpScope}
            action={updateMcpPolicy}
          />
        );
      case 'capabilities':
        return (
          <div id="exposed-capabilities">
            {/* Self-contained: loads its own data and saves through its own audited action. */}
            <McpCapabilityControls />
          </div>
        );
    }
  }
}
