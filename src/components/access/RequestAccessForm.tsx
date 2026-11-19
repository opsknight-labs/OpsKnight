'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Send, ShieldPlus, Users } from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { cn } from '@/lib/utils';
import { requestAccessAction } from '@/app/(app)/settings/access/actions';
import { roleCovers, roleLabel, type AppRole } from '@/lib/authorization';

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

function KindOption({
  checked,
  onSelect,
  icon,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring',
        checked
          ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
          : 'border-border bg-background hover:bg-muted/40'
      )}
    >
      <input
        type="radio"
        name="access-request-kind"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          checked ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

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
  // Only roles that would add something: built-in roles are not a strict ladder.
  const roleChoices = useMemo(
    () => ROLE_ORDER.filter(role => !roleCovers(currentRole, role)),
    [currentRole]
  );
  const [kind, setKind] = useState<'ORG_ROLE' | 'TEAM_MEMBERSHIP'>(
    team ? 'TEAM_MEMBERSHIP' : 'ORG_ROLE'
  );
  const [role, setRole] = useState<AppRole>(
    suggestedRole && roleChoices.includes(suggestedRole)
      ? suggestedRole
      : (roleChoices[0] ?? 'RESPONDER')
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
        className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-0.5">
          <p className="font-semibold">Request sent</p>
          <p>{sent}</p>
        </div>
      </div>
    );
  }

  const noRoleToAsk = kind === 'ORG_ROLE' && roleChoices.length === 0;
  const canSubmit =
    reason.trim().length >= 10 &&
    !pending &&
    !noRoleToAsk &&
    (kind === 'ORG_ROLE' || Boolean(selectedTeam));
  // Identity-provider managed roles can still be raised temporarily; permanent changes belong
  // in the identity provider.
  const permanentRoleBlocked = kind === 'ORG_ROLE' && !canRequestOrgRole;
  const durationChoices = permanentRoleBlocked
    ? DURATION_OPTIONS.filter(option => option.value !== 'permanent')
    : DURATION_OPTIONS;
  const effectiveDuration = permanentRoleBlocked && duration === 'permanent' ? '480' : duration;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const durationMinutes = effectiveDuration === 'permanent' ? null : Number(effectiveDuration);
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
    <form onSubmit={submit} className="space-y-5 text-left" aria-label="Request access">
      {offersTeam && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-foreground">What do you need?</legend>
          <div className={cn('grid gap-3', !compact && 'sm:grid-cols-2')}>
            <KindOption
              checked={kind === 'TEAM_MEMBERSHIP'}
              onSelect={() => setKind('TEAM_MEMBERSHIP')}
              icon={<Users className="h-4 w-4" />}
              title={team ? `Join ${team.name}` : 'Join a team'}
              description="See and work the team’s services and incidents."
            />
            <KindOption
              checked={kind === 'ORG_ROLE'}
              onSelect={() => setKind('ORG_ROLE')}
              icon={<ShieldPlus className="h-4 w-4" />}
              title="A different role"
              description="Change what you can do across OpsKnight."
            />
          </div>
        </fieldset>
      )}

      <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
        {kind === 'TEAM_MEMBERSHIP' && !team && teamChoices && (
          <div className="space-y-1.5">
            <Label htmlFor="access-team">Team</Label>
            <Select value={chosenTeamId} onValueChange={setChosenTeamId}>
              <SelectTrigger id="access-team">
                <SelectValue placeholder="Choose a team" />
              </SelectTrigger>
              <SelectContent>
                {teamChoices.map(choice => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {kind === 'ORG_ROLE' && roleChoices.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="access-role">Role</Label>
            <Select value={role} onValueChange={value => setRole(value as AppRole)}>
              <SelectTrigger id="access-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleChoices.map(choice => (
                  <SelectItem key={choice} value={choice}>
                    {roleLabel(choice)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="access-duration">For how long?</Label>
          <Select value={effectiveDuration} onValueChange={setDuration}>
            <SelectTrigger id="access-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durationChoices.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {noRoleToAsk && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Your role already includes everything the other roles allow.
          {offersTeam ? ' You can still ask to join a team.' : ''}
        </p>
      )}
      {permanentRoleBlocked && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Your role comes from your identity provider, so you can ask for temporary access here. For
          a permanent change, ask your IT team to add you to the right group.
        </p>
      )}
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
        <p
          id="access-reason-hint"
          className="flex justify-between gap-2 text-xs text-muted-foreground"
        >
          <span>At least 10 characters. Approvers see this.</span>
          <span className="tabular-nums">{reason.length}/1000</span>
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={!canSubmit} className="gap-1.5">
          <Send className="h-4 w-4" aria-hidden />
          {pending ? 'Sending…' : 'Send request'}
        </Button>
      </div>
    </form>
  );
}
