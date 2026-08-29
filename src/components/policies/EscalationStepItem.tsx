'use client';

import { useState, useTransition } from 'react';
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
  Edit2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { useToast } from '@/hooks/use-product-notification';
import UserAvatar from '@/components/UserAvatar';
import EscalationStepEditModal from './EscalationStepEditModal';

type EscalationStep = {
  id: string;
  stepOrder: number;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUserId?: string | null;
  targetTeamId?: string | null;
  targetScheduleId?: string | null;
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
  users?: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  teams?: Array<{ id: string; name: string }>;
  schedules?: Array<{ id: string; name: string }>;
};

export default function EscalationStepItem({
  step,
  policyId: _policyId,
  canManage,
  isFirst,
  isLast,
  updateStep,
  deleteStep,
  moveStep,
  users = [],
  teams = [],
  schedules = [],
}: EscalationStepItemProps) {
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { showToast } = useToast();

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this step?')) {
      startTransition(async () => {
        const res = await deleteStep(step.id);
        if (res?.error) {
          showToast(res.error, 'error');
        }
      });
    }
  };

  const handleMove = (direction: 'up' | 'down') => {
    startTransition(async () => {
      const res = await moveStep(step.id, direction);
      if (res?.error) {
        showToast(res.error, 'error');
      }
    });
  };

  // Helper to get target label and icon
  const getTargetInfo = () => {
    if (step.targetType === 'USER' && step.targetUser) {
      return {
        icon: <User className="h-4 w-4" />,
        label: step.targetUser.name,
        subLabel: step.targetUser.email,
      };
    }
    if (step.targetType === 'TEAM' && step.targetTeam) {
      return {
        icon: <Users className="h-4 w-4" />,
        label: step.targetTeam.name,
        subLabel: step.notifyOnlyTeamLead ? 'Notify Team Lead Only' : 'Notify All Members',
      };
    }
    if (step.targetType === 'SCHEDULE' && step.targetSchedule) {
      return {
        icon: <Calendar className="h-4 w-4" />,
        label: step.targetSchedule.name,
        subLabel: 'On-Call Schedule',
      };
    }
    return {
      icon: <Clock className="h-4 w-4" />,
      label: 'Unknown Target',
      subLabel: 'Configuration error',
    };
  };

  const { icon, label, subLabel } = getTargetInfo();

  return (
    <>
      <div className="flex items-start gap-4">
        {/* Step Number Circle */}
        <div
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center font-bold text-sm bg-white shadow-xs z-10',
            step.stepOrder === 0 ? 'border-primary text-primary' : 'border-slate-300 text-slate-600'
          )}
        >
          {step.stepOrder + 1}
        </div>

        {/* Card Content */}
        <div
          className={cn(
            'flex-1 group relative rounded-xl border bg-white shadow-xs transition-all',
            'hover:shadow-md hover:border-slate-300',
            'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between p-3.5 md:p-4">
            <div className="flex items-center gap-4">
              {/* Avatar/Icon */}
              <div className="flex-shrink-0">
                {step.targetType === 'USER' && step.targetUser ? (
                  <UserAvatar
                    userId={step.targetUser.id}
                    name={step.targetUser.name}
                    avatarUrl={step.targetUser.avatarUrl}
                    gender={step.targetUser.gender}
                    size="md"
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
                <Badge
                  variant="outline"
                  className={cn(
                    'text-slate-600 font-normal bg-slate-50 border-slate-200',
                    canManage && 'cursor-pointer hover:bg-slate-100 transition-colors'
                  )}
                  onClick={() => canManage && setIsEditOpen(true)}
                  title={canManage ? 'Click to edit step delay' : undefined}
                >
                  <Clock className="mr-1.5 h-3 w-3 text-slate-400" />
                  Wait {step.delayMinutes}m
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-emerald-700 bg-emerald-50 border-emerald-200 font-medium',
                    canManage && 'cursor-pointer hover:bg-emerald-100/70 transition-colors'
                  )}
                  onClick={() => canManage && setIsEditOpen(true)}
                  title={canManage ? 'Click to edit step delay' : undefined}
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
                    <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                      <Edit2 className="mr-2 h-4 w-4" /> Edit Step
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
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

      {/* Edit Modal */}
      {isEditOpen && (
        <EscalationStepEditModal
          step={step}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          users={users}
          teams={teams}
          schedules={schedules}
          updateStep={updateStep}
        />
      )}
    </>
  );
}
