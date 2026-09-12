import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import IncidentSlaPolicySettings from '@/components/incident-sla/IncidentSlaPolicySettings';
import IncidentClassificationSettings from '@/components/incident-sla/IncidentClassificationSettings';
import ResponsePolicyOperations from '@/components/incident-sla/ResponsePolicyOperations';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Info } from 'lucide-react';
import { getSlaSchedulerMode } from '@/lib/incident-sla/scheduler-control';

export const revalidate = 0;

export default async function IncidentSlaSettingsPage() {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated || !permissions.capabilities.includes('admin.manage'))
    redirect('/settings');
  const [
    policy,
    classificationPolicy,
    serviceCount,
    inheritingCount,
    services,
    integrations,
    supportHoursPolicy,
    schedulerMode,
    schedulerConfig,
    schedulerReadinessRows,
  ] = await Promise.all([
    prisma.incidentSlaPolicy.findFirst({
      where: { scopeKey: 'workspace', sealedAt: { not: null } },
      orderBy: { version: 'desc' },
      include: { rules: true },
    }),
    prisma.incidentClassificationPolicy.findFirst({
      where: { scopeKey: 'workspace', sealedAt: { not: null } },
      orderBy: { version: 'desc' },
      include: { rules: true },
    }),
    prisma.service.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Service" s
      LEFT JOIN (
        SELECT DISTINCT ON ("scopeKey") "scopeKey", "inheritWorkspace"
        FROM "IncidentSlaPolicy"
        WHERE "scopeKey" LIKE 'service:%' AND "sealedAt" IS NOT NULL
        ORDER BY "scopeKey", "version" DESC
      ) latest ON latest."scopeKey" = 'service:' || s."id"
      WHERE latest."scopeKey" IS NULL OR latest."inheritWorkspace" = true
    `.then(rows => Number(rows[0]?.count ?? 0)),
    prisma.service.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.integration.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, serviceId: true },
    }),
    prisma.responseSupportHoursPolicy.findFirst({
      where: { scopeKey: 'workspace', sealedAt: { not: null } },
      orderBy: { version: 'desc' },
      include: { windows: true, exceptions: true },
    }),
    getSlaSchedulerMode(),
    prisma.systemConfig.findUnique({
      where: { key: 'incident_sla_scheduler' },
      select: { value: true },
    }),
    prisma.$queryRaw<Array<{ ready: boolean; missing_hints: bigint; due: bigint }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = 'idx_incident_next_sla_transition' AND i.indisvalid
      ) AS ready,
      (SELECT COUNT(*) FROM "Incident" i JOIN "Service" s ON s."id" = i."serviceId"
        WHERE i."status" IN ('OPEN', 'ACKNOWLEDGED') AND s."serviceNotifyOnSlaBreach" = true
          AND i."nextSlaTransitionAt" IS NULL)::bigint AS missing_hints,
      (SELECT COUNT(*) FROM "Incident" i JOIN "Service" s ON s."id" = i."serviceId"
        WHERE i."status" IN ('OPEN', 'ACKNOWLEDGED') AND s."serviceNotifyOnSlaBreach" = true
          AND i."nextSlaTransitionAt" <= now())::bigint AS due
    `,
  ]);
  const schedulerHealth =
    schedulerConfig?.value &&
    typeof schedulerConfig.value === 'object' &&
    !Array.isArray(schedulerConfig.value)
      ? (schedulerConfig.value as Record<string, unknown>)
      : {};
  const viewPolicy = policy
    ? {
        version: policy.version,
        inheritWorkspace: policy.inheritWorkspace,
        baseAckTargetMs: policy.baseAckTargetMs,
        baseResolveTargetMs: policy.baseResolveTargetMs,
        rules: policy.rules.map(rule => ({
          priority: rule.priority,
          ackTargetMs: rule.ackTargetMs,
          resolveTargetMs: rule.resolveTargetMs,
          label: rule.label,
        })),
      }
    : null;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Incident Response Policy' }}
        tag="Incident governance"
        title="Incident Response Policy"
        subtitle="Define how incoming alerts are classified, paged, and measured against acknowledgement and resolution objectives."
        badges={
          <Badge className="bg-emerald-500/15 text-emerald-200">
            Active · SLA v{policy?.version ?? 0}
          </Badge>
        }
        stats={[
          {
            label: 'Fallback SLA',
            value: policy
              ? `${Math.round((policy.baseAckTargetMs ?? 0) / 60000)}m / ${Math.round((policy.baseResolveTargetMs ?? 0) / 3600000)}h`
              : 'Missing',
          },
          { label: 'Priority rules', value: `${policy?.rules.length ?? 0} / 5` },
          { label: 'Services inheriting', value: `${inheritingCount} / ${serviceCount}` },
        ]}
      />
      <div className="flex gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p>
          <strong>Changes apply to future incident contracts only.</strong> Existing incidents keep
          the targets and policy versions captured when they were created.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <strong>Priority · P1–P5</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            Optional response obligation and immutable SLA selection. Alert severity does not assign
            it unless you opt in below.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <strong>Urgency · High/Medium/Low</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            Notification intensity and quiet-hours behavior.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <strong>Alert severity</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            Provider signal normalized by the workspace classification policy.
          </p>
        </div>
      </div>
      <IncidentSlaPolicySettings scopeKey="workspace" policy={viewPolicy} canManage />
      <IncidentClassificationSettings
        policy={
          classificationPolicy
            ? {
                version: classificationPolicy.version,
                derivePriorityFromUrgency: classificationPolicy.derivePriorityFromUrgency,
                priorityFallbackMode: classificationPolicy.priorityFallbackMode as
                  | 'INHERIT'
                  | 'ENABLED'
                  | 'DISABLED',
                rules: classificationPolicy.rules.map(rule => ({
                  matchValue: rule.matchValue as 'critical' | 'error' | 'warning' | 'info',
                  priorityMode: rule.priorityMode as 'INHERIT' | 'FALLBACK' | 'SET' | 'CLEAR',
                  priority: rule.priority as 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | null,
                  urgencyMode: rule.urgencyMode as 'INHERIT' | 'SET' | 'DEFAULT',
                  urgency: rule.urgency as 'HIGH' | 'MEDIUM' | 'LOW' | null,
                })),
              }
            : null
        }
      />
      <ResponsePolicyOperations
        services={services}
        integrations={integrations}
        supportVersion={supportHoursPolicy?.version ?? 0}
        supportTimezone={supportHoursPolicy?.timezone ?? 'UTC'}
        supportMode={(supportHoursPolicy?.mode as 'ALWAYS' | 'SCHEDULED' | undefined) ?? 'ALWAYS'}
        supportWindows={
          supportHoursPolicy?.windows.map(window => ({
            dayOfWeek: window.dayOfWeek,
            startMinute: window.startMinute,
            endMinute: window.endMinute,
          })) ?? []
        }
        supportExceptions={
          supportHoursPolicy?.exceptions.map(exception => ({
            localDate: exception.localDate.toISOString().slice(0, 10),
            available: exception.available,
            startMinute: exception.startMinute,
            endMinute: exception.endMinute,
            label: exception.label,
          })) ?? []
        }
        schedulerMode={schedulerMode}
        schedulerIndexReady={schedulerReadinessRows[0]?.ready ?? false}
        schedulerMissingHints={Number(schedulerReadinessRows[0]?.missing_hints ?? 0)}
        schedulerDue={Number(schedulerReadinessRows[0]?.due ?? 0)}
        schedulerShadowCleanChecks={Number(schedulerHealth.consecutiveCleanChecks ?? 0)}
        schedulerShadowMismatches={Number(schedulerHealth.lastShadowMismatchCount ?? 0)}
      />
      <div className="rounded-lg border p-5 text-sm">
        <h2 className="font-semibold">SLA semantics</h2>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>Source recovery before the ACK deadline → acknowledgement not required.</li>
          <li>Source recovery after the ACK deadline → acknowledgement breached.</li>
          <li>Manual or unknown resolution without acknowledgement → acknowledgement breached.</li>
        </ul>
      </div>
    </div>
  );
}
