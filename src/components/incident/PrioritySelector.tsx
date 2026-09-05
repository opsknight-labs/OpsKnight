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

type PrioritySelectorProps = {
  incidentId: string;
  priority: string | null;
  canManage: boolean;
};

const PRIORITY_OPTIONS = [
  {
    key: 'P1',
    label: 'Crisis',
    icon: ShieldAlert,
    iconColor: 'text-rose-600 dark:text-rose-400',
    textColor: 'text-rose-700 dark:text-rose-400',
  },
  {
    key: 'P2',
    label: 'High',
    icon: ArrowUp,
    iconColor: 'text-amber-600 dark:text-amber-400',
    textColor: 'text-amber-700 dark:text-amber-400',
  },
  {
    key: 'P3',
    label: 'Medium',
    icon: AlertCircle,
    iconColor: 'text-orange-600 dark:text-orange-400',
    textColor: 'text-orange-700 dark:text-orange-400',
  },
  {
    key: 'P4',
    label: 'Low',
    icon: Zap,
    iconColor: 'text-blue-600 dark:text-blue-400',
    textColor: 'text-blue-700 dark:text-blue-400',
  },
  {
    key: 'P5',
    label: 'Info',
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
  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-semibold bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-200 shadow-2xs transition-all max-w-full select-none';

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
        <Activity className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-500 dark:text-zinc-400 font-medium">Unassigned</span>
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
            'hover:bg-slate-50 dark:hover:bg-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 cursor-pointer group'
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
              <Activity className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-slate-500 dark:text-zinc-400 font-medium">Set Priority</span>
            </>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 dark:text-zinc-500 transition-colors shrink-0 ml-auto" />
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
