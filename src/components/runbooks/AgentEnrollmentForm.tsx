'use client';

import { useActionState } from 'react';
import {
  createAgentEnrollmentAction,
  type AgentEnrollmentState,
} from '@/app/(app)/runbooks/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import AgentSetupInstructions from './AgentSetupInstructions';
import { formatDateTime } from '@/lib/timezone';

const initialState: AgentEnrollmentState = {};

export default function AgentEnrollmentForm({
  userTimeZone,
  appUrl,
}: {
  userTimeZone: string;
  appUrl?: string;
}) {
  const [state, action, pending] = useActionState(createAgentEnrollmentAction, initialState);
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Agent name</Label>
          <Input id="agent-name" name="name" required placeholder="prod-payments-01" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-hostname">Expected hostname</Label>
          <Input id="agent-hostname" name="hostname" placeholder="payments-01.internal" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create enrollment'}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.token && (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">Copy this one-time token now</p>
            <code className="mt-2 block break-all rounded bg-background p-3 text-xs select-all">
              {state.token}
            </code>
            <p className="mt-2 text-xs">
              Agent ID: {state.agentId}. Expires at{' '}
              {formatDateTime(state.expiresAt!, userTimeZone, { format: 'datetime' })}. The token
              cannot be displayed again.
            </p>
          </div>
          <AgentSetupInstructions
            token={state.token}
            executionPublicKey={state.executionPublicKey!}
            appUrl={appUrl}
          />
        </div>
      )}
    </div>
  );
}
