'use client';
import type { ProviderConfiguration } from '@/lib/auth-control/provider-config';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Shield, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
type Rules = ProviderConfiguration['roleMapping'];
export default function AuthenticationRoleRules({
  rules,
  onChange,
  disabled,
}: {
  rules: Rules;
  onChange: (rules: Rules) => void;
  disabled: boolean;
}) {
  const change = (index: number, update: Partial<Rules[number]>) =>
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...update } : rule)));
  const move = (index: number, offset: number) => {
    if (index + offset < 0 || index + offset >= rules.length) return;
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + offset, 0, rule);
    onChange(next);
  };
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/20 p-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" />
            Role mapping rules
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Ordered claim matches. Use a dedicated group for administrator access.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || rules.length >= 100}
          onClick={() => onChange([...rules, { claim: 'groups', value: '', role: 'USER' }])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>
      {!rules.length && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No mapped role rules. New SSO accounts use USER; existing manually managed roles retain
          their authority until explicitly mapped.
        </div>
      )}
      <div className="divide-y divide-border">
        {rules.map((rule, index) => (
          <div
            key={index}
            className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_140px_auto] md:items-end"
          >
            <label className="space-y-1 text-xs font-medium">
              Claim · rule {index + 1}
              <Input
                disabled={disabled}
                value={rule.claim}
                onChange={event => change(index, { claim: event.target.value })}
                placeholder="groups"
                maxLength={128}
              />
            </label>
            <label className="space-y-1 text-xs font-medium">
              Matching value · rule {index + 1}
              <Input
                disabled={disabled}
                value={rule.value}
                onChange={event => change(index, { value: event.target.value })}
                placeholder="opsknight-admins"
                maxLength={512}
              />
            </label>
            <label className="space-y-1 text-xs font-medium">
              Granted role · rule {index + 1}
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                disabled={disabled}
                value={rule.role}
                onChange={event =>
                  change(index, { role: event.target.value as Rules[number]['role'] })
                }
              >
                {['USER', 'RESPONDER', 'AUDITOR', 'ADMIN'].map(role => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-1">
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
        ))}
      </div>
    </div>
  );
}
