'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { KeyRound } from 'lucide-react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import McpCopyField from '@/components/settings/mcp/McpCopyField';
import { InlineNotice } from '@/components/ui/InlineNotice';
import type { McpPatCreateResult } from '@/lib/mcp/auth/personal-tokens';

/** Plain-language copy for each expected refusal; anything else falls back to a generic line. */
export const MCP_PAT_FORM_MESSAGES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    MCP_DISABLED: 'MCP is turned off for OpsKnight.',
    MCP_PAT_DISABLED: 'An administrator turned personal access tokens off. Reload the page.',
    MCP_REAUTHENTICATION_REQUIRED:
      'Creating a token needs a recent sign-in. Confirm it is you, then create the token again.',
    MCP_INACTIVE_PRINCIPAL: 'Your account or sign-in changed. Reload the page and sign in again.',
    MCP_INVALID_NAME: 'Enter a name of up to 100 characters, for example "CI triage bot".',
    MCP_INVALID_SCOPE: 'Choose at least one of the permissions listed.',
    MCP_PAT_INVALID_EXPIRY: 'Choose one of the expiry options.',
    MCP_PAT_LIMIT_REACHED:
      'You already have the maximum number of active tokens. Revoke one you no longer use first.',
  })
);

export function mcpPatFormMessage(code: string) {
  return MCP_PAT_FORM_MESSAGES.get(code) ?? 'That did not work. Check the values and try again.';
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-disabled={pending}>
      {pending ? 'Creating…' : 'Create token'}
    </Button>
  );
}

/**
 * Create a personal access token. The token is shown once, with a copy button; it cannot be shown
 * again. Scopes and expiry are limited to what the access policy allows for this person.
 */
export default function McpPersonalTokenForm({
  action,
  scopeChoices,
  expiryChoices,
  defaultDays,
  returnPath,
}: {
  action: (form: FormData) => Promise<McpPatCreateResult>;
  scopeChoices: { scope: string; label: string }[];
  expiryChoices: number[];
  defaultDays: number;
  /** Where to come back to after confirming the sign-in. */
  returnPath: string;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [state, submit] = useActionState(
    async (_previous: McpPatCreateResult | null, form: FormData) => {
      const result = await action(form);
      if (result.ok) setLabel('');
      return result;
    },
    null
  );
  const ids = { error: useId(), label: useId(), scopes: useId(), expiry: useId() };
  const failed = state && !state.ok ? state : null;
  const fieldError = (field: 'label' | 'scopes' | 'expiresInDays') =>
    failed?.field === field ? mcpPatFormMessage(failed.code) : null;

  useEffect(() => {
    if (state?.ok) {
      notify.success('Token created', { id: 'settings:mcp:pat' });
      router.refresh();
    }
  }, [state, router]);

  return (
    <section
      aria-labelledby="mcp-pat-title"
      className="my-4 space-y-4 rounded-xl border border-border bg-card p-4 shadow-2xs md:p-5"
    >
      <div className="space-y-1">
        <h3
          id="mcp-pat-title"
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Personal access tokens
        </h3>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          For agents that cannot sign in through a browser, such as CI jobs and workflow tools. A
          token acts as you, with the permissions you choose, until it expires or is revoked.
          Changes it prepares always need another person to approve them.
        </p>
      </div>
      {state?.ok && (
        <InlineNotice tone="success" title="Copy your token now">
          <p>
            This is the only time it is shown. Store it in your agent&apos;s secret store and send
            it as <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
          <McpCopyField value={state.token} label="New personal access token" />
        </InlineNotice>
      )}
      {failed && !failed.field && (
        <div id={ids.error} role="alert" className="space-y-2 text-sm text-destructive">
          <p>{mcpPatFormMessage(failed.code)}</p>
          {failed.code === 'MCP_REAUTHENTICATION_REQUIRED' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(returnPath)}` })
              }
            >
              Confirm it&apos;s you
            </Button>
          )}
        </div>
      )}
      <form action={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-pat-label">Name</Label>
            <Input
              id="mcp-pat-label"
              name="label"
              value={label}
              onChange={event => setLabel(event.target.value)}
              required
              maxLength={100}
              placeholder="CI triage bot"
              aria-invalid={Boolean(fieldError('label'))}
              aria-describedby={fieldError('label') ? ids.label : undefined}
            />
            {fieldError('label') && (
              <p id={ids.label} role="alert" className="text-xs text-destructive">
                {fieldError('label')}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-pat-expiry">Expires after</Label>
            <select
              id="mcp-pat-expiry"
              name="expiresInDays"
              defaultValue={String(defaultDays)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-invalid={Boolean(fieldError('expiresInDays'))}
              aria-describedby={fieldError('expiresInDays') ? ids.expiry : undefined}
            >
              {expiryChoices.map(days => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
            {fieldError('expiresInDays') && (
              <p id={ids.expiry} role="alert" className="text-xs text-destructive">
                {fieldError('expiresInDays')}
              </p>
            )}
          </div>
        </div>
        <fieldset
          className="space-y-2"
          aria-invalid={Boolean(fieldError('scopes')) || undefined}
          aria-describedby={fieldError('scopes') ? ids.scopes : undefined}
        >
          <legend className="text-sm font-medium text-foreground">Permissions</legend>
          {scopeChoices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              The access policy allows no permission your role can use on a token.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {scopeChoices.map(choice => (
                <label
                  key={choice.scope}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    name="scopes"
                    value={choice.scope}
                    defaultChecked={choice.scope.endsWith(':read')}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    {choice.label}
                    <code className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                      {choice.scope}
                    </code>
                  </span>
                </label>
              ))}
            </div>
          )}
          {fieldError('scopes') && (
            <p id={ids.scopes} role="alert" className="text-xs text-destructive">
              {fieldError('scopes')}
            </p>
          )}
        </fieldset>
        <SubmitButton />
      </form>
    </section>
  );
}
