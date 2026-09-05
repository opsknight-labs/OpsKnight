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
      .slice(0, 5);
  }, [assigneeLoad]);

  if (activeAssignees.length === 0) {
    return (
      <div
        className="p-3.5 rounded-sm bg-neutral-50 border border-border text-center"
        role="status"
        aria-label="No active assignments"
      >
        <div className="text-sm text-muted-foreground font-medium">No active assignments</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" role="list" aria-label="Team incident load">
      {activeAssignees.map(assignee => {
        const displayName = getDisplayName(assignee.name);
        const loadColor = getLoadColor(assignee.count);
        const loadLabel =
          assignee.count >= 5 ? 'overloaded' : assignee.count >= 3 ? 'busy' : 'normal';

        return (
          <div
            key={assignee.id}
            className="flex flex-col gap-2 p-2.5 rounded-lg bg-white dark:bg-[#121216] border border-border hover:border-slate-300 dark:hover:border-zinc-700 shadow-2xs transition-all"
            role="listitem"
            aria-label={`${displayName}: ${assignee.count} incidents, ${loadLabel}`}
          >
            <div className="flex items-center justify-between">
              {/* Name */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <UserAvatar userId={assignee.id} name={assignee.name} size="xs" />
                <span
                  className="text-xs font-semibold text-slate-800 dark:text-zinc-200 whitespace-nowrap overflow-hidden overflow-ellipsis"
                  title={displayName}
                >
                  {displayName}
                </span>
              </div>
              {/* Count badge */}
              <div
                className="py-0.5 px-2 rounded-full text-white text-xs font-bold min-w-[20px] text-center tabular-nums shadow-2xs"
                style={{ background: loadColor }}
                aria-label={`${assignee.count} incidents`}
              >
                {assignee.count}
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
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
