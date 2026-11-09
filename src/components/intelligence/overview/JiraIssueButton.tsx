'use client';

import { useActionState } from 'react';
import {
  createNoisyAlertIssueAction,
  type DependencyActionState,
} from '@/app/(app)/settings/intelligence/response/actions';
import { cn } from '@/lib/utils';

const initial: DependencyActionState = { message: '', ok: false };

/** Opens a Jira issue for a noisy service through the existing alert-quality action. */
export default function JiraIssueButton({
  serviceId,
  serviceName,
  className,
}: {
  serviceId: string;
  serviceName: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState(createNoisyAlertIssueAction, initial);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="serviceId" value={serviceId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Open Jira issue for ${serviceName}`}
        className={cn(className, 'disabled:opacity-60')}
      >
        {pending ? 'Opening…' : 'Open Jira issue'}
      </button>
      <span aria-live="polite" className="basis-full text-xs">
        {state.message && (
          <span
            className={
              state.ok
                ? 'text-foreground'
                : 'text-status-critical-deep dark:text-status-critical-soft'
            }
          >
            {state.message}
          </span>
        )}
      </span>
    </form>
  );
}
