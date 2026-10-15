'use client';

import { useActionState, useState } from 'react';
import {
  revokeAgentAction,
  createAgentEnrollmentAction,
  type AgentEnrollmentState,
} from '@/app/(app)/runbooks/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import AgentSetupInstructions from './AgentSetupInstructions';
import { ConfirmAction } from './RunbookControls';
import type { AgentDistribution } from '@/lib/runbooks/distribution-contract';
import { formatDateTime } from '@/lib/timezone';

const initialState: AgentEnrollmentState = {};

export default function AgentEnrollmentForm({
  userTimeZone,
  appUrl,
  distribution,
}: {
  userTimeZone: string;
  appUrl?: string;
  distribution?: AgentDistribution | null;
}) {
  const [state, action, pending] = useActionState(createAgentEnrollmentAction, initialState);
  const [cancelledAgentId, setCancelledAgentId] = useState<string>();
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Agent name</Label>
          <Input id="agent-name" name="name" required placeholder="prod-payments-01" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-hostname">Hostname hint (optional)</Label>
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
      {cancelledAgentId === state.agentId && cancelledAgentId && (
        <p role="status" className="text-sm">
          Enrollment revoked. Create a new enrollment before installing.
        </p>
      )}
      {state.token && state.agentId !== cancelledAgentId && (
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
          <ConfirmAction
            action={async () => {
              await revokeAgentAction(state.agentId!);
              setCancelledAgentId(state.agentId);
            }}
            label="Cancel this enrollment"
            title="Revoke this Agent enrollment?"
            description="This token and Agent identity can no longer enroll or authenticate. Create a new enrollment to install another Agent."
          />
          <AgentSetupInstructions
            agentId={state.agentId!}
            token={state.token}
            executionPublicKey={state.executionPublicKey!}
            appUrl={appUrl}
            distribution={distribution}
            expiresAt={state.expiresAt}
          />
        </div>
      )}
    </div>
  );
}
