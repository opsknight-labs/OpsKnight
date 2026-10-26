'use client';

import { memo, useMemo } from 'react';
import UserAvatar from '@/components/UserAvatar';

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

/**
 * Gets the load indicator color based on incident count
 */
function getLoadColor(count: number): string {
  if (!Number.isFinite(count) || count < 0) return 'var(--text-muted)';
  if (count >= 5) return 'var(--color-error)';
  if (count >= 3) return 'var(--color-warning)';
  return 'var(--color-success)';
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
        className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center"
        role="status"
        aria-label="No active assignments"
      >
        <div className="text-xs font-medium text-muted-foreground">No active assignments</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Team incident load">
      {activeAssignees.map(assignee => {
        const displayName = getDisplayName(assignee.name);
        const loadColor = getLoadColor(assignee.count);
        const loadLabel =
          assignee.count >= 5 ? 'overloaded' : assignee.count >= 3 ? 'busy' : 'normal';

        return (
          <div
            key={assignee.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5 shadow-2xs transition-all hover:border-slate-300 dark:bg-[#121216] dark:hover:border-zinc-700"
            role="listitem"
            aria-label={`${displayName}: ${assignee.count} incidents, ${loadLabel}`}
          >
            <div className="flex items-center justify-between">
              {/* Name */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <UserAvatar userId={assignee.id} name={assignee.name} size="xs" />
                <span
                  className="truncate text-xs font-semibold text-foreground"
                  title={displayName}
                >
                  {displayName}
                </span>
              </div>
              {/* Count badge */}
              <div
                className="min-w-[20px] rounded-full px-2 py-0.5 text-center font-mono text-[11px] font-bold tabular-nums text-white shadow-2xs"
                style={{ background: loadColor }}
                aria-label={`${assignee.count} incidents`}
              >
                {assignee.count}
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (assignee.count / 5) * 100)}%`,
                  background: loadColor,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default CompactTeamLoad;
