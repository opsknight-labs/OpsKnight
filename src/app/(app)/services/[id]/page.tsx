import prisma from '@/lib/prisma';
import type { WebhookIntegration } from '@prisma/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  assertCanModifyService,
  assertCanViewService,
  getCurrentAuthorizationActor,
} from '@/lib/rbac';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { deleteService, updateService, deleteIntegration } from '../actions';

// UI Components
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import ServiceDetailTabs from '@/components/service/ServiceDetailTabs';

// Icons
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Globe,
  ShieldCheck,
  ShieldAlert,
  Flame,
  Zap,
  Users,
  Activity,
  Clock,
  Settings,
  ExternalLink,
  Plus,
  Server,
  Key,
  Terminal,
  Webhook,
} from 'lucide-react';

// Custom Components
import IncidentList from '@/components/service/IncidentList';
import Pagination from '@/components/service/Pagination';
import CreateIncidentButton from '@/components/incident/CreateIncidentButton';
import AddIntegrationGrid from '@/components/service/AddIntegrationGrid';
import CopyButton from '@/components/service/CopyButton';
import IntegrationStatusToggle from '@/components/service/IntegrationStatusToggle';
import IntegrationSecretControl from '@/components/service/IntegrationSecretControl';
import DeleteIntegrationButton from '@/components/service/DeleteIntegrationButton';
import ServiceNotificationSettings from '@/components/service/ServiceNotificationSettings';
import JiraServiceMappingSettings from '@/components/service/JiraServiceMappingSettings';
import ChatOpsWarRoomSettings from '@/components/service/ChatOpsWarRoomSettings';
import ServiceVisibilitySettings from '@/components/service/ServiceVisibilitySettings';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { INTEGRATION_TYPES, IntegrationType } from '@/components/service/integration-types';

export const revalidate = 0;

const INCIDENTS_PER_PAGE = 20;

type ServiceDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ page?: string; tab?: string; error?: string; saved?: string }>;
};

