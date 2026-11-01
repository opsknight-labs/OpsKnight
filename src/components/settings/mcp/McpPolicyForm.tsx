'use client';

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';

export default function McpPolicyForm({
  action,
  children,
}: {
  action: (form: FormData) => Promise<void>;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const submitting = useRef(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    startTransition(async () => {
      try {
        await action(form);
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
    <form action={action} onSubmit={submit} onChange={() => setStatus('idle')} aria-busy={pending}>
      <SettingsSection
        title="Access and workload policy"
        description="What assistants may do. Every change an assistant proposes still needs an administrator to approve it in OpsKnight; administrators confirm their own."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SaveIndicator
              status={pending ? 'saving' : status}
              error={status === 'error' ? 'Configuration was not saved. Please try again.' : null}
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save policy'}
            </Button>
          </div>
        }
      >
        <fieldset disabled={pending} className="min-w-0">
          {children}
        </fieldset>
      </SettingsSection>
    </form>
  );
}
