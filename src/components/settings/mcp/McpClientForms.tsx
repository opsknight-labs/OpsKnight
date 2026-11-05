'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import McpClientScopeSelector from '@/components/settings/mcp/McpClientScopeSelector';
import McpCopyField from '@/components/settings/mcp/McpCopyField';
import { InlineNotice } from '@/components/ui/InlineNotice';
import type { McpClientFormResult } from '@/app/(app)/settings/integrations/mcp/actions';

/** Plain-language copy for each expected refusal; anything else falls back to a generic line. */
export const MCP_CLIENT_FORM_MESSAGES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    MCP_INVALID_NAME: 'Enter a display name of up to 100 characters.',
    MCP_INVALID_REDIRECT:
      'Use the exact callback address: HTTPS, http on 127.0.0.1, localhost or [::1], or an app address such as cursor://anysphere.cursor-mcp/oauth/callback, with no user name, password or #fragment.',
    MCP_INVALID_SCOPE: 'Choose at least one supported permission.',
    MCP_CLIENT_NOT_FOUND: 'This assistant no longer exists. Reload the page.',
    MCP_REAUTHENTICATION_REQUIRED:
      'Adding or restoring an assistant gives it access, so confirm it is you: sign out, sign in again, then retry.',
  })
);

export function mcpClientFormMessage(code: string) {
  return MCP_CLIENT_FORM_MESSAGES.get(code) ?? 'That did not work. Check the values and try again.';
}

type ClientAction = (form: FormData) => Promise<McpClientFormResult>;

function SubmitButton({ children, pendingLabel }: { children: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * Manual client registration. Problems are shown inline on the field they concern and the typed
 * values stay in place; on success the new client_id is shown once with a copy button.
 */
export function McpRegisterClientForm({
  action,
  scopeChoices,
  defaultScopes,
}: {
  action: ClientAction;
  scopeChoices: string[];
  defaultScopes: string[];
}) {
  const router = useRouter();
  // Controlled, so a refused submission keeps what was typed (React resets uncontrolled fields).
  const [name, setName] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [deviceCodeGrant, setDeviceCodeGrant] = useState(false);
  const [state, submit] = useActionState(
    async (_previous: McpClientFormResult | null, form: FormData) => {
      const result = await action(form);
      if (result.ok) {
        setName('');
        setRedirectUri('');
      }
      return result;
    },
    null
  );
  const ids = { error: useId(), name: useId(), redirect: useId(), scopes: useId() };
  const failed = state && !state.ok ? state : null;
  const fieldError = (field: 'name' | 'redirectUri' | 'scopes') =>
    failed?.field === field ? mcpClientFormMessage(failed.code) : null;

  useEffect(() => {
    if (state?.ok) {
      notify.success('Client registered', { id: 'settings:mcp:register' });
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={submit} noValidate className="space-y-5 border-t border-border px-4 py-5 md:px-6">
      {state?.ok && (
        <InlineNotice tone="success" title="Client registered">
          <p>Configure your client with this client_id. It is also listed above.</p>
          <McpCopyField value={state.clientId} label="New client_id" />
        </InlineNotice>
      )}
      {failed && !failed.field && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {mcpClientFormMessage(failed.code)}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-client-name">Display name</Label>
          <Input
            id="mcp-client-name"
            name="name"
            value={name}
            onChange={event => setName(event.target.value)}
            required
            maxLength={100}
            aria-invalid={Boolean(fieldError('name'))}
            aria-describedby={fieldError('name') ? ids.name : undefined}
          />
          {fieldError('name') && (
            <p id={ids.name} role="alert" className="text-xs text-destructive">
              {fieldError('name')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mcp-client-redirect">Exact redirect URI</Label>
          <Input
            id="mcp-client-redirect"
            name="redirectUri"
            value={redirectUri}
            onChange={event => setRedirectUri(event.target.value)}
            type="url"
            required
            placeholder="http://127.0.0.1:8765/callback"
            aria-invalid={Boolean(fieldError('redirectUri'))}
            aria-describedby={`${ids.redirect}-help${fieldError('redirectUri') ? ` ${ids.redirect}` : ''}`}
          />
          <p id={`${ids.redirect}-help`} className="text-xs text-muted-foreground">
            HTTPS, http on 127.0.0.1, localhost or [::1], or an app address such as cursor://….
          </p>
          {fieldError('redirectUri') && (
            <p id={ids.redirect} role="alert" className="text-xs text-destructive">
              {fieldError('redirectUri')}
            </p>
          )}
        </div>
      </div>
      <div
        aria-invalid={Boolean(fieldError('scopes')) || undefined}
        aria-describedby={fieldError('scopes') ? ids.scopes : undefined}
      >
        <McpClientScopeSelector scopeChoices={scopeChoices} defaultScopes={defaultScopes} />
        {fieldError('scopes') && (
          <p id={ids.scopes} role="alert" className="mt-1.5 text-xs text-destructive">
            {fieldError('scopes')}
          </p>
        )}
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="deviceCodeGrant"
          checked={deviceCodeGrant}
          onChange={event => setDeviceCodeGrant(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          <span className="font-medium">Allow device sign-in with a code</span>
          <span className="block text-xs text-muted-foreground">
            For command-line tools and servers without a browser. Works only while Device sign-in is
            on in the access policy.
          </span>
        </span>
      </label>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Registering…">Register client</SubmitButton>
      </div>
    </form>
  );
}

function RestoreButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`Allow ${name} again`}
      className="h-8 w-full gap-1.5 px-2.5 text-xs md:w-auto"
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      {pending ? 'Allowing…' : 'Allow again'}
    </Button>
  );
}

/** "Allow again" for a revoked assistant, with success and failure feedback. */
export function McpRestoreClientButton({
  action,
  id,
  name,
}: {
  action: ClientAction;
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [state, submit] = useActionState(
    async (_previous: McpClientFormResult | null, form: FormData) => action(form),
    null
  );
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      notify.success(`${name} is allowed again`, { id: `settings:mcp:restore:${id}` });
      router.refresh();
    }
  }, [state, router, name, id]);
  return (
    <form action={submit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <RestoreButton name={name} />
      {state && !state.ok && (
        <p role="alert" className="text-xs text-destructive">
          {mcpClientFormMessage(state.code)}
        </p>
      )}
    </form>
  );
}