function getWebhookUrl(
  integrationType: IntegrationType,
  integrationId: string,
  integrationKey: string
): string {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const keyParam = `&integrationKey=${encodeURIComponent(integrationKey)}`;

  switch (integrationType) {
    case 'CLOUDWATCH':
      return `${baseUrl}/api/integrations/cloudwatch?integrationId=${integrationId}${keyParam}`;
    case 'AZURE':
      return `${baseUrl}/api/integrations/azure?integrationId=${integrationId}${keyParam}`;
    case 'DATADOG':
      return `${baseUrl}/api/integrations/datadog?integrationId=${integrationId}${keyParam}`;
    case 'GRAFANA':
      return `${baseUrl}/api/integrations/grafana?integrationId=${integrationId}${keyParam}`;
    case 'PROMETHEUS':
      return `${baseUrl}/api/integrations/prometheus?integrationId=${integrationId}${keyParam}`;
    case 'NEWRELIC':
      return `${baseUrl}/api/integrations/newrelic?integrationId=${integrationId}${keyParam}`;
    case 'SENTRY':
      return `${baseUrl}/api/integrations/sentry?integrationId=${integrationId}${keyParam}`;
    case 'GITHUB':
      return `${baseUrl}/api/integrations/github?integrationId=${integrationId}${keyParam}`;
    case 'GOOGLE_CLOUD_MONITORING':
      return `${baseUrl}/api/integrations/google-cloud-monitoring?integrationId=${integrationId}${keyParam}`;
    case 'SPLUNK_ONCALL':
      return `${baseUrl}/api/integrations/splunk-oncall?integrationId=${integrationId}${keyParam}`;
    case 'SPLUNK_OBSERVABILITY':
      return `${baseUrl}/api/integrations/splunk-observability?integrationId=${integrationId}${keyParam}`;
    case 'DYNATRACE':
      return `${baseUrl}/api/integrations/dynatrace?integrationId=${integrationId}${keyParam}`;
    case 'APPDYNAMICS':
      return `${baseUrl}/api/integrations/appdynamics?integrationId=${integrationId}${keyParam}`;
    case 'ELASTIC':
      return `${baseUrl}/api/integrations/elastic?integrationId=${integrationId}${keyParam}`;
    case 'HONEYCOMB':
      return `${baseUrl}/api/integrations/honeycomb?integrationId=${integrationId}${keyParam}`;
    case 'BITBUCKET':
      return `${baseUrl}/api/integrations/bitbucket?integrationId=${integrationId}${keyParam}`;
    case 'UPTIMEROBOT':
      return `${baseUrl}/api/integrations/uptimerobot?integrationId=${integrationId}${keyParam}`;
    case 'PINGDOM':
      return `${baseUrl}/api/integrations/pingdom?integrationId=${integrationId}${keyParam}`;
    case 'BETTER_UPTIME':
      return `${baseUrl}/api/integrations/better-uptime?integrationId=${integrationId}${keyParam}`;
    case 'UPTIME_KUMA':
      return `${baseUrl}/api/integrations/uptime-kuma?integrationId=${integrationId}${keyParam}`;
    case 'NAGIOS':
      return `${baseUrl}/api/integrations/nagios?integrationId=${integrationId}${keyParam}`;
    case 'ICINGA':
      return `${baseUrl}/api/integrations/icinga?integrationId=${integrationId}${keyParam}`;
    case 'ZABBIX':
      return `${baseUrl}/api/integrations/zabbix?integrationId=${integrationId}${keyParam}`;
    case 'PAGERDUTY':
      return `${baseUrl}/api/integrations/pagerduty/v2/enqueue?integrationId=${integrationId}${keyParam}`;
    case 'GITLAB':
      return `${baseUrl}/api/integrations/gitlab?integrationId=${integrationId}${keyParam}`;
    case 'VERCEL':
      return `${baseUrl}/api/integrations/vercel?integrationId=${integrationId}${keyParam}`;
    case 'WEBHOOK':
      return `${baseUrl}/api/integrations/webhook?integrationId=${integrationId}${keyParam}`;
    case 'EVENTS_API_V2':
    default:
      return `${baseUrl}/api/events`;
  }
}

