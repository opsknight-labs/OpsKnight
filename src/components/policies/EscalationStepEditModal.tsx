'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import UserAvatar from '@/components/UserAvatar';
import { Clock, Users, Calendar, User, ShieldAlert } from 'lucide-react';

type EscalationStep = {
  id: string;
  stepOrder: number;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUserId?: string | null;
  targetTeamId?: string | null;
  targetScheduleId?: string | null;
  targetUser?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  targetTeam?: {
    id: string;
    name: string;
    teamLead?: { id: string; name: string; email: string } | null;
  } | null;
  targetSchedule?: { id: string; name: string } | null;
  notifyOnlyTeamLead: boolean;
};

type EscalationStepEditModalProps = {
  step: EscalationStep;
  isOpen: boolean;
  onClose: () => void;
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  teams: Array<{ id: string; name: string }>;
  schedules: Array<{ id: string; name: string }>;
  updateStep: (stepId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
};

const DELAY_PRESETS = [0, 5, 10, 15, 20, 30];

export default function EscalationStepEditModal({
  step,
  isOpen,
  onClose,
  users,
  teams,
  schedules,
  updateStep,
}: EscalationStepEditModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [targetType, setTargetType] = useState<'USER' | 'TEAM' | 'SCHEDULE'>(step.targetType);
  const [targetUserId, setTargetUserId] = useState<string>(
    step.targetUserId || step.targetUser?.id || users[0]?.id || ''
  );
  const [targetTeamId, setTargetTeamId] = useState<string>(
    step.targetTeamId || step.targetTeam?.id || teams[0]?.id || ''
  );
  const [targetScheduleId, setTargetScheduleId] = useState<string>(
    step.targetScheduleId || step.targetSchedule?.id || schedules[0]?.id || ''
  );
  const [delayMinutes, setDelayMinutes] = useState<number>(step.delayMinutes);
  const [notifyOnlyTeamLead, setNotifyOnlyTeamLead] = useState<boolean>(step.notifyOnlyTeamLead);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('targetType', targetType);
    if (targetType === 'USER') formData.append('targetUserId', targetUserId);
    if (targetType === 'TEAM') {
      formData.append('targetTeamId', targetTeamId);
      formData.append('notifyOnlyTeamLead', notifyOnlyTeamLead ? 'true' : 'false');
    }
    if (targetType === 'SCHEDULE') formData.append('targetScheduleId', targetScheduleId);
    formData.append('delayMinutes', String(delayMinutes));

    startTransition(async () => {
      try {
        const result = await updateStep(step.id, formData);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast(`Step ${step.stepOrder + 1} updated successfully`, 'success');
          onClose();
          router.refresh();
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to update step', 'error');
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Edit Escalation Step {step.stepOrder + 1}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Configure who gets notified at this step and the wait time before escalation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Target Type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Target Type</Label>
            <Select
              value={targetType}
              onValueChange={(val: 'USER' | 'TEAM' | 'SCHEDULE') => setTargetType(val)}
              disabled={isPending}
            >
              <SelectTrigger className="text-xs h-9">
                <SelectValue placeholder="Select target type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USER" className="text-xs">
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-blue-500" />
                    Specific User
                  </div>
                </SelectItem>
                <SelectItem value="TEAM" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-purple-500" />
                    Team
                  </div>
                </SelectItem>
                <SelectItem value="SCHEDULE" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-emerald-500" />
                    On-Call Schedule
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Target Selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              {targetType === 'USER' && 'Assignee User'}
              {targetType === 'TEAM' && 'Target Team'}
              {targetType === 'SCHEDULE' && 'Target On-Call Schedule'}
            </Label>

            {targetType === 'USER' && (
              <Select
                value={targetUserId}
                onValueChange={setTargetUserId}
                required
                disabled={isPending}
              >
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent className="max-h-[220px]">
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          userId={user.id}
                          name={user.name}
                          gender={user.gender}
                          size="xs"
                        />
                        <div className="flex flex-col text-left">
                          <span className="font-medium text-xs">{user.name}</span>
                          <span className="text-[10px] text-muted-foreground">{user.email}</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {targetType === 'TEAM' && (
              <div className="space-y-2.5">
                <Select
                  value={targetTeamId}
                  onValueChange={setTargetTeamId}
                  required
                  disabled={isPending}
                >
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map(team => (
                      <SelectItem key={team.id} value={team.id} className="text-xs">
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center space-x-2 pt-1">
                  <Checkbox
                    id="notifyOnlyTeamLead"
                    checked={notifyOnlyTeamLead}
                    onCheckedChange={checked => setNotifyOnlyTeamLead(Boolean(checked))}
                    disabled={isPending}
                  />
                  <label
                    htmlFor="notifyOnlyTeamLead"
                    className="text-xs text-muted-foreground font-normal leading-none cursor-pointer"
                  >
                    Only notify the team lead instead of all team members
                  </label>
                </div>
              </div>
            )}

            {targetType === 'SCHEDULE' && (
              <Select
                value={targetScheduleId}
                onValueChange={setTargetScheduleId}
                required
                disabled={isPending}
              >
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Select schedule" />
                </SelectTrigger>
                <SelectContent>
                  {schedules.map(schedule => (
                    <SelectItem key={schedule.id} value={schedule.id} className="text-xs">
                      {schedule.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Delay Minutes & Quick Presets */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                Wait Time (Minutes)
              </Label>
              <span className="text-[11px] font-semibold text-primary">
                {delayMinutes === 0 ? 'Immediately' : `+${delayMinutes}m wait`}
              </span>
            </div>

            <Input
              type="number"
              min="0"
              value={delayMinutes}
              onChange={e => setDelayMinutes(Math.max(0, parseInt(e.target.value) || 0))}
              required
              disabled={isPending}
              className="text-xs h-9"
            />

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DELAY_PRESETS.map(preset => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={delayMinutes === preset ? 'default' : 'outline'}
                  className="text-[11px] h-7 px-2.5 rounded-lg"
                  onClick={() => setDelayMinutes(preset)}
                >
                  {preset === 0 ? '0m (Immediate)' : `${preset}m`}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {step.stepOrder === 0
                ? 'Step 1 triggers immediately upon incident creation when set to 0m.'
                : `Responders at this step are notified after ${delayMinutes} minutes if previous steps are unacknowledged.`}
            </p>
          </div>

          <DialogFooter className="pt-3 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="text-xs h-8 font-medium"
            >
              {isPending ? 'Saving...' : 'Save Step Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
