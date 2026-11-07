'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  createNoisyAlertIssueAction,
  type DependencyActionState,
} from '@/app/(app)/settings/intelligence/response/actions';
import { Button } from '@/components/ui/shadcn/button';

const initial: DependencyActionState = { message: '', ok: false };

/** One-click fixes for a noisy service: a Jira issue for the owning team and links to where thresholds live. */
export default function AlertQualityActions({
  serviceId,
  jiraConfigured,
}: {
  serviceId: string;
  jiraConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(createNoisyAlertIssueAction, initial);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/services/${serviceId}/automation`} className="text-xs underline">
        Routing &amp; severity
      </Link>
      <Link href={`/services/${serviceId}/integrations`} className="text-xs underline">
        Integrations
      </Link>
      {jiraConfigured && (
        <form action={action}>
          <input type="hidden" name="serviceId" value={serviceId} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? 'Creating…' : 'Open Jira issue'}
          </Button>
        </form>
      )}
      {state.message && (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={state.ok ? 'text-xs text-emerald-600' : 'text-xs text-destructive'}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