export default async function ServiceDetailPage({ params, searchParams }: ServiceDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, parseInt(resolvedSearchParams?.page || '1', 10));
  const activeTab = resolvedSearchParams?.tab || 'incidents';
  const errorCode = resolvedSearchParams?.error;
  const isSaved = resolvedSearchParams?.saved === '1';
  const skip = (page - 1) * INCIDENTS_PER_PAGE;

  let currentUser: Awaited<ReturnType<typeof assertCanViewService>>;
  try {
    currentUser = await assertCanViewService(id);
  } catch {
    notFound();
  }
  const actor = await getCurrentAuthorizationActor();
  const incidentAccess = incidentReadWhere(actor);

  let canManageService = false;
  try {
    await assertCanModifyService(id);
    canManageService = true;
  } catch {
    // The service is viewable but this user cannot change its configuration.
  }

  const { calculateActorSLAMetrics, calculateActorMultiServiceUptime } =
    await import('@/lib/actor-metrics');
  const slaWindowDays = 30;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - slaWindowDays * 24 * 60 * 60 * 1000);

  const [
    serviceRaw,
    totalIncidentCount,
    slaMetrics,
    uptimeByService,
    teams,
    policies,
    globalSlackIntegration,
    jiraConfig,
    chatOpsConfig,
  ] = await Promise.all([
    prisma.service.findFirst({
      where: { AND: [serviceReadWhere(actor), { id }] },
      include: {
        team: {
          select: { id: true, name: true, description: true },
        },
        policy: {
          include: {
            steps: {
              include: {
                targetUser: {
                  select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
                },
                targetTeam: { select: { id: true, name: true } },
                targetSchedule: { select: { id: true, name: true } },
              },
              orderBy: { stepOrder: 'asc' },
            },
          },
        },
        integrations: {
          orderBy: { createdAt: 'desc' },
        },
        webhookIntegrations: {
          orderBy: { createdAt: 'desc' },
        },
        jiraServiceMapping: true,
        incidents: {
          where: incidentAccess,
          include: {
            assignee: {
              select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
            },
            team: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: INCIDENTS_PER_PAGE,
        },
        _count: { select: { integrations: true } },
      },
    }),
    prisma.incident.count({ where: { AND: [incidentAccess, { serviceId: id }] } }),
    calculateActorSLAMetrics(actor, {
      serviceId: id,
      windowDays: slaWindowDays,
      includeActiveIncidents: true,
    }),
    calculateActorMultiServiceUptime(actor, [id], thirtyDaysAgo, now),
    canManageService ? prisma.team.findMany({ orderBy: { name: 'asc' } }) : Promise.resolve([]),
    canManageService
      ? prisma.escalationPolicy.findMany({
          select: { id: true, name: true, description: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManageService
      ? prisma.slackIntegration.findFirst({
          where: { enabled: true, services: { none: {} } },
          select: { id: true, workspaceName: true, workspaceId: true, enabled: true },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve(null),
    canManageService
      ? prisma.jiraConfig.findUnique({
          where: { id: 'default' },
          select: { enabled: true },
        })
      : Promise.resolve(null),
    canManageService
      ? prisma.chatOpsConfig.findUnique({
          where: { id: 'default' },
          select: { enabled: true },
        })
      : Promise.resolve(null),
  ]);

  if (!serviceRaw) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = serviceRaw as any;
  const canDeleteService = currentUser.role === 'ADMIN';

  // SLA and Health Computations
  const dynamicStatus = slaMetrics.dynamicStatus;
  const activeIncidentsCount = slaMetrics.activeIncidents;
  const windowTotalIncidents = slaMetrics.totalIncidents;
  const slaCompliance = slaMetrics.resolveCompliance;
  const mttr = slaMetrics.mttr ? slaMetrics.mttr / 60 : undefined;
  const effectiveDurationDays =
    (slaMetrics.effectiveEnd.getTime() - slaMetrics.effectiveStart.getTime()) /
    (1000 * 60 * 60 * 24);
  const incidentsPerMonth =
    effectiveDurationDays > 0 ? (windowTotalIncidents / effectiveDurationDays) * 30 : 0;
  const availability = Math.max(0, Math.min(100, uptimeByService[id] ?? 100));

  const totalIncidents = totalIncidentCount;
  const totalPages = Math.ceil(totalIncidents / INCIDENTS_PER_PAGE);

  const boundUpdateService = updateService.bind(null, service.id);
  const boundDeleteService = async () => {
    'use server';
    await deleteService(service.id);
  };

  // --- TAB 1: INCIDENTS CONTENT ---
  const incidentsContent = (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            Service Incidents ({service.incidents.length})
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time and historical incident record for {service.name}.
          </p>
        </div>
        <CreateIncidentButton serviceId={id} className="gap-2" />
      </div>

      {service.incidents.length > 0 ? (
        <Card className="border-border shadow-xs overflow-hidden">
          <IncidentList
            incidents={service.incidents.map((i: any) => ({
              id: i.id,
              title: i.title,
              status: i.status,
              urgency: i.urgency,
              priority: i.priority,
              createdAt: i.createdAt,
              resolvedAt: i.resolvedAt,
              assignee: i.assignee,
              team: i.team,
            }))}
            serviceId={id}
          />
          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalIncidents}
              itemsPerPage={INCIDENTS_PER_PAGE}
            />
          )}
        </Card>
      ) : (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8 text-emerald-500" />}
          title="All systems operational"
          description="There are currently no incidents affecting this service."
          action={<CreateIncidentButton serviceId={id} />}
        />
      )}
    </div>
  );

  // --- TAB 2: ESCALATION POLICY CONTENT ---
  const escalationContent = (
    <div className="space-y-5">
      {service.policy ? (
        <Card className="border-border shadow-xs">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  <span>{service.policy.name}</span>
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {service.policy.description ||
                    'Alert notifications page through configured steps sequentially.'}
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="text-xs gap-1.5 h-8">
                <Link href={`/policies/${service.policy.id}`}>
                  <span>View Full Policy</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Escalation Step Order ({service.policy.steps?.length || 0} Steps)
              </h4>
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {service.policy.steps?.map((step: any, idx: number) => (
                  <div
                    key={step.id}
                    className="p-3.5 flex items-center justify-between gap-4 text-xs hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[11px]">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">
                          {step.targetUser?.name ||
                            step.targetTeam?.name ||
                            step.targetSchedule?.name ||
                            'Unassigned Step Target'}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Target:{' '}
                          {step.targetUser
                            ? 'User'
                            : step.targetTeam
                              ? 'Team'
                              : step.targetSchedule
                                ? 'On-Call Schedule'
                                : 'None'}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      <Clock className="h-3 w-3 mr-1" />+{step.delayMinutes}m Delay
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<ShieldAlert className="h-8 w-8 text-amber-500" />}
          title="No escalation policy attached"
          description="Attach an escalation policy so incoming alerts automatically notify on-call responders in step order."
          action={
            <Button asChild size="sm" className="text-xs">
              <Link href="?tab=settings">Configure Policy in Settings</Link>
            </Button>
          }
        />
      )}
    </div>
  );

  // --- TAB 3: INTEGRATIONS & WEBHOOKS CONTENT ---
  const integrationsContent = (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Configured Ingest Integrations ({service.integrations?.length || 0})
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect your monitoring tools, APM providers, and alert sources to trigger incidents
            automatically.
          </p>
        </div>
      </div>

      {service.integrations && service.integrations.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {service.integrations.map((integration: any) => {
            const integrationType = integration.type as IntegrationType;
            const typeInfo = INTEGRATION_TYPES.find(t => t.value === integrationType) || {
              label: integration.type,
              icon: <Webhook className="h-5 w-5 text-white" />,
              category: 'Other' as const,
              iconBg: '#475569',
            };
            const webhookUrl = canManageService
              ? getWebhookUrl(integrationType, integration.id, integration.key)
              : null;

            return (
              <Card
                key={integration.id}
                className="border-border shadow-xs flex flex-col justify-between overflow-hidden"
              >
                <CardHeader className="pb-3 border-b bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 flex items-center justify-center rounded-xl shadow-xs ring-1 ring-black/5 shrink-0"
                        style={{ backgroundColor: typeInfo.iconBg }}
                      >
                        {typeInfo.icon}
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <CardTitle className="text-sm font-bold truncate" title={integration.name}>
                          {integration.name}
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="font-mono font-medium">{typeInfo.label}</span>
                          <span>•</span>
                          <span>
                            {new Date(integration.createdAt).toLocaleDateString('en-US', {
                              timeZone: 'UTC',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <IntegrationStatusToggle
                        integrationId={integration.id}
                        serviceId={id}
                        initialEnabled={integration.enabled}
                        canManage={canManageService}
                      />
                      {canManageService && (
                        <DeleteIntegrationButton
                          action={async () => {
                            'use server';
                            await deleteIntegration(integration.id, id);
                          }}
                          integrationName={integration.name}
                          variant="icon"
                        />
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-muted/30 p-2 rounded-lg border border-border/50">
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground block mb-0.5">
                          Type
                        </span>
                        <span className="font-medium text-foreground text-xs">
                          {typeInfo.label}
                        </span>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg border border-border/50">
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground block mb-0.5">
                          Category
                        </span>
                        <span className="font-medium text-foreground text-xs">
                          {typeInfo.category}
                        </span>
                      </div>
                    </div>

                    {!canManageService ? (
                      <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                        Integration connection details are visible to service managers only.
                      </p>
                    ) : integrationType === 'EVENTS_API_V2' && webhookUrl ? (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                              Events API Endpoint
                            </Label>
                            <CopyButton text={webhookUrl} />
                          </div>
                          <Input
                            readOnly
                            value={webhookUrl}
                            className="font-mono text-xs bg-muted/40 h-8 text-ellipsis"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <Key className="h-3 w-3" /> Routing Key (Service-Bound)
                            </Label>
                            <CopyButton text={integration.key} />
                          </div>
                          <Input
                            readOnly
                            value={integration.key}
                            className="font-mono text-xs bg-muted/40 h-8"
                          />
                          <p className="text-[11px] text-muted-foreground leading-tight">
                            Pass in request header as{' '}
                            <code className="px-1 py-0.5 rounded bg-muted font-mono text-[10px] text-foreground font-medium">
                              Authorization: Token token=&lt;ROUTING_KEY&gt;
                            </code>
                          </p>
                        </div>

                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <Terminal className="h-3 w-3" /> Quick Test (Working cURL)
                            </div>
                            <CopyButton
                              text={`curl -X POST ${webhookUrl} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Token token=${integration.key}" \\\n  -d '{\n    "event_action": "trigger",\n    "dedup_key": "test-${id.substring(0, 8)}-001",\n    "payload": {\n      "summary": "${service.name} Alert Test",\n      "source": "api-client",\n      "severity": "critical"\n    }\n  }'`}
                            />
                          </div>
                          <pre className="bg-slate-950 text-slate-200 p-2.5 rounded-lg overflow-x-auto text-[10px] font-mono leading-relaxed border border-slate-800 shadow-inner select-all">
                            <span className="text-purple-400">curl</span> -X POST {webhookUrl} \
                            <br />
                            &nbsp; -H{' '}
                            <span className="text-blue-300">
                              "Content-Type: application/json"
                            </span>{' '}
                            \<br />
                            &nbsp; -H{' '}
                            <span className="text-green-400">
                              "Authorization: Token token={integration.key.substring(0, 10)}..."
                            </span>{' '}
                            \<br />
                            &nbsp; -d{' '}
                            <span className="text-yellow-400">
                              {`'{\n    "event_action": "trigger",\n    "dedup_key": "test-${id.substring(0, 8)}-001",\n    "payload": {\n      "summary": "${service.name} Alert Test",\n      "source": "api-client",\n      "severity": "critical"\n    }\n  }'`}
                            </span>
                          </pre>
                        </div>
                      </div>
                    ) : webhookUrl ? (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                              Webhook Ingest URL
                            </Label>
                            <CopyButton text={webhookUrl} />
                          </div>
                          <Input
                            readOnly
                            value={webhookUrl}
                            className="font-mono text-xs bg-muted/40 h-8 text-ellipsis"
                          />
                        </div>

                        <div className="pt-2 border-t border-dashed border-border/80">
                          <IntegrationSecretControl
                            integrationId={integration.id}
                            serviceId={id}
                            hasSecret={Boolean(integration.signatureSecret)}
                            className="w-full"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Zap className="h-8 w-8 text-primary" />}
          title="No integrations configured yet"
          description="Add a monitoring integration below to begin receiving automated alerts from CloudWatch, Datadog, Prometheus, Grafana, and more."
        />
      )}

      {/* Add New Integration Grid */}
      {canManageService && (
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3 border-b bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Add Monitoring Integration
            </CardTitle>
            <CardDescription className="text-xs">
              Choose a provider to generate a unique webhook endpoint for this service.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            <AddIntegrationGrid serviceId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );

  // --- TAB 4: SETTINGS & CHATOPS CONTENT ---
  const settingsContent = (
    <div className="space-y-6">
      {isSaved && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 p-3.5 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>Service settings updated successfully.</span>
        </div>
      )}

      {errorCode === 'duplicate-service' && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-800 p-3.5 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>A service with this name already exists. Please choose a unique name.</span>
        </div>
      )}

      {canManageService ? (
        <>
          {/* Core Service Metadata Form */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-4 border-b bg-muted/20">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                General Service Configuration
              </CardTitle>
              <CardDescription className="text-xs">
                Manage service name, SLA tier, regional placement, and team ownership.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5">
              <form action={boundUpdateService} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs font-semibold">
                      Service Name *
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      defaultValue={service.name}
                      required
                      className="text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="teamId" className="text-xs font-semibold">
                      Owning Team
                    </Label>
                    <select
                      id="teamId"
                      name="teamId"
                      defaultValue={service.teamId || ''}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">No Owning Team</option>
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-xs font-semibold">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={service.description || ''}
                    rows={2}
                    placeholder="What does this service do?"
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="escalationPolicyId" className="text-xs font-semibold">
                      Escalation Policy
                    </Label>
                    <select
                      id="escalationPolicyId"
                      name="escalationPolicyId"
                      defaultValue={service.escalationPolicyId || ''}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">No Policy Attached</option>
                      {policies.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="slaTier" className="text-xs font-semibold">
                      SLA Tier
                    </Label>
                    <select
                      id="slaTier"
                      name="slaTier"
                      defaultValue={service.slaTier || ''}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">None</option>
                      <option value="Platinum">Platinum</option>
                      <option value="Gold">Gold</option>
                      <option value="Silver">Silver</option>
                      <option value="Bronze">Bronze</option>
                      <option value="Internal">Internal</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="region" className="text-xs font-semibold">
                      Primary Region
                    </Label>
                    <Input
                      id="region"
                      name="region"
                      defaultValue={service.region || ''}
                      placeholder="e.g. us-east-1"
                      className="text-xs h-9"
                    />
                  </div>
                </div>

                {canManageService && (
                  <div className="pt-2 flex justify-end">
                    <Button type="submit" size="sm" className="text-xs">
                      Save Changes
                    </Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Default Incident Visibility Settings */}
          <ServiceVisibilitySettings
            key={`visibility-${id}`}
            serviceId={id}
            defaultIncidentVisibility={service.defaultIncidentVisibility || 'PUBLIC'}
            canManage={canManageService}
          />

          {/* Slack & ChatOps Integration Settings */}
          <ServiceNotificationSettings
            key={id}
            serviceId={id}
            serviceNotificationChannels={service.serviceNotificationChannels || []}
            slackChannel={service.slackChannel || null}
            slackWebhookUrl={service.slackWebhookUrl || null}
            slackIntegration={globalSlackIntegration}
            webhookIntegrations={(service.webhookIntegrations || []).map(
              (w: WebhookIntegration) => ({
                id: w.id,
                name: w.name,
                type: w.type,
                url: w.url || '',
                enabled: w.enabled,
              })
            )}
            serviceNotifyOnTriggered={service.serviceNotifyOnTriggered ?? true}
            serviceNotifyOnAck={service.serviceNotifyOnAck ?? true}
            serviceNotifyOnResolved={service.serviceNotifyOnResolved ?? true}
            serviceNotifyOnSlaBreach={service.serviceNotifyOnSlaBreach ?? false}
          />

          <ChatOpsWarRoomSettings
            serviceId={id}
            autoCreateWarRoom={service.autoCreateWarRoom ?? true}
            warRoomVideoBridge={service.warRoomVideoBridge || null}
            warRoomCustomBridgeUrl={service.warRoomCustomBridgeUrl || null}
            chatOpsEnabled={Boolean(chatOpsConfig?.enabled)}
            canManage={canManageService}
          />

          {/* Jira Integration Mapping */}
          <JiraServiceMappingSettings
            serviceId={id}
            mapping={service.jiraServiceMapping}
            jiraEnabled={Boolean(jiraConfig?.enabled)}
            canManage={canManageService}
          />

          {/* Danger Zone: Delete Service */}
          {canDeleteService && (
            <Card className="border-destructive/30 bg-destructive/5 shadow-xs">
              <CardHeader className="pb-3 border-b border-destructive/20">
                <CardTitle className="text-sm font-bold text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Danger Zone
                </CardTitle>
                <CardDescription className="text-xs text-destructive/80">
                  Permanently delete this service. This action cannot be undone.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-foreground">Delete {service.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Requires typing the exact service name to confirm permanent removal.
                  </p>
                </div>
                <DeleteConfirmDialog
                  title={`Delete Service ${service.name}`}
                  description={
                    <span>
                      Are you sure you want to delete <strong>{service.name}</strong>? All
                      associated webhooks and configuration will be permanently removed.
                    </span>
                  }
                  requireMatchText={service.name}
                  onConfirm={boundDeleteService}
                  trigger={
                    <Button variant="destructive" size="sm" className="text-xs shrink-0">
                      Delete Service
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Settings className="h-8 w-8 text-muted-foreground" />}
          title="Service settings are restricted"
          description="Only service managers can view or change integration and notification settings."
        />
      )}
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Services',
          href: '/services',
          current: service.name,
        }}
        tag="Service Reliability"
        title={service.name}
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Server className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        badges={
          <>
            <Badge
              variant={
                dynamicStatus === 'OPERATIONAL'
                  ? 'success'
                  : dynamicStatus === 'DEGRADED'
                    ? 'warning'
                    : 'danger'
              }
              size="xs"
              className="uppercase font-bold text-[10px] gap-1"
            >
              {dynamicStatus === 'OPERATIONAL' && <CheckCircle2 className="h-3 w-3" />}
              {dynamicStatus === 'DEGRADED' && <AlertTriangle className="h-3 w-3" />}
              {dynamicStatus === 'CRITICAL' && <XCircle className="h-3 w-3" />}
              {dynamicStatus}
            </Badge>

            {service.team && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px]"
              >
                <Users className="h-3 w-3 mr-1" />
                {service.team.name}
              </Badge>
            )}

            {service.slaTier && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px]"
              >
                {service.slaTier}
              </Badge>
            )}

            {service.region && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px]"
              >
                <Globe className="h-3 w-3 mr-1" />
                {service.region}
              </Badge>
            )}
          </>
        }
        subtitle={
          <div className="space-y-1">
            <p className="text-xs text-primary-foreground/85 leading-relaxed max-w-3xl">
              {service.description || 'No description provided for this service.'}
            </p>
            <p className="text-[11px] text-primary-foreground/70">
              30-day reliability metrics • Active incident count excludes snoozed alerts
            </p>
          </div>
        }
        stats={[
          {
            label: 'Availability',
            value: `${availability.toFixed(2)}%`,
            icon: <Activity className="h-3.5 w-3.5" />,
          },
          {
            label: 'MTTR',
            value:
              mttr !== undefined
                ? mttr < 1
                  ? `${Math.round(mttr * 60)}m`
                  : mttr < 24
                    ? `${mttr.toFixed(1)}h`
                    : `${(mttr / 24).toFixed(1)}d`
                : '-',
            icon: <Clock className="h-3.5 w-3.5" />,
          },
          {
            label: 'Incidents/mo',
            value: incidentsPerMonth < 1 ? '<1' : incidentsPerMonth.toFixed(1),
            icon: <Flame className="h-3.5 w-3.5" />,
          },
          {
            label: 'SLA Compliance',
            value: slaCompliance !== null ? `${slaCompliance.toFixed(1)}%` : '-',
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {/* Tabbed Workspace */}
      <ServiceDetailTabs
        defaultTab={activeTab}
        activeIncidentCount={activeIncidentsCount}
        integrationCount={service.integrations?.length || 0}
        incidentsContent={incidentsContent}
        escalationContent={escalationContent}
        integrationsContent={integrationsContent}
        settingsContent={settingsContent}
      />
    </main>
  );
}
