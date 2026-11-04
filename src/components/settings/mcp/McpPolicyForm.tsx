'use client';

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { notify } from '@/lib/toast';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';

/** A save either succeeds with the new revision or is refused because the policy moved on. */
export type McpPolicySaveResult =
  { ok: true; revision: number } | { ok: false; code: 'MCP_POLICY_CONFLICT'; revision: number };
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
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'conflict'>('idle');
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
      onChange={() => setStatus(previous => (previous === 'conflict' ? previous : 'idle'))}
      aria-busy={pending}
    >
      {current !== undefined && <input type="hidden" name="policyRevision" value={current} />}
      <SettingsSection
        title="Access and workload policy"
        description="What assistants may do. Every change an assistant proposes still needs an administrator to approve it in OpsKnight; administrators confirm their own."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SaveIndicator
              status={pending ? 'saving' : status === 'conflict' ? 'idle' : status}
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
        <fieldset disabled={pending} className="min-w-0">
          {children}
        </fieldset>
      </SettingsSection>
    </form>
  );
}
