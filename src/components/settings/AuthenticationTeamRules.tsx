'use client';
import { useId } from 'react';
import type { ProviderConfiguration } from '@/lib/auth-control/provider-config';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { UsersRound, Plus, Trash2 } from 'lucide-react';
import type { ClaimSuggestions } from './AuthenticationRoleRules';

type Rules = ProviderConfiguration['teamMapping'];

export default function AuthenticationTeamRules({
  rules,
  onChange,
  teams,
  disabled,
  suggestions = {},
}: {
  rules: Rules;
  onChange: (rules: Rules) => void;
  teams: Array<{ id: string; name: string }>;
  disabled: boolean;
  suggestions?: ClaimSuggestions;
}) {
  const listId = useId();
  const change = (index: number, update: Partial<Rules[number]>) =>
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...update } : rule)));
  const known = new Set(teams.map(team => team.id));
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <UsersRound className="h-4 w-4" />
            Team rules
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Put people on teams from their groups each time they sign in. Members added here are
            removed when they leave the group; people you add by hand are never removed.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || rules.length >= 200 || teams.length === 0}
          onClick={() =>
            onChange([
              ...rules,
              { claim: 'groups', value: '', caseSensitive: false, teamId: teams[0]?.id ?? '' },
            ])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add team rule
        </Button>
      </div>
      {teams.length === 0 && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Create a team first, then map a group to it here.
        </div>
      )}
      {teams.length > 0 && !rules.length && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No team rules. Team membership is managed by hand or by SCIM.
        </div>
      )}
      <div className="divide-y divide-border">
        {rules.map((rule, index) => (
          <div
            key={index}
            className="grid gap-3 p-4 md:grid-cols-[1fr_1.3fr_1fr_auto] md:items-start"
          >
            <datalist id={`${listId}-values-${index}`}>
              {(suggestions[rule.claim] ?? []).map(option => (
                <option key={option.value} value={option.value} />
              ))}
            </datalist>
            <label className="space-y-1 text-xs font-medium">
              Claim · team rule {index + 1}
              <Input
                disabled={disabled}
                value={rule.claim}
                onChange={event => change(index, { claim: event.target.value })}
                placeholder="groups"
                maxLength={128}
              />
            </label>
            <div className="space-y-1">
              <label className="space-y-1 text-xs font-medium block">
                Group value · team rule {index + 1}
                <Input
                  disabled={disabled}
                  value={rule.value}
                  list={`${listId}-values-${index}`}
                  onChange={event => change(index, { value: event.target.value })}
                  placeholder="platform-oncall"
                  maxLength={512}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-input"
                  disabled={disabled}
                  checked={rule.caseSensitive === true}
                  onChange={event => change(index, { caseSensitive: event.target.checked })}
                />
                Match letter case exactly
              </label>
            </div>
            <label className="space-y-1 text-xs font-medium">
              Adds to team · team rule {index + 1}
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                disabled={disabled}
                value={rule.teamId}
                aria-invalid={!known.has(rule.teamId)}
                onChange={event => change(index, { teamId: event.target.value })}
              >
                {!known.has(rule.teamId) && <option value={rule.teamId}>Deleted team</option>}
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:pt-5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove team rule ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange(rules.filter((_, position) => position !== index))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
