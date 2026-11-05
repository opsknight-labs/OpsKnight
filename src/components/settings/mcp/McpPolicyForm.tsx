'use client';

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { notify } from '@/lib/toast';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { signOut } from 'next-auth/react';
import {
  MCP_REAUTHENTICATION_MESSAGE,
  MCP_REAUTHENTICATION_REQUIRED,
} from '@/lib/mcp/auth/policy-widening';

/**
 * A save succeeds with the new revision, is refused because the policy moved on, or is refused
 * because it widens access and the sign-in is not recent.
 */
export type McpPolicySaveResult =
  | { ok: true; revision: number }
  | { ok: false; code: 'MCP_POLICY_CONFLICT'; revision: number }
  | { ok: false; code: typeof MCP_REAUTHENTICATION_REQUIRED };

const settingsPath = '/settings/integrations/mcp';

/** Sign in again and come back to the settings page; the unsaved change must be made again. */
export function signInAgainForMcp() {
  void signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(settingsPath)}` });
}
export type McpPolicyAction = (form: FormData) => Promise<McpPolicySaveResult | void>;

export const MCP_POLICY_CONFLICT_MESSAGE =
  'Policy changed by another administrator. Reload to see the latest, then make your change again.';

export default function McpPolicyForm({
  action,
  revision,
  children,
}: {
  action: McpPolicyAction;
  /** The policyRevision the form was rendered from; sent with every save. */
  revision?: number;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'conflict' | 'reauth'>('idle');
  const [current, setCurrent] = useState(revision);
  const submitting = useRef(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await action(form);
        if (result && !result.ok && result.code === MCP_REAUTHENTICATION_REQUIRED) {
          setStatus('reauth');
          notify.error(MCP_REAUTHENTICATION_MESSAGE, { id: 'settings:mcp:save' });
          return;
        }
        if (result && !result.ok) {
          setStatus('conflict');
          notify.error(MCP_POLICY_CONFLICT_MESSAGE, { id: 'settings:mcp:save' });
          return;
        }
        if (result) setCurrent(result.revision);
        setStatus('saved');
        notify.success('MCP configuration saved', { id: 'settings:mcp:save' });
      } catch (error) {
        setStatus('error');
        notify.error(error, { id: 'settings:mcp:save' });
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <form
      action={action as (form: FormData) => Promise<void>}
      onSubmit={submit}
      onChange={() =>
        setStatus(previous =>
          previous === 'conflict' || previous === 'reauth' ? previous : 'idle'
        )
      }
      aria-busy={pending}
    >
      {current !== undefined && <input type="hidden" name="policyRevision" value={current} />}
      <SettingsSection
        title="Access and workload policy"
        description="What assistants may do. Every change an assistant proposes still needs an administrator to approve it in OpsKnight; administrators confirm their own."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SaveIndicator
              status={
                pending ? 'saving' : status === 'conflict' || status === 'reauth' ? 'idle' : status
              }
              error={status === 'error' ? 'Configuration was not saved. Please try again.' : null}
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save policy'}
            </Button>
          </div>
        }
      >
        {status === 'conflict' && (
          <div className="pt-4">
            <InlineNotice tone="warning" title="Not saved">
              <p>{MCP_POLICY_CONFLICT_MESSAGE}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                // A full reload: the fields are uncontrolled and must show the saved values.
                onClick={() => window.location.reload()}
              >
                Reload policy
              </Button>
            </InlineNotice>
          </div>
        )}
        {status === 'reauth' && (
          <div className="pt-4">
            <InlineNotice tone="warning" title="Sign in again to save">
              <p>{MCP_REAUTHENTICATION_MESSAGE}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={signInAgainForMcp}
              >
                Sign in again
              </Button>
            </InlineNotice>
          </div>
        )}
        <fieldset disabled={pending} className="min-w-0">
          {children}
        </fieldset>
      </SettingsSection>
    </form>
  );
}
