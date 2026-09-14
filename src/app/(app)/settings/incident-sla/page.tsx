import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { getSlaSchedulerMode } from '@/lib/incident-sla/scheduler-control';
import IncidentSlaClientView from '@/components/settings/incident-sla/IncidentSlaClientView';

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

  const viewClassificationPolicy = classificationPolicy
    ? {
        version: classificationPolicy.version,
        derivePriorityFromUrgency: classificationPolicy.derivePriorityFromUrgency,
        priorityFallbackMode:
          (classificationPolicy.priorityFallbackMode as 'INHERIT' | 'ENABLED' | 'DISABLED') ??
          'INHERIT',
        rules: classificationPolicy.rules.map(rule => ({
          matchValue: rule.matchValue as 'critical' | 'error' | 'warning' | 'info',
          priorityMode: rule.priorityMode as 'INHERIT' | 'FALLBACK' | 'SET' | 'CLEAR',
          priority: rule.priority as 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | null,
          urgencyMode: rule.urgencyMode as 'INHERIT' | 'SET' | 'DEFAULT',
          urgency: rule.urgency as 'HIGH' | 'MEDIUM' | 'LOW' | null,
        })),
      }
    : null;

  return (
    <div className="w-full">
      <IncidentSlaClientView
        policy={viewPolicy}
        classificationPolicy={viewClassificationPolicy}
        serviceCount={serviceCount}
        inheritingCount={inheritingCount}
        services={services}
        integrations={integrations.map(i => ({
          id: i.id,
          name: i.name,
          serviceId: i.serviceId ?? undefined,
        }))}
        supportHoursPolicy={{
          version: supportHoursPolicy?.version ?? 0,
          timezone: supportHoursPolicy?.timezone ?? 'UTC',
          mode:
            (supportHoursPolicy?.mode as 'INHERIT' | 'ALWAYS' | 'SCHEDULED' | undefined) ??
            'ALWAYS',
          windows:
            supportHoursPolicy?.windows.map(window => ({
              dayOfWeek: window.dayOfWeek,
              startMinute: window.startMinute,
              endMinute: window.endMinute,
            })) ?? [],
          exceptions:
            supportHoursPolicy?.exceptions.map(exception => ({
              localDate: exception.localDate.toISOString().slice(0, 10),
              available: exception.available,
              startMinute: exception.startMinute,
              endMinute: exception.endMinute,
              label: exception.label,
            })) ?? [],
        }}
        scheduler={{
          mode: (schedulerMode as 'LEGACY' | 'SHADOW' | 'INDEXED') || 'LEGACY',
          indexReady: schedulerReadinessRows[0]?.ready ?? false,
          missingHints: Number(schedulerReadinessRows[0]?.missing_hints ?? 0),
          due: Number(schedulerReadinessRows[0]?.due ?? 0),
          shadowCleanChecks: Number(schedulerHealth.consecutiveCleanChecks ?? 0),
          shadowMismatches: Number(schedulerHealth.lastShadowMismatchCount ?? 0),
        }}
      />
    </div>
  );
}
