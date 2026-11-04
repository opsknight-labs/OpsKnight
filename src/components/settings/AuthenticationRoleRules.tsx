'use client';
import { useId } from 'react';
import type { ProviderConfiguration } from '@/lib/auth-control/provider-config';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Shield, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

type Rules = ProviderConfiguration['roleMapping'];
export type ClaimSuggestions = Record<string, Array<{ value: string; people: number }>>;

export const ROLE_OPTIONS: Array<{ value: Rules[number]['role']; label: string; hint: string }> = [
  { value: 'ADMIN', label: 'Administrator', hint: 'Full control, including settings and SSO' },
  { value: 'RESPONDER', label: 'Responder', hint: 'Handle incidents and on-call' },
  { value: 'AUDITOR', label: 'Auditor', hint: 'Read-only access to everything' },
  { value: 'USER', label: 'User', hint: 'Basic access' },
];

/** Claims most providers use for groups or roles; the rest come from real sign-ins. */
const COMMON_CLAIMS = ['groups', 'roles', 'realm_access.roles', 'wids'];

export default function AuthenticationRoleRules({
  rules,
  onChange,
  disabled,
  precedence = 'HIGHEST_ROLE',
  suggestions = {},
}: {
  rules: Rules;
  onChange: (rules: Rules) => void;
  disabled: boolean;
  precedence?: ProviderConfiguration['rolePrecedence'];
  suggestions?: ClaimSuggestions;
}) {
  const listId = useId();
  const ordered = precedence === 'FIRST_MATCH';
  const change = (index: number, update: Partial<Rules[number]>) =>
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...update } : rule)));
  const move = (index: number, offset: number) => {
    if (index + offset < 0 || index + offset >= rules.length) return;
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + offset, 0, rule);
    onChange(next);
  };
  const claimOptions = [...new Set([...COMMON_CLAIMS, ...Object.keys(suggestions)])];
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <datalist id={`${listId}-claims`}>
        {claimOptions.map(claim => (
          <option key={claim} value={claim} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" />
            Role rules
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {ordered
              ? 'Rules are checked from top to bottom; the first match decides the role.'
              : 'When someone matches several rules, they get the highest role.'}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || rules.length >= 100}
          onClick={() =>
            onChange([...rules, { claim: 'groups', value: '', role: 'USER', caseSensitive: false }])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>
      {!rules.length && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No role rules yet. Everyone who signs in gets the default role above. Roles that an
          administrator set by hand are never changed.
        </div>
      )}
      <div className="divide-y divide-border">
        {rules.map((rule, index) => {
          const values = suggestions[rule.claim] ?? [];
          const unseen =
            values.length > 0 &&
            rule.value.trim() &&
            !values.some(option =>
              rule.caseSensitive
                ? option.value === rule.value.trim()
                : option.value.toLowerCase() === rule.value.trim().toLowerCase()
            );
          return (
            <div
              key={index}
              className="grid gap-3 p-4 md:grid-cols-[1fr_1.3fr_160px_auto] md:items-start"
            >
              <datalist id={`${listId}-values-${index}`}>
                {values.map(option => (
                  <option
                    key={option.value}
                    value={option.value}
                    label={`${option.people} ${option.people === 1 ? 'person' : 'people'}`}
                  />
                ))}
              </datalist>
              <label className="space-y-1 text-xs font-medium">
                Claim · rule {index + 1}
                <Input
                  disabled={disabled}
                  value={rule.claim}
                  list={`${listId}-claims`}
                  onChange={event => change(index, { claim: event.target.value })}
                  placeholder="groups"
                  maxLength={128}
                />
              </label>
              <div className="space-y-1">
                <label className="space-y-1 text-xs font-medium block">
                  Group or role value · rule {index + 1}
                  <Input
                    disabled={disabled}
                    value={rule.value}
                    list={`${listId}-values-${index}`}
                    onChange={event => change(index, { value: event.target.value })}
                    placeholder="opsknight-admins"
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
                {unseen && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    No one has signed in with this value yet. Check the spelling, or that your
                    provider sends it.
                  </p>
                )}
              </div>
              <label className="space-y-1 text-xs font-medium">
                Gives role · rule {index + 1}
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={disabled}
                  value={rule.role}
                  onChange={event =>
                    change(index, { role: event.target.value as Rules[number]['role'] })
                  }
                >
                  {ROLE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-1 md:pt-5">
                {ordered && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move rule ${index + 1} up`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move rule ${index + 1} down`}
                      disabled={disabled || index === rules.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove rule ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(rules.filter((_, position) => position !== index))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
