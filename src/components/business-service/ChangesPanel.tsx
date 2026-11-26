import { ExternalLink } from 'lucide-react';
import { EmptyState, RelativeTime } from '@/components/patterns';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  listBusinessServiceChanges,
  type BusinessServiceChange,
} from '@/lib/business-services/changes';

export const CHANGES_WINDOW_DAYS = 7;

const KIND_LABEL: Record<string, string> = {
  DEPLOY: 'Deploy',
  CONFIG: 'Config',
  FEATURE_FLAG: 'Feature flag',
  INFRA: 'Infrastructure',
};

/** Recorded changes on the member services, newest first. Presentational. */
export function ChangesPanel({ changes }: { changes: readonly BusinessServiceChange[] }) {
  if (changes.length === 0)
    return (
      <EmptyState
        variant="simple"
        size="sm"
        title="No changes in the last 7 days"
        description="Deploys, config, feature-flag and infrastructure changes sent for member services are listed here."
      />
    );
  return (
    <ol aria-label="Changes" className="divide-y divide-border">
      {changes.map(change => (
        <li key={change.id} className="space-y-1 py-3 text-sm">
          <p className="font-medium text-foreground">
            {change.url ? (
              <a
                href={change.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                {change.summary}
                <ExternalLink className="h-3 w-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              change.summary
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[change.kind] ?? change.kind} on {change.serviceName} via {change.source}
            {change.version ? ` · ${change.version}` : ''} ·{' '}
            <RelativeTime date={change.occurredAt} />
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Server section: the last seven days of changes the viewer may read. */
export default async function ChangesSection({
  businessServiceId,
  actor,
}: {
  businessServiceId: string;
  actor: AuthorizationActor;
}) {
  const to = new Date();
  const from = new Date(to.getTime() - CHANGES_WINDOW_DAYS * 86_400_000);
  const changes = await listBusinessServiceChanges(businessServiceId, { from, to }, actor, 100);
  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
      <ChangesPanel changes={changes} />
    </div>
  );
}
