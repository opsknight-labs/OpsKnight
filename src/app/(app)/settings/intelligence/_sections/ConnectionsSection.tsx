import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  ConnectionForm,
  DeleteConnectionButton,
  TestConnectionButton,
} from '@/components/settings/ObservabilityConnectionForms';
import { Badge } from '@/components/ui/shadcn/badge';
import EmptyState from '@/components/patterns/EmptyState';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import { ChevronRight, Plug, Plus } from 'lucide-react';
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
      description="Read-only connections to your metrics, logs, traces, error tracking and code hosts that Squire can query while answering."
    >
      <LearnMore className="pt-3">
        <p>
          When AI is on, Squire can query an enabled connection while answering (for example “did
          errors rise after the deploy?”). It only reads, within a window of at most 24 hours, and
          only for people in the allowed teams.
        </p>
        <p>
          Credentials are stored encrypted and never shown again. All connections are off until
          enabled; use “Test connection” to run a harmless read.
        </p>
      </LearnMore>
      {connections === null ? (
        <EmptyState
          size="sm"
          variant="simple"
          title="Connections unavailable"
          description="They could not be loaded. Refresh to try again."
        />
      ) : connections.length > 0 ? (
        <ul className="my-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {connections.map(connection => (
            <li key={connection.id}>
              <details className="group/connection">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open/connection:rotate-90 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words">
                      {connection.name}{' '}
                      <span className="font-normal text-muted-foreground">
                        · {KIND_LABELS[connection.kind]} · {capabilitySummary(connection.kind)}
                      </span>
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
                <div className="space-y-3 border-t border-border bg-muted/20 px-3 pb-4">
                  <ConnectionForm
                    connection={connection}
                    teams={teams ?? []}
                    canManage={canManage}
                  />
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-3">
                      <TestConnectionButton id={connection.id} name={connection.name} />
                      <DeleteConnectionButton id={connection.id} name={connection.name} />
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          variant="simple"
          icon={<Plug aria-hidden="true" />}
          title="No connections yet"
          description={
            canManage
              ? 'Squire answers from OpsKnight data until you add one below.'
              : 'Squire answers from OpsKnight data until someone adds one.'
          }
        />
      )}
      {canManage && (
        <details className="-mx-4 border-t border-border px-4 md:-mx-6 md:px-6">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Add a connection
          </summary>
          <ConnectionForm teams={teams ?? []} canManage={canManage} />
        </details>
      )}
    </SettingsSection>
  );
}
