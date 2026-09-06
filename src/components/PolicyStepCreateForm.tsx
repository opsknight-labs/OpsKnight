'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
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
import { Plus, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import PolicyTargetCombobox from '@/components/policies/PolicyTargetCombobox';

type PolicyStepCreateFormProps = {
  policyId: string;
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  teams: Array<{ id: string; name: string }>;
  schedules: Array<{ id: string; name: string }>;
  addStep: (policyId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
};

export default function PolicyStepCreateForm({
  policyId,
  users,
  teams,
  schedules,
  addStep,
}: PolicyStepCreateFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [targetType, setTargetType] = useState<'USER' | 'TEAM' | 'SCHEDULE'>('USER');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await addStep(policyId, formData);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Escalation step added successfully', 'success');
          setShowForm(false);
          router.refresh();
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        showToast(errorMessage || 'Failed to add step', 'error');
      }
    });
  };

  if (!showForm) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed border-slate-300 text-slate-500 hover:text-slate-700 hover:border-slate-400 hover:bg-slate-50"
        onClick={() => setShowForm(true)}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add Escalation Step
      </Button>
    );
  }

  return (
    <Card className="border-2 border-primary/20 shadow-none bg-primary/5">
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold">New Escalation Step</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setShowForm(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Target Type</Label>
            <Select
              name="targetType"
              value={targetType}
              onValueChange={(val: 'USER' | 'TEAM' | 'SCHEDULE') => setTargetType(val)}
              disabled={isPending}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USER">User</SelectItem>
                <SelectItem value="TEAM">Team</SelectItem>
                <SelectItem value="SCHEDULE">Schedule (On-Call)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {targetType === 'USER' && 'Notify a specific user'}
              {targetType === 'TEAM' && 'Notify all members of a team'}
              {targetType === 'SCHEDULE' && 'Notify the user currently on-call'}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">
              {targetType === 'USER' && 'Assignee User (Searchable)'}
              {targetType === 'TEAM' && 'Target Team (Searchable)'}
              {targetType === 'SCHEDULE' && 'Target On-Call Schedule (Searchable)'}
            </Label>

            {targetType === 'USER' && (
              <PolicyTargetCombobox
                targetType="USER"
                name="targetUserId"
                users={users}
                disabled={isPending}
                required
              />
            )}

            {targetType === 'TEAM' && (
              <PolicyTargetCombobox
                targetType="TEAM"
                name="targetTeamId"
                teams={teams}
                disabled={isPending}
                required
              />
            )}

            {targetType === 'SCHEDULE' && (
              <div className="space-y-1.5">
                <PolicyTargetCombobox
                  targetType="SCHEDULE"
                  name="targetScheduleId"
                  schedules={schedules}
                  disabled={isPending}
                  required
                />
                <p className="text-[10px] text-amber-700">
                  Schedule timezone is authoritative. Changing it can shift coverage.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Delay (minutes)</Label>
            <Input
              name="delayMinutes"
              type="number"
              min="0"
              defaultValue="0"
              required
              disabled={isPending}
              className="bg-white"
            />
            <p className="text-[10px] text-muted-foreground">
              Wait time before this step is executed. Use 0 for immediate.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? 'Adding...' : 'Add Step'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowForm(false)}
              disabled={isPending}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
