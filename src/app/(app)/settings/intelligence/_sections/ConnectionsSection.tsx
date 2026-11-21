import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  ConnectionForm,
  DeleteConnectionButton,
  TestConnectionButton,
} from '@/components/settings/ObservabilityConnectionForms';
import { Badge } from '@/components/ui/shadcn/badge';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { KIND_LABELS, capabilitySummary } from '@/lib/intelligence/connectors/contract';
import { listObservabilityConnections } from '@/lib/intelligence/connectors/service';

async function safely<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] Connections page could not load ${label}`, {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
}

/** Read-only observability connections, for the Assistant page. The caller checked `intelligence.read`. */
export default async function ConnectionsSection({ canManage }: { canManage: boolean }) {
  const [connections, teams] = await Promise.all([
    safely('connections', () => listObservabilityConnections()),
    safely('teams', () =>
      prisma.team.findMany({
        orderBy: { name: 'asc' },
        take: 200,
        select: { id: true, name: true },
      })
    ),
  ]);
  const teamNames = new Map((teams ?? []).map(team => [team.id, team.name]));

  return (
    <SettingsSection
      id="connections"
      title="Connections"
      description="Read-only connections to your metrics, logs, traces, error tracking and code hosts. When AI is on, Squire can query an enabled connection while answering (for example “did errors rise after the deploy?”). It only reads, within a window of at most 24 hours, and only for people in the allowed teams. Credentials are stored encrypted and never shown again. All connections are off until enabled; use “Test connection” to run a harmless read."
    >
      {connections === null ? (
        <p className="py-3 text-sm text-muted-foreground">Connections are unavailable right now.</p>
      ) : connections.length > 0 ? (
        <ul className="divide-y divide-border">
          {connections.map(connection => (
            <li key={connection.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {connection.name}{' '}
                    <span className="text-muted-foreground">
                      · {KIND_LABELS[connection.kind]} · {capabilitySummary(connection.kind)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Badge variant={connection.enabled ? 'default' : 'secondary'}>
                      {connection.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <Badge variant="outline">
                      {connection.allowedTeamIds.length === 0
                        ? 'All teams'
                        : connection.allowedTeamIds
                            .map(id => teamNames.get(id) ?? 'Unknown team')
                            .join(', ')}
                    </Badge>
                    {connection.allowPrivateNetwork && (
                      <Badge variant="outline">Private network</Badge>
                    )}
                  </span>
                </summary>
                <ConnectionForm connection={connection} teams={teams ?? []} canManage={canManage} />
                {canManage && (
                  <div className="flex flex-wrap items-center gap-3">
                    <TestConnectionButton id={connection.id} name={connection.name} />
                    <DeleteConnectionButton id={connection.id} name={connection.name} />
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-muted-foreground">
          No connections yet. Squire answers from OpsKnight data until you add one.
        </p>
      )}
      {canManage && (
        <details className="border-t border-border">
          <summary className="cursor-pointer py-3 text-sm font-medium">Add a connection</summary>
          <ConnectionForm teams={teams ?? []} canManage={canManage} />
        </details>
      )}
    </SettingsSection>
  );
}
