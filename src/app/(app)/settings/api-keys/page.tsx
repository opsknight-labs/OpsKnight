/* eslint-disable @typescript-eslint/no-explicit-any -- arbitrary JSON documents / erased generic route plumbing */
/* eslint-disable security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name */
import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ApiKeysPanel, { type ApiKey } from '@/components/settings/ApiKeysPanel';
import ServiceAccountsPanel, {
  type ServiceAccountItem,
} from '@/components/settings/ServiceAccountsPanel';
import ApiExplorerPanel, { type ApiEndpointDoc } from '@/components/settings/ApiExplorerPanel';
import ApiActivityPanel, { type ApiAuditLogItem } from '@/components/settings/ApiActivityPanel';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { Key, ShieldCheck, Bot, Activity, Terminal, Code2, Clock, ShieldAlert } from 'lucide-react';
import { getAppUrl } from '@/lib/app-url';
import { listServiceAccounts } from '@/lib/api-v2/service-accounts';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { findOperation, V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { getVerifiedSampleBody } from '@/lib/api-v2/endpoint-samples';
import {
  buildKeyInventoryWhere,
  encodeInventoryCursor,
  KEY_INVENTORY_PAGE_SIZE,
  parseKeyInventoryFilters,
} from '@/lib/api-key-inventory';
import {
  buildServiceAccountWhere,
  parseServiceAccountFilters,
  SERVICE_ACCOUNT_PAGE_SIZE,
} from '@/lib/service-account-inventory';
import { SERVICE_ACCOUNT_DOMAIN } from '@/lib/service-account-identity';
import Link from 'next/link';
import {
  API_ACTIVITY_PAGE_SIZE,
  buildApiActivityWhere,
  encodeActivityCursor,
  parseApiActivityFilters,
} from '@/lib/api-v2/activity-query';

/** Required scope for an operation, from the same registry that drives the OpenAPI document. */
function getEndpointScope(method: string, path: string): string {
  return findOperation(method, path)?.scope ?? 'admin:manage';
}

function generateSampleFromSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  if (schema.type === 'object' && schema.properties) {
    const result: Record<string, any> = {};
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      if (!prop || typeof prop !== 'object') continue;
      if (prop.default !== undefined) {
        result[key] = prop.default;
      } else if (prop.enum && prop.enum.length > 0) {
        result[key] = prop.enum[0];
      } else if (prop.format === 'date-time') {
        result[key] = '2026-10-14T12:00:00Z';
      } else if (prop.type === 'string') {
        const lowerKey = key.toLowerCase();
        if (key === 'title') result[key] = 'High Latency on Payment Gateway';
        else if (key === 'name') result[key] = 'Production Service';
        else if (key === 'description') result[key] = 'Core transactional checkout service';
        else if (key === 'content' || key === 'note' || key === 'message')
          result[key] = 'Traffic diverted to backup cluster.';
        else if (key === 'resolutionNote') result[key] = 'Mitigated by scaling pod replicas.';
        else if (key === 'serviceId') result[key] = 'srv_123456';
        else if (key === 'teamId') result[key] = 'team_sre';
        else if (key === 'userId' || key === 'assigneeId') result[key] = 'usr_789012';
        else if (key === 'escalationPolicyId') result[key] = 'ep_default';
        else if (key === 'slug') result[key] = 'production-status';
        else if (key === 'timeZone') result[key] = 'UTC';
        else if (key === 'incidentId') result[key] = 'inc_123456';
        else if (key === 'email' || lowerKey.includes('email'))
          result[key] = 'operator@opsknight.local';
        else if (key === 'urgency') result[key] = 'HIGH';
        else if (key === 'severity') result[key] = 'CRITICAL';
        else if (key === 'status') result[key] = 'INVESTIGATING';
        else if (lowerKey.endsWith('url')) result[key] = 'https://hooks.opsknight.local/webhook';
        else if (lowerKey.endsWith('id'))
          result[key] = `${lowerKey.replace('id', '') || 'res'}_123456`;
        else result[key] = 'sample_value';
      } else if (prop.type === 'integer' || prop.type === 'number') {
        result[key] = 1;
      } else if (prop.type === 'boolean') {
        result[key] = true;
      } else if (prop.type === 'array') {
        if (prop.items?.type === 'string') {
          if (key === 'scopes') {
            result[key] = ['events:write', 'incidents:read'];
          } else if (key === 'tags') {
            result[key] = ['production', 'p1'];
          } else if (key.toLowerCase().endsWith('ids')) {
            result[key] = ['id_sample_1'];
          } else {
            result[key] = ['sample_item'];
          }
        } else if (prop.items?.type === 'object') {
          result[key] = [generateSampleFromSchema(prop.items)];
        } else {
          result[key] = [];
        }
      } else {
        result[key] = 'sample_value';
      }
    }
    return result;
  }
  if (schema.type === 'array') {
    return [generateSampleFromSchema(schema.items)];
  }
  return {};
}

