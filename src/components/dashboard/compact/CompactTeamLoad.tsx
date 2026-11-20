'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';

/**
 * Compact Team Load Widget
 * Shows team members with active incident assignments
 */

interface AssigneeLoad {
  id: string;
  name: string | null;
  count: number;
}

interface CompactTeamLoadProps {
  assigneeLoad: AssigneeLoad[];
}

/** Load tone by open assignments: 5+ overloaded, 3+ busy, otherwise normal. */
function getLoadTone(count: number) {
  if (count >= 5) return toneClasses('critical');
  if (count >= 3) return toneClasses('elevated');
  return toneClasses('ok');
}

/**
 * Gets display name with fallback
 */
function getDisplayName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  const trimmed = name.trim();
  return trimmed || 'Unknown';
}

/**
 * CompactTeamLoad Component
 * Displays team members and their incident load
 */
const CompactTeamLoad = memo(function CompactTeamLoad({ assigneeLoad }: CompactTeamLoadProps) {
  // Filter and validate assignees
  const activeAssignees = useMemo(() => {
    if (!Array.isArray(assigneeLoad)) return [];

    return assigneeLoad
      .filter(
        a =>
          a &&
          typeof a === 'object' &&
          a.id &&
          typeof a.count === 'number' &&
          Number.isFinite(a.count) &&
          a.count > 0
      )
      .slice(0, 10);
  }, [assigneeLoad]);

  if (activeAssignees.length === 0) {
    return (
      <div
        className="flex h-full min-h-[140px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/30 p-4 text-center"
        role="status"
        aria-label="No active assignments"
      >
        <div className="text-sm font-medium text-foreground">No active assignments</div>
        <p className="text-xs text-muted-foreground">
          Nobody is carrying open incidents right now.
        </p>
        <Link
          href="/incidents?filter=all_open"
          className="mt-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          View open incidents
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Team incident load">
      {activeAssignees.map(assignee => {
        const displayName = getDisplayName(assignee.name);
        const loadTone = getLoadTone(assignee.count);
        const loadLabel =
          assignee.count >= 5 ? 'overloaded' : assignee.count >= 3 ? 'busy' : 'normal';

        return (
          <div
            key={assignee.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5"
            role="listitem"
            aria-label={`${displayName}: ${assignee.count} incidents, ${loadLabel}`}
          >
            <div className="flex items-center justify-between">
              {/* Name */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <UserAvatar userId={assignee.id} name={assignee.name} size="xs" aria-hidden />
                <span className="truncate text-xs font-medium text-foreground" title={displayName}>
                  {displayName}
                </span>
              </div>
              {/* Count badge */}
              <div
                className={cn(
                  'min-w-5 rounded-full border px-2 py-0.5 text-center text-2xs font-semibold tabular-nums',
                  loadTone.soft
                )}
                aria-label={`${assignee.count} incidents`}
              >
                {assignee.count}
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-200',
                  loadTone.solid
                )}
                style={{ width: `${Math.min(100, (assignee.count / 5) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default CompactTeamLoad;
