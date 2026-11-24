import { EmptyState, RelativeTime } from '@/components/patterns';
import { diffAuditDetails } from '@/lib/business-services/audit-diff';

export type ActivityEntry = {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: Date;
  details: unknown;
};

const ACTION_LABEL: Record<string, string> = {
  'business_service.created': 'Created',
  'business_service.updated': 'Updated',
  'business_service.deleted': 'Deleted',
};

/** The audit trail of this business service: who changed what, with before and after for key fields. */
export default function ActivityPanel({
  entries,
  names,
}: {
  entries: readonly ActivityEntry[];
  names: ReadonlyMap<string, string>;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        variant="simple"
        size="sm"
        title="No recorded activity"
        description="Changes to this business service are listed here."
      />
    );
  }
  return (
    <ol aria-label="Activity" className="divide-y divide-border">
      {entries.map(entry => {
        const changes = diffAuditDetails(entry.details, names);
        return (
          <li key={entry.id} className="space-y-1 py-3 text-sm">
            <p>
              <span className="font-medium">
                {ACTION_LABEL[entry.action] ?? entry.action.replace(/^business_service\./, '')}
              </span>
              <span className="text-muted-foreground">
                {' '}
                by {entry.actorName ?? 'the system'} · <RelativeTime date={entry.createdAt} />
              </span>
            </p>
            {changes.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {changes.map(change => (
                  <li key={change.field}>
                    {change.label}: <span className="line-through">{change.from}</span>
                    <span className="sr-only"> changed to </span>
                    <span aria-hidden> → </span>
                    <span className="font-medium text-foreground">{change.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