const maskIp = (ip: string | null | undefined): string | null => {
  if (!ip) return null;
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
  }
  if (ip.includes(':')) {
    return `${ip.split(':')[0]}:****:****`;
  }
  return '***.***.***.***';
};

const sanitizeAuditDetails = (rawDetails: unknown): Record<string, unknown> | null => {
  if (!rawDetails || typeof rawDetails !== 'object' || Array.isArray(rawDetails)) {
    return null;
  }
  // Audit rows keep caller-supplied details under `metadata`; flatten it so those fields are
  // shown, with the envelope's own top-level fields taking precedence.
  const envelope = rawDetails as Record<string, unknown>;
  const metadata =
    envelope.metadata && typeof envelope.metadata === 'object' && !Array.isArray(envelope.metadata)
      ? (envelope.metadata as Record<string, unknown>)
      : {};
  const d: Record<string, unknown> = { ...metadata, ...envelope };
  const safe: Record<string, unknown> = {};
  const safeKeys = [
    'requestId',
    'entityId',
    'tokenName',
    'label',
    'apiClientId',
    'prefix',
    'scopes',
    'action',
    'status',
    'reason',
    'source',
    'apiGateway',
    'method',
    'path',
  ];
  for (const key of safeKeys) {
    if (key in d && d[key] !== undefined && d[key] !== null) {
      safe[key] = d[key];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
};

const WORKSPACE_TABS = ['api-keys', 'service-accounts', 'explorer', 'activity'] as const;

export default async function ApiKeysSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) ?? {};
  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const requestedTab = rawTab === 'api-explorer' ? 'explorer' : rawTab;
  const activeTab = (WORKSPACE_TABS as readonly string[]).includes(requestedTab ?? '')
    ? (requestedTab as (typeof WORKSPACE_TABS)[number])
    : 'api-keys';
  const activityFilters = parseApiActivityFilters(query);
  const [session, appUrl] = await Promise.all([
    getServerSession(await getAuthOptions()),
    getAppUrl(),
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

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Credential inventory runs in the database: counts are always computed (they feed the
  // header and tab labels), but a list is loaded only for the tab being viewed, one page at a
  // time, with filters and the cursor taken from the URL.
  const keyFilters = parseKeyInventoryFilters(query);
  const keyScope = user ? (user.role === 'ADMIN' ? {} : { userId: user.id }) : null;
  const allKeysWhere = keyScope ? buildKeyInventoryWhere(keyScope, { status: 'ALL' }, now) : null;
  const [totalKeys, activeKeysCount, expiringSoonCount] = keyScope
    ? await Promise.all([
        prisma.apiKey.count({ where: allKeysWhere! }),
        prisma.apiKey.count({ where: buildKeyInventoryWhere(keyScope, { status: 'ACTIVE' }, now) }),
        prisma.apiKey.count({
          where: {
            AND: [
              allKeysWhere!,
              { revokedAt: null, expiresAt: { gt: now, lte: thirtyDaysFromNow } },
            ],
          },
        }),
      ])
    : [0, 0, 0];

  let rawKeys: Array<
    Awaited<
      ReturnType<typeof prisma.apiKey.findMany<{ include: { user: { select: { email: true } } } }>>
    >[number]
  > = [];
  let nextKeyCursor: string | null = null;
  let matchingKeys: number | undefined;
  if (keyScope && activeTab === 'api-keys') {
    const [rows, matches] = await Promise.all([
      prisma.apiKey.findMany({
        where: buildKeyInventoryWhere(keyScope, keyFilters, now),
        include: { user: { select: { email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: KEY_INVENTORY_PAGE_SIZE + 1,
      }),
      prisma.apiKey.count({
        where: buildKeyInventoryWhere(keyScope, { ...keyFilters, cursor: undefined }, now),
      }),
    ]);
    matchingKeys = matches;
    rawKeys = rows.slice(0, KEY_INVENTORY_PAGE_SIZE);
    nextKeyCursor =
      rows.length > KEY_INVENTORY_PAGE_SIZE
        ? encodeInventoryCursor(rawKeys[rawKeys.length - 1])
        : null;
  }

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

  // Enforce server-side authorization: never query or serialize administrative records for non-admins
  const serviceAccountFilters = parseServiceAccountFilters(query);
  let rawServiceAccounts: Awaited<ReturnType<typeof listServiceAccounts>> = [];
  let teams: { id: string; name: string }[] = [];
  let totalServiceAccounts = 0;
  let totalMachineTokens = 0;
  let nextServiceAccountCursor: string | null = null;
  let matchingServiceAccounts: number | undefined;
  let rawAuditLogs: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorEmail: string | null;
    actorName: string | null;
    createdAt: Date;
    details: unknown;
    ip: string | null;
  }> = [];
  let nextActivityCursor: string | null = null;
  let matchingActivity: number | undefined;

  if (isAdmin) {
    // Header counts are cheap aggregates; unexpired, unrevoked tokens only.
    [totalServiceAccounts, totalMachineTokens] = await Promise.all([
      prisma.user.count({
        where: { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}`, mode: 'insensitive' } },
      }),
      prisma.apiKey.count({
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          user: { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}`, mode: 'insensitive' } },
        },
      }),
    ]);

    if (activeTab === 'service-accounts') {
      const [accounts, teamsRes, matches] = await Promise.all([
        listServiceAccounts({
          where: buildServiceAccountWhere(serviceAccountFilters),
          take: SERVICE_ACCOUNT_PAGE_SIZE + 1,
        }),
        prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.user.count({
          where: buildServiceAccountWhere({ ...serviceAccountFilters, cursor: undefined }),
        }),
      ]);
      matchingServiceAccounts = matches;
      teams = teamsRes;
      rawServiceAccounts = accounts.slice(0, SERVICE_ACCOUNT_PAGE_SIZE);
      nextServiceAccountCursor =
        accounts.length > SERVICE_ACCOUNT_PAGE_SIZE
          ? encodeInventoryCursor(rawServiceAccounts[rawServiceAccounts.length - 1])
          : null;
    }

    if (activeTab === 'activity') {
      // Filtered, ordered and paginated in the database; one extra row signals another page.
      const [auditRes, matches] = await Promise.all([
        prisma.auditLog.findMany({
          where: buildApiActivityWhere(activityFilters),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: API_ACTIVITY_PAGE_SIZE + 1,
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
        prisma.auditLog.count({
          where: buildApiActivityWhere({ ...activityFilters, cursor: undefined }),
        }),
      ]);
      matchingActivity = matches;
      const hasMoreActivity = auditRes.length > API_ACTIVITY_PAGE_SIZE;
      rawAuditLogs = auditRes.slice(0, API_ACTIVITY_PAGE_SIZE);
      nextActivityCursor =
        hasMoreActivity && rawAuditLogs.length > 0
          ? encodeActivityCursor(rawAuditLogs[rawAuditLogs.length - 1])
          : null;
    }
  }

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
    tokensTotal: sa.tokensTotal,
    tokensTruncated: sa.tokensTruncated,
    tokens: sa.tokens.map(t => ({
      status: t.status,
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes,
      createdAt: formatDateTime(t.createdAt, timeZone, { format: 'date' }),
      lastUsedAt: t.lastUsedAt ? formatDateTime(t.lastUsedAt, timeZone, { format: 'date' }) : null,
      expiresAt: t.expiresAt ? formatDateTime(t.expiresAt, timeZone, { format: 'date' }) : null,
    })),
  }));

  // Parse OpenAPI spec into Endpoint documentation with schema-derived sample request bodies & required scopes
  const endpointCount = V2_OPERATIONS.length;
  const spec = getOpenApiV2Spec() as { paths?: Record<string, Record<string, any>> };
  const endpoints: ApiEndpointDoc[] = [];
  if (spec?.paths) {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
        const op = pathItem[method];
        if (op) {
          try {
            const verifiedSample = getVerifiedSampleBody(method, pathKey);
            const reqSchema = op.requestBody?.content?.['application/json']?.schema;
            const sampleBody =
              verifiedSample ?? (reqSchema ? generateSampleFromSchema(reqSchema) : undefined);

            endpoints.push({
              method: method.toUpperCase() as any,
              path: pathKey,
              tag: op.tags?.[0] || 'General',
              summary: op.summary || '',
              description: op.description || '',
              scope: getEndpointScope(method, pathKey),
              parameters: op.parameters,
              requestBody: op.requestBody
                ? {
                    description: op.requestBody.description,
                    sample: sampleBody,
                  }
                : undefined,
            });
          } catch {
            endpoints.push({
              method: method.toUpperCase() as any,
              path: pathKey,
              tag: op.tags?.[0] || 'General',
              summary: op.summary || '',
              description: op.description || '',
              scope: getEndpointScope(method, pathKey),
              parameters: op.parameters,
            });
          }
        }
      }
    }
  }

  // Format Audit Activity with redacted IP addresses and sanitized details
  const formattedActivities: ApiAuditLogItem[] = rawAuditLogs.map(log => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorEmail: log.actorEmail,
    actorName: log.actorName,
    createdAt: formatDateTime(log.createdAt, timeZone, { format: 'datetime' }),
    details: sanitizeAuditDetails(log.details),
    ip: maskIp(log.ip),
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
              {endpointCount} Endpoints Live
            </Badge>
          </>
        }
        stats={
          isAdmin
            ? [
                {
                  label: 'Active API Keys',
                  value: `${activeKeysCount}`,
                  icon: <ShieldCheck className="h-3.5 w-3.5" />,
                  subtext: 'Personal developer keys',
                },
                {
                  label: 'Service Accounts',
                  value: `${totalServiceAccounts}`,
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
                  value: `${endpointCount}`,
                  icon: <Terminal className="h-3.5 w-3.5" />,
                  subtext: 'Enterprise endpoints',
                },
              ]
            : [
                {
                  label: 'Active API Keys',
                  value: `${activeKeysCount}`,
                  icon: <ShieldCheck className="h-3.5 w-3.5" />,
                  subtext: 'Personal developer keys',
                },
                {
                  label: 'Expiring Soon',
                  value: `${expiringSoonCount}`,
                  icon: <Clock className="h-3.5 w-3.5" />,
                  subtext: 'Keys within 30 days',
                },
                {
                  label: 'API v2 Routes',
                  value: `${endpointCount}`,
                  icon: <Terminal className="h-3.5 w-3.5" />,
                  subtext: 'Enterprise endpoints',
                },
              ]
        }
      />

      {/* Unified 4-Tab Developer Workspace */}
      <Tabs value={activeTab} className="space-y-6">
        <TabsList className="h-auto max-w-full flex-wrap justify-start bg-muted/70 p-1 border border-border/80 rounded-xl">
          <TabsTrigger value="api-keys" className="text-xs font-semibold gap-1.5 px-3.5" asChild>
            <Link href="/settings/api-keys?tab=api-keys" scroll={false} prefetch={false}>
              <Key className="h-3.5 w-3.5" />
              API Keys ({totalKeys})
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="service-accounts"
            className="text-xs font-semibold gap-1.5 px-3.5"
            asChild
          >
            <Link href="/settings/api-keys?tab=service-accounts" scroll={false} prefetch={false}>
              <Bot className="h-3.5 w-3.5" />
              Service Accounts {isAdmin ? `(${totalServiceAccounts})` : ''}
            </Link>
          </TabsTrigger>
          <TabsTrigger value="explorer" className="text-xs font-semibold gap-1.5 px-3.5" asChild>
            <Link href="/settings/api-keys?tab=explorer" scroll={false} prefetch={false}>
              <Code2 className="h-3.5 w-3.5" />
              API Explorer ({endpointCount})
            </Link>
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs font-semibold gap-1.5 px-3.5" asChild>
            <Link href="/settings/api-keys?tab=activity" scroll={false} prefetch={false}>
              <Activity className="h-3.5 w-3.5" />
              API Activity
            </Link>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: API Keys */}
        <TabsContent value="api-keys" className="space-y-4">
          <ApiKeysPanel
            keys={formattedKeys}
            inventory={{
              q: keyFilters.q ?? '',
              status: keyFilters.status,
              hasCursor: Boolean(keyFilters.cursor),
              nextCursor: nextKeyCursor,
              total: matchingKeys,
            }}
            canCreateWriteKeys={
              user ? hasCapability(user.role, CAPABILITIES.OPERATIONS_MANAGE) : false
            }
            isAdmin={isAdmin}
            role={user?.role}
            appUrl={appUrl}
          />
        </TabsContent>

        {/* Tab 2: Service Accounts */}
        <TabsContent value="service-accounts" className="space-y-4">
          {isAdmin ? (
            <ServiceAccountsPanel
              serviceAccounts={formattedServiceAccounts}
              availableTeams={teams}
              isAdmin={isAdmin}
              inventory={{
                q: serviceAccountFilters.q ?? '',
                role: serviceAccountFilters.role,
                hasCursor: Boolean(serviceAccountFilters.cursor),
                nextCursor: nextServiceAccountCursor,
                total: matchingServiceAccounts,
              }}
            />
          ) : (
            <Card className="border-border/80 shadow-xs">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold">
                      Administrator Access Required
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Service accounts and machine credentials can only be managed by workspace
                      administrators.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  To provision automated machine identities or CI/CD tokens for Kubernetes,
                  Terraform, or GitHub Actions, contact your OpsKnight workspace administrator.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab 3: API Explorer */}
        <TabsContent value="explorer" className="space-y-4">
          <ApiExplorerPanel endpoints={endpoints} appUrl={appUrl} />
        </TabsContent>

        {/* Tab 4: API Activity */}
        <TabsContent value="activity" className="space-y-4">
          {isAdmin ? (
            <ApiActivityPanel
              activities={formattedActivities}
              nextCursor={nextActivityCursor}
              total={matchingActivity}
              filters={{
                q: activityFilters.action ?? '',
                entity: activityFilters.entityType ?? '',
                actor: activityFilters.actor ?? '',
                key: activityFilters.apiKeyId ?? '',
                from: typeof query.from === 'string' ? query.from : '',
                to: typeof query.to === 'string' ? query.to : '',
                hasCursor: Boolean(activityFilters.cursor),
              }}
            />
          ) : (
            <Card className="border-border/80 shadow-xs">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold">
                      Administrator Access Required
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Organization-wide API activity and gateway audit logs are restricted to
                      administrators.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Audit log streaming contains security-sensitive access metadata across all teams
                  and services. Contact your workspace administrator to request audit trail
                  extracts.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
