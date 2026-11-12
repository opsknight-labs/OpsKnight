'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Send } from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { requestAccessAction } from '@/app/(app)/settings/access/actions';
import { roleLabel, type AppRole } from '@/lib/authorization';

export const DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
  { value: '480', label: '8 hours' },
  { value: '1440', label: '1 day' },
  { value: '4320', label: '3 days' },
  { value: '10080', label: '7 days' },
  { value: 'permanent', label: 'Permanently' },
];

const ROLE_ORDER: AppRole[] = ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN'];

type Props = {
  originPath?: string;
  requiredCapability?: string;
  currentRole?: AppRole;
  suggestedRole?: AppRole | null;
  /** When present, the request asks to join this team (resource-level denial). */
  team?: { id: string; name: string } | null;
  /** Teams the person may ask to join (My access page). */
  teamChoices?: { id: string; name: string }[];
  canRequestOrgRole: boolean;
  onDone?: () => void;
  compact?: boolean;
};

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function RequestAccessForm({
  originPath,
  requiredCapability,
  currentRole,
  suggestedRole,
  team,
  teamChoices,
  canRequestOrgRole,
  onDone,
  compact,
}: Props) {
  const roleChoices = useMemo(() => ROLE_ORDER.filter(role => role !== currentRole), [currentRole]);
  const [kind, setKind] = useState<'ORG_ROLE' | 'TEAM_MEMBERSHIP'>(
    team ? 'TEAM_MEMBERSHIP' : 'ORG_ROLE'
  );
  const [role, setRole] = useState<AppRole>(
    suggestedRole && suggestedRole !== currentRole ? suggestedRole : (roleChoices[0] ?? 'RESPONDER')
  );
  const [duration, setDuration] = useState('480');
  const [chosenTeamId, setChosenTeamId] = useState(team?.id ?? teamChoices?.[0]?.id ?? '');
  const selectedTeam = team ?? teamChoices?.find(choice => choice.id === chosenTeamId) ?? null;
  const offersTeam = Boolean(team || (teamChoices && teamChoices.length > 0));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{sent}</span>
      </div>
    );
  }

  const canSubmit =
    reason.trim().length >= 10 && !pending && (kind === 'ORG_ROLE' || Boolean(selectedTeam));
  const orgRoleBlocked = kind === 'ORG_ROLE' && !canRequestOrgRole;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const durationMinutes = duration === 'permanent' ? null : Number(duration);
    startTransition(async () => {
      const result = await requestAccessAction(
        kind === 'ORG_ROLE'
          ? {
              kind,
              requestedRole: role,
              reason,
              durationMinutes,
              originPath,
              requiredCapability,
            }
          : {
              kind,
              teamId: selectedTeam!.id,
              requestedTeamRole: 'MEMBER',
              reason,
              durationMinutes,
              originPath,
              requiredCapability,
            }
      );
      if (result.ok) {
        setSent(result.message ?? 'Request sent.');
        onDone?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left" aria-label="Request access">
      {offersTeam && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">What do you need?</legend>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <input
                type="radio"
                name="kind"
                checked={kind === 'TEAM_MEMBERSHIP'}
                onChange={() => setKind('TEAM_MEMBERSHIP')}
              />
              {team ? `Join ${team.name}` : 'Join a team'}
            </label>
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <input
                type="radio"
                name="kind"
                checked={kind === 'ORG_ROLE'}
                onChange={() => setKind('ORG_ROLE')}
              />
              A different role
            </label>
          </div>
        </fieldset>
      )}

      <div className={compact ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
        {kind === 'TEAM_MEMBERSHIP' && !team && teamChoices && (
          <div className="space-y-1.5">
            <Label htmlFor="access-team">Team</Label>
            <select
              id="access-team"
              className={selectClass}
              value={chosenTeamId}
              onChange={event => setChosenTeamId(event.target.value)}
            >
              {teamChoices.map(choice => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'ORG_ROLE' && (
          <div className="space-y-1.5">
            <Label htmlFor="access-role">Role</Label>
            <select
              id="access-role"
              className={selectClass}
              value={role}
              onChange={event => setRole(event.target.value as AppRole)}
              disabled={orgRoleBlocked}
            >
              {roleChoices.map(choice => (
                <option key={choice} value={choice}>
                  {roleLabel(choice)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="access-duration">For how long?</Label>
          <select
            id="access-duration"
            className={selectClass}
            value={duration}
            onChange={event => setDuration(event.target.value)}
          >
            {DURATION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {orgRoleBlocked ? (
        <p className="text-sm text-muted-foreground">
          Your role is managed by your identity provider. Ask your IT team to add you to the right
          group.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="access-reason">Why do you need it?</Label>
            <Textarea
              id="access-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="For example: I'm on call this week and need to acknowledge payments incidents."
              rows={3}
              maxLength={1000}
              aria-describedby="access-reason-hint"
            />
            <p id="access-reason-hint" className="text-xs text-muted-foreground">
              At least 10 characters. Approvers see this.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <Button type="submit" size="sm" disabled={!canSubmit} className="gap-1.5">
            <Send className="h-3.5 w-3.5" aria-hidden />
            {pending ? 'Sending…' : 'Send request'}
          </Button>
        </>
      )}
    </form>
  );
}
