import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ApiKeysPanel, { type ApiKey } from '@/components/settings/ApiKeysPanel';
import ServiceAccountsPanel, { type ServiceAccountItem } from '@/components/settings/ServiceAccountsPanel';
import ApiExplorerPanel, { type ApiEndpointDoc } from '@/components/settings/ApiExplorerPanel';
import ApiActivityPanel, { type ApiAuditLogItem } from '@/components/settings/ApiActivityPanel';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { Key, ShieldCheck, Bot, Activity, Terminal, Code2 } from 'lucide-react';
import { getAppUrl } from '@/lib/app-url';
import { listServiceAccounts } from '@/lib/api-v2/service-accounts';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';

export default async function ApiKeysSettingsPage() {
  const [session, appUrl, rawServiceAccounts, teams, rawAuditLogs] = await Promise.all([
    getServerSession(await getAuthOptions()),
    getAppUrl(),
    listServiceAccounts(),
    prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { action: { startsWith: 'api_key.' } },
          { action: { startsWith: 'service_account' } },
          { action: { startsWith: 'incident.' } },
          { action: { startsWith: 'runbook.' } },
          { action: { startsWith: 'status_page.' } },
          { action: { startsWith: 'notification.' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorEmail: true,
        actorName: true,
        createdAt: true,
        details: true,
        ip: true,
      },
    }),
  ]);

  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, timeZone: true, role: true },
      })
    : null;
  const timeZone = getUserTimeZone(user ?? undefined);
  const isAdmin = user ? hasCapability(user.role, CAPABILITIES.ADMIN_MANAGE) : false;

  const rawKeys = user
    ? await prisma.apiKey.findMany({
        where: user.role === 'ADMIN' ? undefined : { userId: user.id },
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const now = new Date();

  const formattedKeys: ApiKey[] = rawKeys.map(key => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    ownerEmail: key.user.email,
    createdAt: formatDateTime(key.createdAt, timeZone, { format: 'date' }),
    lastUsedAt: key.lastUsedAt
      ? formatDateTime(key.lastUsedAt, timeZone, { format: 'date' })
      : null,
    revokedAt: key.revokedAt ? formatDateTime(key.revokedAt, timeZone, { format: 'date' }) : null,
    expiresAt: key.expiresAt ? formatDateTime(key.expiresAt, timeZone, { format: 'date' }) : null,
    expired: !!key.expiresAt && key.expiresAt <= now,
  }));

  const activeKeysCount = formattedKeys.filter(k => !k.revokedAt && !k.expired).length;

  // Format Service Accounts
  const formattedServiceAccounts: ServiceAccountItem[] = rawServiceAccounts.map(sa => ({
    id: sa.id,
    name: sa.name,
    email: sa.email,
    role: sa.role,
    status: sa.status,
    createdAt: formatDateTime(sa.createdAt, timeZone, { format: 'date' }),
    updatedAt: formatDateTime(sa.updatedAt, timeZone, { format: 'date' }),
    teams: sa.teams,
    activeTokensCount: sa.activeTokensCount,
    tokens: sa.tokens.map(t => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes,
      createdAt: formatDateTime(t.createdAt, timeZone, { format: 'date' }),
      lastUsedAt: t.lastUsedAt ? formatDateTime(t.lastUsedAt, timeZone, { format: 'date' }) : null,
      expiresAt: t.expiresAt ? formatDateTime(t.expiresAt, timeZone, { format: 'date' }) : null,
    })),
  }));

  const totalMachineTokens = formattedServiceAccounts.reduce(
    (sum, sa) => sum + sa.activeTokensCount,
    0
  );

  // Parse OpenAPI spec into Endpoint documentation
  const spec = getOpenApiV2Spec() as { paths?: Record<string, Record<string, any>> };
  const endpoints: ApiEndpointDoc[] = [];
  if (spec?.paths) {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
        const op = pathItem[method];
        if (op) {
          endpoints.push({
            method: method.toUpperCase() as any,
            path: pathKey,
            tag: op.tags?.[0] || 'General',
            summary: op.summary || '',
            description: op.description || '',
            parameters: op.parameters,
            requestBody: op.requestBody,
          });
        }
      }
    }
  }

  // Format Audit Activity
  const formattedActivities: ApiAuditLogItem[] = rawAuditLogs.map(log => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorEmail: log.actorEmail,
    actorName: log.actorName,
    createdAt: formatDateTime(log.createdAt, timeZone, { format: 'datetime' }),
    details: log.details as Record<string, unknown> | null,
    ip: log.ip,
  }));

  return (
    <div className="space-y-6">
      {/* Centralized Glassmorphic Hero Banner */}
      <DetailHeroBanner
        tag="Developer & Programmatic Access Workspace"
        title="Developer & API Access"
        subtitle="Manage personal API keys, machine service accounts, inspect all 38 v2 REST endpoints, and monitor API gateway activity."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <Key className="h-8 w-8" />
          </div>
        }
        badges={
          <>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
            >
              REST API v2
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs"
            >
              {endpoints.length} Endpoints Live
            </Badge>
          </>
        }
        stats={[
          {
            label: 'Active API Keys',
            value: `${activeKeysCount}`,
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext: 'Personal developer keys',
          },
          {
            label: 'Service Accounts',
            value: `${formattedServiceAccounts.length}`,
            icon: <Bot className="h-3.5 w-3.5" />,
            subtext: 'Machine identities',
          },
          {
            label: 'Machine Tokens',
            value: `${totalMachineTokens}`,
            icon: <Key className="h-3.5 w-3.5" />,
            subtext: 'Active CI/CD credentials',
          },
          {
            label: 'API v2 Routes',
            value: `${endpoints.length}`,
            icon: <Terminal className="h-3.5 w-3.5" />,
            subtext: 'Enterprise endpoints',
          },
        ]}
      />

      {/* Unified 4-Tab Developer Workspace */}
      <Tabs defaultValue="api-keys" className="space-y-6">
        <TabsList className="h-10 bg-muted/70 p-1 border border-border/80 rounded-xl">
          <TabsTrigger value="api-keys" className="text-xs font-semibold gap-1.5 px-3.5">
            <Key className="h-3.5 w-3.5" />
            API Keys ({formattedKeys.length})
          </TabsTrigger>
          <TabsTrigger value="service-accounts" className="text-xs font-semibold gap-1.5 px-3.5">
            <Bot className="h-3.5 w-3.5" />
            Service Accounts ({formattedServiceAccounts.length})
          </TabsTrigger>
          <TabsTrigger value="explorer" className="text-xs font-semibold gap-1.5 px-3.5">
            <Code2 className="h-3.5 w-3.5" />
            API Explorer ({endpoints.length})
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs font-semibold gap-1.5 px-3.5">
            <Activity className="h-3.5 w-3.5" />
            API Activity
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: API Keys */}
        <TabsContent value="api-keys" className="space-y-4">
          <ApiKeysPanel
            keys={formattedKeys}
            canCreateWriteKeys={
              user ? hasCapability(user.role, CAPABILITIES.OPERATIONS_MANAGE) : false
            }
            appUrl={appUrl}
          />
        </TabsContent>

        {/* Tab 2: Service Accounts */}
        <TabsContent value="service-accounts" className="space-y-4">
          <ServiceAccountsPanel
            serviceAccounts={formattedServiceAccounts}
            availableTeams={teams}
            isAdmin={isAdmin}
          />
        </TabsContent>

        {/* Tab 3: API Explorer */}
        <TabsContent value="explorer" className="space-y-4">
          <ApiExplorerPanel endpoints={endpoints} appUrl={appUrl} />
        </TabsContent>

        {/* Tab 4: API Activity */}
        <TabsContent value="activity" className="space-y-4">
          <ApiActivityPanel activities={formattedActivities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
