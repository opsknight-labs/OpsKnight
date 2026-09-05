'use client';

import Link from 'next/link';
import { memo } from 'react';
import SidebarWidget, { WIDGET_ICON_BG } from '@/components/dashboard/SidebarWidget';
import { Users, Calendar, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface OnCallShift {
  id: string;
  user: {
    name: string | null;
  };
  schedule: {
    name: string;
  };
}

interface OnCallWidgetProps {
  activeShifts: OnCallShift[];
}

/**
 * Extract initials from a name safely
 */
function getInitials(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

/**
 * Get display name safely
 */
function getDisplayName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'Unknown User';
  const trimmed = name.trim();
  return trimmed || 'Unknown User';
}

/**
 * OnCallWidget - Shows currently active on-call shifts
 * Minimal design matching Ops Pulse aesthetic
 */
const OnCallWidget = memo(function OnCallWidget({ activeShifts }: OnCallWidgetProps) {
  const router = useRouter();
  // Ensure activeShifts is always an array
  const shifts = Array.isArray(activeShifts) ? activeShifts : [];

  return (
    <SidebarWidget
      title="Who's On-Call"
      iconBg={WIDGET_ICON_BG.blue}
      icon={<Users className="w-4 h-4" />}
      actions={[
        {
          label: 'Schedules',
          onClick: () => router.push('/schedules'),
        },
      ]}
    >
      <div className="space-y-2" role="list" aria-label="Active on-call shifts">
        {shifts.length === 0 ? (
          <div className="py-6 text-center">
            <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-slate-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-xs text-slate-500 font-medium">No active shifts</p>
          </div>
        ) : (
          shifts.slice(0, 3).map(shift => {
            const userName = getDisplayName(shift.user?.name);
            const initials = getInitials(shift.user?.name);
            const scheduleName = shift.schedule?.name || 'Unknown Schedule';

            return (
              <Link
                key={shift.id}
                href={`/schedules`}
                className="group flex items-center gap-3 p-2.5 rounded-lg bg-white border border-border hover:border-slate-300 hover:bg-slate-50/60 shadow-xs transition-all"
                role="listitem"
                aria-label={`${userName} on ${scheduleName}`}
              >
                <div className="relative shrink-0">
                  <div
                    className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80 flex items-center justify-center font-bold text-xs"
                    aria-hidden="true"
                  >
                    {initials}
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white"
                    title="Active on-call"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate group-hover:text-primary transition-colors">
                    {userName}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                    <Calendar className="w-3 h-3 shrink-0 text-slate-400" />
                    <span className="truncate">{scheduleName}</span>
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all shrink-0" />
              </Link>
            );
          })
        )}
      </div>
    </SidebarWidget>
  );
});

export default OnCallWidget;
