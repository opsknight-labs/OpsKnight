import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { DeclareDependencyForm, DependencyList } from '@/components/settings/DependencyManager';
import { Badge } from '@/components/ui/shadcn/badge';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { listDependencies } from '@/lib/intelligence/dependencies/service';
import { getAlertQualityLeaderboard, ALERT_QUALITY_WINDOW_DAYS, MIN_INCIDENTS_FOR_QUALITY } from '@/lib/intelligence/triage/alert-quality';

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

  const [services, dependencies, changes, quality] = await Promise.all([
    safely('services', () => prisma.service.findMany({ orderBy: { name: 'asc' }, take: 2000, select: { id: true, name: true } })),
    safely('dependencies', () => listDependencies()),
    safely('changes', () =>
      prisma.changeEvent.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 15,
        select: { id: true, kind: true, summary: true, source: true, occurredAt: true, service: { select: { name: true } } },
      })
    ),
    safely('alert quality', () => getAlertQualityLeaderboard(actor)),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dependencies, changes and alert quality</h1>
        <p className="text-sm text-muted-foreground">
          Inputs for probable-cause suggestions. Everything here is advisory: nothing pages, mutes or runs automatically.
        </p>
      </header>

      <SettingsSection
        title="Service dependencies"
        description="Used to look for causes in upstream services. Suggestions come from incident timing and are ignored until you approve them."
      >
        {canManage && services && <DeclareDependencyForm services={services} />}
        {dependencies ? <DependencyList dependencies={dependencies} canManage={canManage} /> : <p className="py-4 text-sm text-muted-foreground">Unavailable.</p>}
      </SettingsSection>

      <SettingsSection
        title="Recent changes"
        description="Deploys, config and flag changes recorded for probable-cause analysis."
      >
        <div className="space-y-2 py-3 text-sm text-muted-foreground">
          <p>
            Send changes with <code className="rounded bg-muted px-1">POST /api/integrations/changes?integrationId=…</code> using a
            generic webhook integration&apos;s key. A change belongs to that integration&apos;s service.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`{ "kind": "DEPLOY", "summary": "api v2.4.1", "version": "2.4.1",
  "source": "github-actions", "dedupKey": "run-8841", "occurredAt": "2026-01-01T12:00:00Z" }`}</pre>
        </div>
        {changes && changes.length > 0 ? (
          <ul className="divide-y divide-border">
            {changes.map(change => (
              <li key={change.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{change.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {change.service?.name ?? 'No service'} · {change.source} · {change.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                  </p>
                </div>
                <Badge variant="outline">{change.kind.replace('_', ' ').toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">No changes recorded yet.</p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Alert quality"
        description={`Services whose incidents mostly clear within minutes or are never acknowledged, over ${ALERT_QUALITY_WINDOW_DAYS} days. Needs at least ${MIN_INCIDENTS_FOR_QUALITY} incidents. Flag only: nothing is suppressed.`}
      >
        {quality && quality.length > 0 ? (
          <ul className="divide-y divide-border">
            {quality.map(row => (
              <li key={row.serviceId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{row.serviceName}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.incidents} incidents · {Math.round(row.quickResolvedRatio * 100)}% resolved within 5 min ·{' '}
                    {Math.round(row.neverAcknowledgedRatio * 100)}% never acknowledged
                  </p>
                </div>
                {row.flagged && <Badge variant="secondary">Likely noisy</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">Not enough incident history yet.</p>
        )}
      </SettingsSection>
    </div>
  );
}
