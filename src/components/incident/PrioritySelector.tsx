'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/shadcn/select';
import { updateIncidentPriority } from '@/app/(app)/incidents/actions';
import {
  ShieldAlert,
  ArrowUp,
  AlertCircle,
  Zap,
  Info,
  ChevronDown,
  Activity,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { INCIDENT_PRIORITY_DEFINITIONS } from '@/lib/incidents/priority';

type PrioritySelectorProps = {
  incidentId: string;
  priority: string | null;
  canManage: boolean;
};

const PRIORITY_OPTIONS = [
  {
    key: 'P1',
    label: INCIDENT_PRIORITY_DEFINITIONS.P1.label,
    icon: ShieldAlert,
    iconColor: 'text-rose-600 dark:text-rose-400',
    textColor: 'text-rose-700 dark:text-rose-400',
  },
  {
    key: 'P2',
    label: INCIDENT_PRIORITY_DEFINITIONS.P2.label,
    icon: ArrowUp,
    iconColor: 'text-amber-600 dark:text-amber-400',
    textColor: 'text-amber-700 dark:text-amber-400',
  },
  {
    key: 'P3',
    label: INCIDENT_PRIORITY_DEFINITIONS.P3.label,
    icon: AlertCircle,
    iconColor: 'text-orange-600 dark:text-orange-400',
    textColor: 'text-orange-700 dark:text-orange-400',
  },
  {
    key: 'P4',
    label: INCIDENT_PRIORITY_DEFINITIONS.P4.label,
    icon: Zap,
    iconColor: 'text-blue-600 dark:text-blue-400',
    textColor: 'text-blue-700 dark:text-blue-400',
  },
  {
    key: 'P5',
    label: INCIDENT_PRIORITY_DEFINITIONS.P5.label,
    icon: Info,
    iconColor: 'text-slate-500 dark:text-slate-400',
    textColor: 'text-slate-700 dark:text-slate-400',
  },
] as const;

function getPriorityItem(priority: string | null | undefined) {
  if (!priority) return null;
  return PRIORITY_OPTIONS.find(opt => opt.key === priority) || null;
}

const SELECTOR_BASE_CLASS =
  'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold bg-background border border-border/80 text-foreground shadow-2xs transition-all max-w-full select-none';

export default function PrioritySelector({
  incidentId,
  priority,
  canManage,
}: PrioritySelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const currentItem = getPriorityItem(priority);

  // Read-only view
  if (!canManage) {
    if (currentItem && priority) {
      const Icon = currentItem.icon;
      return (
        <div className={cn(SELECTOR_BASE_CLASS, 'cursor-default')}>
          <Icon className={cn('h-3.5 w-3.5 shrink-0', currentItem.iconColor)} />
          <span className="truncate">
            {priority} · {currentItem.label}
          </span>
        </div>
      );
    }
    return (
      <div className={cn(SELECTOR_BASE_CLASS, 'cursor-default')}>
        <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground font-medium">Unassigned</span>
      </div>
    );
  }

  return (
    <Select
      value={priority || 'unassigned'}
      onValueChange={val => {
        startTransition(async () => {
          await updateIncidentPriority(incidentId, val === 'unassigned' ? null : val);
          router.refresh();
        });
      }}
      disabled={isPending}
    >
      <SelectTrigger className="h-auto w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden group">
        <div
          className={cn(
            SELECTOR_BASE_CLASS,
            'hover:bg-muted/40 hover:border-border cursor-pointer group'
          )}
        >
          {currentItem && priority ? (
            <>
              <currentItem.icon className={cn('h-3.5 w-3.5 shrink-0', currentItem.iconColor)} />
              <span className="truncate">
                {priority} · {currentItem.label}
              </span>
            </>
          ) : (
            <>
              <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium">Set Priority</span>
            </>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-auto" />
        </div>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[160px]">
        <SelectItem value="unassigned" className="cursor-pointer">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>Unassigned</span>
          </div>
        </SelectItem>
        <SelectSeparator />
        {PRIORITY_OPTIONS.map(opt => {
          const Icon = opt.icon;
          return (
            <SelectItem key={opt.key} value={opt.key} className="cursor-pointer">
              <div className={cn('flex items-center gap-2 text-xs font-semibold', opt.textColor)}>
                <Icon className={cn('h-3.5 w-3.5 shrink-0', opt.iconColor)} />
                <span>
                  {opt.key} · {opt.label}
                </span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
