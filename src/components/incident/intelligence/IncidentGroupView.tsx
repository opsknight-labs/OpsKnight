import Link from 'next/link';
import { Layers } from 'lucide-react';
import type {
  IncidentGroupView as GroupView,
  GroupMember,
} from '@/lib/intelligence/incident-ux/group-view';
import { incidentStatusTone } from '@/lib/design/status-palette';
import UngroupButton from './UngroupButton';

function dotClass(member: GroupMember): string {
  if (member.kind === 'ALERT')
    return member.reversed ? 'bg-muted-foreground/40' : 'bg-muted-foreground';
  switch (incidentStatusTone(member.status)) {
    case 'critical':
      return 'bg-status-critical';
    case 'elevated':
      return 'bg-status-elevated';
    case 'ok':
      return 'bg-status-ok';
    case 'info':
      return 'bg-status-info';
    case 'shift':
      return 'bg-status-shift';
    default:
      return 'bg-muted-foreground';
  }
}

const formatOffset = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (Math.abs(minutes) < 60) return `${minutes >= 0 ? '+' : '−'}${Math.abs(minutes)} min`;
  const hours = Math.round((Math.abs(minutes) / 60) * 10) / 10;
  return `${minutes >= 0 ? '+' : '−'}${hours} h`;
};

/**
 * The storm / correlation group around an incident: a compact mini timeline of grouped incidents and alerts
 * relative to the parent's onset, each with its own "Ungroup" control when the viewer may use it.
 * Presentational: data comes from `getIncidentGroupForActor`.
 */
export default function IncidentGroupView({
  incidentId,
  group,
}: {
  incidentId: string;
  group: GroupView;
}) {
  if (group.parentHidden) {
    return (
      <section
        aria-labelledby="incident-group-heading"
        className="rounded-xl border border-border bg-card p-3.5 text-sm"
      >
        <h2 id="incident-group-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Grouped incident
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This incident is grouped under a parent incident you do not have access to.
        </p>
      </section>
    );
  }

  const onset = group.anchorOnset.getTime();
  const last = Math.max(onset, ...group.members.map(member => member.at.getTime()));
  const span = Math.max(last - onset, 60_000);
  const position = (at: Date) => Math.min(100, Math.max(0, ((at.getTime() - onset) / span) * 100));
  const incidents = group.members.filter(member => member.kind === 'INCIDENT').length;
  const alerts = group.members.length - incidents;
  const counts = [
    incidents ? `${incidents} incident${incidents === 1 ? '' : 's'}` : null,
    alerts ? `${alerts} alert${alerts === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  return (
    <section
      aria-labelledby="incident-group-heading"
      data-testid="incident-group-view"
      className="space-y-3 rounded-xl border border-border bg-card p-3.5"
    >
      <div className="space-y-1">
        <h2 id="incident-group-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {group.role === 'PARENT' ? 'Grouped under this incident' : 'Part of a group'}
        </h2>
        {group.role === 'CHILD' && group.parent ? (
          <p className="text-xs text-muted-foreground">
            Grouped under parent{' '}
            <Link
              href={`/incidents/${group.parent.id}`}
              className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
            >
              {group.parent.ref} {group.parent.title}
            </Link>
            {counts ? ` with ${counts}.` : '.'}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {counts || 'Nothing'} grouped here instead of paging separately.
          </p>
        )}
      </div>

      {group.members.length > 0 && (
        <>
          <div
            className="relative h-6 rounded-full bg-muted"
            role="img"
            aria-label={`Mini timeline: ${counts} grouped over ${formatOffset(span).slice(1)} from the parent's onset`}
          >
            <span
              className="absolute left-0 top-1/2 h-3.5 w-1 -translate-y-1/2 rounded bg-foreground"
              aria-hidden="true"
            />
            {group.members.map((member, index) => (
              <span
                key={`${member.kind}-${index}`}
                aria-hidden="true"
                className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${dotClass(member)} ${member.kind === 'INCIDENT' && member.current ? 'h-3.5 w-3.5 ring-foreground' : ''}`}
                style={{ left: `${position(member.at)}%` }}
              />
            ))}
          </div>
          <ol className="space-y-1.5" aria-label="Grouped incidents and alerts">
            {group.members.map((member, index) => (
              <li
                key={`${member.kind}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(member)}`}
                    aria-hidden="true"
                  />
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatOffset(member.at.getTime() - onset)}
                  </span>
                  {member.kind === 'INCIDENT' ? (
                    <span className="min-w-0 truncate">
                      {member.current ? (
                        <span aria-current="page" className="font-medium">
                          {member.ref} {member.title} (this incident)
                        </span>
                      ) : (
                        <Link href={`/incidents/${member.id}`} className="hover:underline">
                          {member.ref} {member.title}
                        </Link>
                      )}
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {member.status.toLowerCase()}
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 truncate">
                      <span className="sr-only">Alert: </span>
                      {member.alertId ? (
                        <Link href={`/alerts/${member.alertId}`} className="hover:underline">
                          {member.title}
                        </Link>
                      ) : (
                        member.title
                      )}
                      {member.reversed && (
                        <span className="ml-1 text-xs text-muted-foreground">· ungrouped</span>
                      )}
                    </span>
                  )}
                </div>
                {member.kind === 'ALERT' && member.ungroupable && group.canUngroupAlerts && (
                  <UngroupButton
                    incidentId={
                      group.role === 'CHILD' && group.parent ? group.parent.id : incidentId
                    }
                    target={{ type: 'decision', decisionId: member.decisionId }}
                    label="Ungroup and page"
                    confirmTitle="Ungroup this alert and page?"
                    confirmBody="The alert is released from this group and re-ingested as its own incident, which pages the on-call responder through its escalation policy. The grouping is recorded as a wrong decision."
                  />
                )}
                {member.kind === 'INCIDENT' &&
                  !member.current &&
                  group.role === 'PARENT' &&
                  group.canUngroupIncidents && (
                    <UngroupButton
                      incidentId={incidentId}
                      target={{ type: 'relationship', relationshipId: member.relationshipId }}
                      label="Ungroup"
                      confirmTitle="Remove this incident from the group?"
                      confirmBody="The incident keeps its own escalation and is no longer shown under this parent. The grouping is recorded as wrong so it is not proposed again."
                    />
                  )}
              </li>
            ))}
          </ol>
        </>
      )}
      {(group.truncated || group.hiddenMembers > 0) && (
        <p className="text-xs text-muted-foreground">
          {group.truncated ? 'Showing the first 40 of each kind. ' : ''}
          {group.hiddenMembers > 0
            ? `${group.hiddenMembers} more grouped incident${group.hiddenMembers === 1 ? '' : 's'} you cannot view.`
            : ''}
        </p>
      )}
    </section>
  );
}
