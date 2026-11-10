import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { DeclareDependencyForm, DependencyList } from '@/components/settings/DependencyManager';
import { Badge } from '@/components/ui/shadcn/badge';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { listDependencies } from '@/lib/intelligence/dependencies/service';
import { listTopologySources } from '@/lib/intelligence/dependencies/topology-sources';
import {
  AddTopologySourceForm,
  CatalogImportForm,
  TopologySourceList,
} from '@/components/settings/TopologyManager';
import {
  getAlertQualityLeaderboard,
  summarizeAlertQualityByTeam,
  ALERT_QUALITY_WINDOW_DAYS,
  MIN_INCIDENTS_FOR_QUALITY,
} from '@/lib/intelligence/triage/alert-quality';
import AlertQualityActions from '@/components/settings/AlertQualityActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function safely<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] Response settings could not load ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default async function IntelligenceResponsePage() {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const actor = await getCurrentAuthorizationActor();

  const [services, dependencies, changes, quality, sources] = await Promise.all([
    safely('services', () =>
      prisma.service.findMany({
        orderBy: { name: 'asc' },
        take: 2000,
        select: { id: true, name: true },
      })
    ),
    safely('dependencies', () => listDependencies()),
    safely('changes', () =>
      prisma.changeEvent.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 15,
        select: {
          id: true,
          kind: true,
          summary: true,
          source: true,
          occurredAt: true,
          riskScore: true,
          service: { select: { name: true } },
        },
      })
    ),
    safely('alert quality', () => getAlertQualityLeaderboard(actor)),
    safely('topology sources', () => listTopologySources()),
  ]);
  const jiraConfigured = Boolean(
    await safely('jira', () =>
      prisma.jiraConfig.findUnique({ where: { id: 'default' }, select: { enabled: true } })
    )
  );
  const teams = summarizeAlertQualityByTeam(quality ?? []);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dependencies, changes and alert quality</h1>
        <p className="text-sm text-muted-foreground">
          Inputs for probable-cause suggestions. Everything here is advisory: nothing pages, mutes
          or runs automatically.
        </p>
      </header>

      <SettingsSection
        title="Service dependencies"
        description="Used to look for causes in upstream services. Suggestions come from incident timing and are ignored until you approve them."
      >
        {canManage && services && <DeclareDependencyForm services={services} />}
        {dependencies ? (
          <DependencyList dependencies={dependencies} canManage={canManage} />
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="Dependencies unavailable"
            description="They could not be loaded. Refresh to try again."
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Import topology from Backstage"
        description="Declare dependencies from a software catalog instead of one at a time. Paste a catalog once, or add a catalog URL to keep it in sync."
      >
        {canManage && <CatalogImportForm />}
        {canManage && <AddTopologySourceForm />}
        {sources ? (
          <TopologySourceList sources={sources} canManage={canManage} />
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="Topology sources unavailable"
            description="They could not be loaded. Refresh to try again."
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Metric anomaly evidence"
        description="Optional, off by default: per-service metric queries evaluated against a seasonal baseline, as extra leads for probable causes and the incident timeline."
      >
        <p className="py-3 text-sm">
          <Link href="/settings/intelligence/response/metrics" className="hover:underline">
            Manage metric templates
          </Link>
        </p>
      </SettingsSection>

      <SettingsSection
        title="Recent changes"
        description="Deploys, config and flag changes recorded for probable-cause analysis. Native sources: Argo CD, LaunchDarkly, Unleash and HCP Terraform have their own endpoints under /api/integrations/."
      >
        <div className="space-y-2 py-3 text-sm text-muted-foreground">
          <p>
            Send changes with{' '}
            <code className="rounded bg-muted px-1">
              POST /api/integrations/changes?integrationId=…
            </code>{' '}
            using a generic webhook integration&apos;s key. A change belongs to that
            integration&apos;s service.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`{ "kind": "DEPLOY", "summary": "api v2.4.1", "version": "2.4.1",
  "source": "github-actions", "dedupKey": "run-8841", "occurredAt": "2026-01-01T12:00:00Z" }`}</pre>
        </div>
        {changes && changes.length > 0 ? (
          <ul className="divide-y divide-border">
            {changes.map(change => (
              <li
                key={change.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{change.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {change.service?.name ?? 'No service'} · {change.source} ·{' '}
                    {change.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {change.riskScore !== null && (
                    <Badge
                      variant={change.riskScore >= 0.6 ? 'secondary' : 'outline'}
                      title="Change risk from history, blast radius, timing and size. A ranking signal, not a verdict."
                    >
                      risk {Math.round(change.riskScore * 100)}%
                    </Badge>
                  )}
                  <Badge variant="outline">{change.kind.replace('_', ' ').toLowerCase()}</Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="No changes recorded yet"
            description="Deploys, flags and config changes appear here once a change webhook sends them."
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Alert quality"
        description={`Services whose incidents mostly clear within minutes or are never acknowledged, over ${ALERT_QUALITY_WINDOW_DAYS} days. Needs at least ${MIN_INCIDENTS_FOR_QUALITY} incidents. Flag only: nothing is suppressed.`}
      >
        {quality && quality.length > 0 ? (
          <div className="space-y-4">
            {teams.length > 1 && (
              <ul className="flex flex-wrap gap-2 py-2" aria-label="Alert quality by team">
                {teams.map(team => (
                  <li
                    key={team.teamId ?? 'none'}
                    className="rounded-md border border-border px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium">{team.teamName}</span> · {team.flaggedServices}/
                    {team.services} noisy · {team.incidents} incidents · noise{' '}
                    {Math.round(team.noiseScore * 100)}%
                  </li>
                ))}
              </ul>
            )}
            <ul className="divide-y divide-border">
              {quality.map(row => (
                <li key={row.serviceId} className="space-y-2 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {row.serviceName}
                        {row.teamName ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {row.teamName}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.incidents} incidents · {Math.round(row.quickResolvedRatio * 100)}%
                        resolved within 5 min · {Math.round(row.neverAcknowledgedRatio * 100)}%
                        never acknowledged · {Math.round(row.flappingRatio * 100)}% opened as
                        flapping
                      </p>
                    </div>
                    {row.flagged && <Badge variant="secondary">Likely noisy</Badge>}
                  </div>
                  {canManage && row.flagged && (
                    <AlertQualityActions
                      serviceId={row.serviceId}
                      jiraConfigured={jiraConfigured}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">Not enough incident history yet.</p>
        )}
      </SettingsSection>
    </div>
  );
}
