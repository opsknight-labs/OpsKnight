'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import type { ImpactPreview } from '@/lib/business-services/impact-preview';
import {
  listTeamServicesAction,
  previewBusinessServiceImpactAction,
} from '@/app/(app)/services/business/actions';

type Option = { id: string; name: string; hint?: string | null };

export type ImpactPreviewDraft = {
  criticality: 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3' | null;
  impactMinUrgency: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  impactMaxPriority: string | null;
  memberServiceIds: string[];
};

/** The sentence under the thresholds; pure so it can be tested without the server action. */
export function previewSentence(preview: ImpactPreview): string {
  const floor = preview.truncated ? 'at least ' : '';
  if (preview.total === 0) {
    return `No incidents on the selected services in the last ${preview.windowDays} days.`;
  }
  return `With these settings, ${floor}${preview.counted} of ${floor}${preview.total} incidents on the selected services in the last ${preview.windowDays} days would count as impact.`;
}

/** Live "what would this have counted" note for the draft tier and thresholds (debounced, advisory). */
export function ImpactPreviewNote({ draft }: { draft: ImpactPreviewDraft }) {
  const key = JSON.stringify(draft);
  const [result, setResult] = useState<{ key: string; preview: ImpactPreview | null } | null>(null);
  useEffect(() => {
    if (draft.memberServiceIds.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      previewBusinessServiceImpactAction(draft)
        .then(preview => !cancelled && setResult({ key, preview }))
        .catch(() => !cancelled && setResult({ key, preview: null }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` captures every field of `draft`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = result?.key === key ? result.preview : undefined;
  const text =
    draft.memberServiceIds.length === 0
      ? 'Add technical services to preview what these settings would count.'
      : current === undefined
        ? 'Checking the last 30 days…'
        : current === null
          ? 'The preview is unavailable right now. You can still save.'
          : previewSentence(current);
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="impact-preview"
      className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">Preview. </span>
      {text}
    </p>
  );
}

/** Pick a team and add every service of it that you can see as members. */
export function TeamBulkAdd({
  teams,
  onAdd,
}: {
  teams: Option[];
  onAdd: (options: Option[]) => number;
}) {
  const [teamId, setTeamId] = useState('');
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  if (teams.length === 0) return null;
  const add = () =>
    startTransition(async () => {
      try {
        const { options, truncated } = await listTeamServicesAction(teamId);
        const added = onAdd(options);
        setMessage(
          options.length === 0
            ? 'That team has no services you can see.'
            : `Added ${added} of ${options.length} services${truncated ? ' (the first 200)' : ''}.`
        );
      } catch {
        setMessage('Could not load that team’s services.');
      }
    });
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold" id="bs-team-add-label">
        Add a whole team
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger aria-labelledby="bs-team-add-label" className="w-56 max-w-full">
            <SelectValue placeholder="Choose a team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!teamId || pending}
          onClick={add}
        >
          Add its services
        </Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
