import { Settings2 } from 'lucide-react';
import {
  ActionForm,
  ConfigureSheet,
  ConfirmAction,
  SubmitButton,
  type RunbookFormAction,
} from '@/components/runbooks/RunbookControls';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';

export const nativeSelectClassName =
  'flex h-9 w-full rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 px-3 py-1.5 text-xs font-medium shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 text-foreground cursor-pointer';

export function RunbookDetailsSheet({
  runbook,
  teams,
  action,
  archiveAction,
}: {
  runbook: {
    name: string;
    slug: string;
    description: string;
    ownerTeamId: string | null;
    tags: string[];
  };
  teams: Array<{ id: string; name: string }>;
  action: RunbookFormAction;
  archiveAction: RunbookFormAction;
}) {
  return (
    <ConfigureSheet
      title="Runbook details"
      description="Stable metadata shared by every version."
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-zinc-700/80 bg-zinc-800/80 text-slate-200 hover:bg-zinc-700 hover:text-white shadow-xs"
        >
          <Settings2 className="h-4 w-4" />
          Details
        </Button>
      }
    >
      <ActionForm action={action} className="space-y-4" successMessage="Details saved">
        <div className="space-y-2">
          <Label htmlFor="metadata-name">Name</Label>
          <Input
            id="metadata-name"
            name="name"
            defaultValue={runbook.name}
            required
            maxLength={200}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metadata-slug">Slug</Label>
          <Input
            id="metadata-slug"
            name="slug"
            defaultValue={runbook.slug}
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metadata-description">Description</Label>
          <Textarea
            id="metadata-description"
            name="description"
            defaultValue={runbook.description}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metadata-owner-team">Owner team</Label>
          <select
            id="metadata-owner-team"
            name="ownerTeamId"
            defaultValue={runbook.ownerTeamId ?? ''}
            className={nativeSelectClassName}
          >
            <option value="">No owner team</option>
            {teams.map(team => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="metadata-tags">Tags</Label>
          <Input
            id="metadata-tags"
            name="tags"
            defaultValue={runbook.tags.join(', ')}
            placeholder="database, failover, tier-1"
            aria-describedby="metadata-tags-hint"
          />
          <p id="metadata-tags-hint" className="text-xs text-muted-foreground">
            Comma-separated. Lowercase letters, numbers, dot, dash or underscore; up to 20 tags.
          </p>
        </div>
        <SubmitButton>Save details</SubmitButton>
      </ActionForm>
      <ConfirmAction
        action={archiveAction}
        title={`Archive ${runbook.name}?`}
        description="This removes the Runbook from the active library and prevents new executions. Existing execution history is retained."
        label="Archive Runbook"
      />
    </ConfigureSheet>
  );
}
