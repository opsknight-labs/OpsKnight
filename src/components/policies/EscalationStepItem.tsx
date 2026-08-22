'use client';

import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  MoreHorizontal,
  Clock,
  User,
  Users,
  Calendar,
  ArrowDown,
  Trash2,
  ArrowUp,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { getDefaultAvatar } from '@/lib/avatar';

type EscalationStep = {
  id: string;
  stepOrder: number;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUser: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  targetTeam: {
    id: string;
    name: string;
    teamLead?: { id: string; name: string; email: string } | null;
  } | null;
  targetSchedule: { id: string; name: string } | null;
  notifyOnlyTeamLead: boolean;
};

type EscalationStepItemProps = {
  step: EscalationStep;
  policyId: string;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  updateStep: (stepId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  deleteStep: (stepId: string) => Promise<{ error?: string } | undefined>;
  moveStep: (stepId: string, direction: 'up' | 'down') => Promise<{ error?: string } | undefined>;
};

export default function EscalationStepItem({
  step,
  policyId,
  canManage,
  isFirst,
  isLast,
  deleteStep,
  moveStep,
}: EscalationStepItemProps) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this step?')) {
      startTransition(async () => {
        await deleteStep(step.id);
      });
    }
  };

  const handleMove = (direction: 'up' | 'down') => {
    startTransition(async () => {
      await moveStep(step.id, direction);
    });
  };

  // Helper to get target label and icon
  const getTargetInfo = () => {
    if (step.targetType === 'USER' && step.targetUser) {
      return {
        icon: <User className="h-4 w-4" />,
        label: step.targetUser.name,
        subLabel: step.targetUser.email,
        avatar:
          step.targetUser.avatarUrl ||
          getDefaultAvatar(step.targetUser.gender, step.targetUser.id || step.targetUser.name),
      };
    }
    if (step.targetType === 'TEAM' && step.targetTeam) {
      return {
        icon: <Users className="h-4 w-4" />,
        label: step.targetTeam.name,
        subLabel: step.notifyOnlyTeamLead ? 'Notify Team Lead Only' : 'Notify All Members',
        avatar: null,
      };
    }
    if (step.targetType === 'SCHEDULE' && step.targetSchedule) {
      return {
        icon: <Calendar className="h-4 w-4" />,
        label: step.targetSchedule.name,
        subLabel: 'On-Call Schedule',
        avatar: null,
      };
    }
    return {
      icon: <User className="h-4 w-4" />,
      label: 'Unknown Target',
      subLabel: '',
      avatar: null,
    };
  };

  const { icon, label, subLabel, avatar } = getTargetInfo();

  return (
    <div className="relative flex items-center gap-4">
      {/* Timeline/Connector Line */}
      {!isLast && <div className="absolute left-[26px] top-10 bottom-[-24px] w-0.5 bg-slate-200" />}

      {/* Step Number Badge */}
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold z-10 bg-white',
          'border-slate-200 text-slate-500'
        )}
      >
        {step.stepOrder + 1}
      </div>

      {/* Card Content */}
      <div
        className={cn(
          'flex-1 group relative rounded-xl border bg-white shadow-sm transition-all',
          'hover:shadow-md hover:border-slate-300',
          'border-slate-200'
        )}
      >
        <div className="flex items-center justify-between p-3.5 md:p-4">
          <div className="flex items-center gap-4">
            {/* Avatar/Icon */}
            <div className="flex-shrink-0">
              {avatar ? (
                <img
                  src={avatar}
                  alt={label}
                  className="w-10 h-10 rounded-full object-cover border border-slate-100"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                  {icon}
                </div>
              )}
            </div>

            {/* Info */}
            <div>
              <div className="text-sm font-bold text-slate-900 leading-tight">{label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{subLabel}</div>
            </div>
          </div>

          {/* Meta & Actions */}
          <div className="flex items-center gap-4">
            {/* Delay Badge */}
            {step.delayMinutes > 0 ? (
              <Badge variant="outline" className="text-slate-500 font-normal bg-slate-50">
                <Clock className="mr-1.5 h-3 w-3" />
                Wait {step.delayMinutes}m
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-emerald-600 bg-emerald-50 border-emerald-100 font-normal"
              >
                Immediately
              </Badge>
            )}

            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-full text-slate-400 hover:text-slate-600"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={isFirst || isPending}
                    onClick={() => handleMove('up')}
                  >
                    <ArrowUp className="mr-2 h-4 w-4" /> Move Up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isLast || isPending}
                    onClick={() => handleMove('down')}
                  >
                    <ArrowDown className="mr-2 h-4 w-4" /> Move Down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onClick={handleDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete Step
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
