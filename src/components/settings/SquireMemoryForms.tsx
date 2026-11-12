'use client';

import { useActionState, useId, useState } from 'react';
import {
  removeServiceFactAction,
  saveSquireMemorySettingsAction,
  saveSquireServicePolicyAction,
  type SquireMemoryActionState,
} from '@/app/(app)/settings/intelligence/ai/memory/actions';
import { Button } from '@/components/ui/shadcn/button';

const initial: SquireMemoryActionState = { message: '', ok: false };

function Status({ state }: { state: SquireMemoryActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}
    >
      {state.message}
    </p>
  );
}

export function KnowledgeSwitchForm({
  enabled,
  revision,
  canManage,
}: {
  enabled: boolean;
  revision: number;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveSquireMemorySettingsAction, initial);
  const id = useId();
  return (
    <form action={action} className="space-y-3 py-3">
      <input type="hidden" name="expectedRevision" value={revision} />
      <label htmlFor={`${id}-knowledge`} className="flex items-start gap-2 text-sm">
        <input
          id={`${id}-knowledge`}
          type="checkbox"
          name="knowledgeEnabled"
          defaultChecked={enabled}
          disabled={!canManage || pending}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Build Squire’s knowledge index</span>
          <span className="block text-muted-foreground">
            Postmortems, resolution notes, incident notes and runbook steps become searchable by
            Squire, always filtered by what the person asking may read. Credentials are removed
            before anything is stored. Turning this off removes the derived index; confirmed service
            facts are kept until someone removes them.
          </span>
        </span>
      </label>
      {canManage && (
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
      <Status state={state} />
    </form>
  );
}

export type ProactivePolicyRow = {
  serviceId: string;
  briefingEnabled: boolean;
  nudgeAfterMinutes: number | null;
  postmortemDraftEnabled: boolean;
  revision: number;
};

export function ProactivePolicyForm({
  row,
  canManage,
}: {
  row: ProactivePolicyRow;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveSquireServicePolicyAction, initial);
  const [nudge, setNudge] = useState(row.nudgeAfterMinutes !== null);
  const id = useId();
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-3 py-3">
      <input type="hidden" name="serviceId" value={row.serviceId} />
      <input type="hidden" name="expectedRevision" value={row.revision} />
      <label htmlFor={`${id}-briefing`} className="flex items-start gap-2 text-sm">
        <input
          id={`${id}-briefing`}
          type="checkbox"
          name="briefingEnabled"
          defaultChecked={row.briefingEnabled}
          disabled={disabled}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Briefing when an incident opens</span>
          <span className="block text-muted-foreground">
            After the first analysis, Squire adds a briefing to the incident page: a summary,
            similar incidents, a likely change and a suggested runbook.
          </span>
        </span>
      </label>
      <div className="space-y-1">
        <label htmlFor={`${id}-nudge`} className="flex items-start gap-2 text-sm">
          <input
            id={`${id}-nudge`}
            type="checkbox"
            name="nudgeEnabled"
            checked={nudge}
            onChange={event => setNudge(event.target.checked)}
            disabled={disabled}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Stakeholder-update nudge</span>
            <span className="block text-muted-foreground">
              Reminds responders, with a draft update, when an open incident has had no note or
              status-page update for a while.
            </span>
          </span>
        </label>
        <label htmlFor={`${id}-minutes`} className="ml-6 flex items-center gap-2 text-sm">
          After
          <input
            id={`${id}-minutes`}
            type="number"
            name="nudgeAfterMinutes"
            min={5}
            max={1440}
            defaultValue={row.nudgeAfterMinutes ?? 30}
            disabled={disabled || !nudge}
            className="w-20 rounded-md border border-border bg-background p-1 text-sm"
          />
          minutes without an update
        </label>
      </div>
      <label htmlFor={`${id}-draft`} className="flex items-start gap-2 text-sm">
        <input
          id={`${id}-draft`}
          type="checkbox"
          name="postmortemDraftEnabled"
          defaultChecked={row.postmortemDraftEnabled}
          disabled={disabled}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Postmortem draft on resolve</span>
          <span className="block text-muted-foreground">
            A draft shown on the incident page for the team to review. It is never published or
            saved as a postmortem on its own.
          </span>
        </span>
      </label>
      {canManage && (
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
      <Status state={state} />
    </form>
  );
}

export function RemoveFactButton({ serviceId, factId }: { serviceId: string; factId: string }) {
  const [state, action, pending] = useActionState(removeServiceFactAction, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="factId" value={factId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      <Status state={state} />
    </form>
  );
}
