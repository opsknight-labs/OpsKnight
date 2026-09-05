'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Badge } from '@/components/ui/shadcn/badge';
import PriorityBadge from './PriorityBadge';
import { updateIncidentPriority } from '@/app/(app)/incidents/actions';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type PrioritySelectorProps = {
  incidentId: string;
  priority: string | null;
  canManage: boolean;
};

export default function PrioritySelector({
  incidentId,
  priority,
  canManage,
}: PrioritySelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Read-only view
  if (!canManage) {
    return priority ? (
      <PriorityBadge priority={priority} size="md" />
    ) : (
      <Badge variant="neutral" size="sm" className="border-dashed bg-transparent">
        Unassigned
      </Badge>
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
      <SelectTrigger
        className={cn(
          'h-7 w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden group'
        )}
      >
        <SelectValue placeholder="Priority">
          {priority ? (
            <div className="inline-flex items-center gap-1.5 cursor-pointer">
              <PriorityBadge
                priority={priority}
                size="md"
                className="transition-all group-hover:brightness-95"
              />
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-50 text-slate-500 border border-dashed border-slate-300 hover:border-slate-400 hover:text-slate-700 transition-all cursor-pointer">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-sm font-semibold">Set Priority</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[160px]">
        <SelectItem value="unassigned" className="text-muted-foreground text-xs py-2">
          Unassigned
        </SelectItem>
        <div className="h-px bg-slate-100 my-1" />
        <SelectItem value="P1">
          <PriorityBadge priority="P1" size="sm" showLabel />
        </SelectItem>
        <SelectItem value="P2">
          <PriorityBadge priority="P2" size="sm" showLabel />
        </SelectItem>
        <SelectItem value="P3">
          <PriorityBadge priority="P3" size="sm" showLabel />
        </SelectItem>
        <SelectItem value="P4">
          <PriorityBadge priority="P4" size="sm" showLabel />
        </SelectItem>
        <SelectItem value="P5">
          <PriorityBadge priority="P5" size="sm" showLabel />
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
