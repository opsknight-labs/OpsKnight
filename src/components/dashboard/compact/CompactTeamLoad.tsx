'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';

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
 * Gets the load indicator styling based on incident count
 */
function getLoadConfig(count: number): {
  badgeClass: string;
  barClass: string;
  label: string;
} {
  if (count >= 5) {
    return {
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
      barClass: 'bg-rose-500',
      label: 'overloaded',
    };
  }
  if (count >= 3) {
    return {
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      barClass: 'bg-amber-500',
      label: 'busy',
    };
  }
  return {
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    barClass: 'bg-emerald-500',
    label: 'normal',
  };
}

/**
 * Safely extracts initials from a name
 */
function getInitials(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
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
        className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center"
        role="status"
        aria-label="No active assignments"
      >
        <div className="text-xs text-slate-500 font-medium">No active assignments</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" role="list" aria-label="Team incident load">
      {activeAssignees.map(assignee => {
        const displayName = getDisplayName(assignee.name);
        const initials = getInitials(assignee.name);
        const config = getLoadConfig(assignee.count);

        return (
          <div
            key={assignee.id}
            className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-50/60 border border-slate-200 shadow-2xs"
            role="listitem"
            aria-label={`${displayName}: ${assignee.count} incidents, ${config.label}`}
          >
            <div className="flex items-center justify-between">
              {/* Name */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Avatar placeholder */}
                <div
                  className="w-5.5 h-5.5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700 shrink-0"
                  aria-hidden="true"
                >
                  {initials}
                </div>
                <span
                  className="text-xs font-semibold text-slate-800 whitespace-nowrap overflow-hidden overflow-ellipsis"
                  title={displayName}
                >
                  {displayName}
                </span>
              </div>
              {/* Count badge */}
              <div
                className={cn(
                  'py-0.5 px-1.5 rounded text-[10px] font-bold border tabular-nums',
                  config.badgeClass
                )}
                aria-label={`${assignee.count} incidents`}
              >
                {assignee.count}
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1 w-full bg-slate-200/80 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-300', config.barClass)}
                style={{
                  width: `${Math.min(100, (assignee.count / 5) * 100)}%`,
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
