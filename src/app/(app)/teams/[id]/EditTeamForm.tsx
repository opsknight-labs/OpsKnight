'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Button } from '@/components/ui/shadcn/button';
import { Loader2, Save } from 'lucide-react';

type Member = {
  userId: string;
  role: string;
  user: {
    name: string;
  };
};

type EditTeamFormProps = {
  team: {
    id: string;
    name: string;
    description?: string | null;
    teamLeadId?: string | null;
  };
  members: Member[];
  canUpdate: boolean;
  updateTeamAction: (teamId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
};

export default function EditTeamForm({
  team,
  members,
  canUpdate,
  updateTeamAction,
}: EditTeamFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description || '');
  const [teamLeadId, setTeamLeadId] = useState(team.teamLeadId || '');

  const isDirty =
    name !== team.name ||
    description !== (team.description || '') ||
    teamLeadId !== (team.teamLeadId || '');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      return showToast('Team name is required.', 'error');
    }

    const formData = new FormData();
    formData.set('name', name.trim());
    formData.set('description', description.trim());
    formData.set('teamLeadId', teamLeadId);

    startTransition(async () => {
      try {
        const res = await updateTeamAction(team.id, formData);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast('Team settings updated successfully', 'success');
          router.refresh();
        }
      } catch {
        showToast('Failed to update team settings', 'error');
      }
    });
  };

  const handleDiscard = () => {
    setName(team.name);
    setDescription(team.description || '');
    setTeamLeadId(team.teamLeadId || '');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-xs font-medium text-foreground">
            Team Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            disabled={!canUpdate || isPending}
            className="text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="teamLeadId" className="text-xs font-medium text-foreground">
            Team Lead (Optional)
          </Label>
          <select
            id="teamLeadId"
            value={teamLeadId}
            onChange={e => setTeamLeadId(e.target.value)}
            disabled={!canUpdate || isPending}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">No team lead designated</option>
            {members.map(member => (
              <option key={member.userId} value={member.userId}>
                {member.user.name} ({member.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description" className="text-xs font-medium text-foreground">
          Mission / Description
        </Label>
        <Input
          id="description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What are this team's primary responsibilities?"
          disabled={!canUpdate || isPending}
          className="text-xs"
        />
      </div>

      {canUpdate && (
        <div className="flex items-center gap-2 pt-2">
          <Button
            type="submit"
            disabled={!isDirty || isPending}
            size="sm"
            className="gap-1.5 text-xs font-medium"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save Changes
              </>
            )}
          </Button>

          {isDirty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={isPending}
              className="text-xs"
            >
              Discard
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
