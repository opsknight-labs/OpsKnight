'use client';

import { useActionState, useId } from 'react';
import {
  clearServiceOverrideAction,
  saveServicePolicyAction,
  type ServicePolicyActionState,
} from '@/app/(app)/settings/intelligence/services/actions';
import { Button } from '@/components/ui/shadcn/button';
import type { IntelligenceModeValue } from '@/lib/intelligence/contract';

const initial: ServicePolicyActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

function Status({ state }: { state: ServicePolicyActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
      {state.message}
    </p>
  );
}

export type ServicePolicyRow = {
  serviceId: string;
  serviceName: string;
  source: 'service' | 'global' | 'default';
  mode: IntelligenceModeValue;
  similarityEnabled: boolean;
  responseEnabled: boolean;
  headVersion: number;
};

export function ServicePolicyForm({ row, canManage }: { row: ServicePolicyRow; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveServicePolicyAction, initial);
  const id = useId();
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-3 py-3">
      <input type="hidden" name="serviceId" value={row.serviceId} />
      <input type="hidden" name="expectedHeadVersion" value={row.headVersion} />
      <div className="space-y-1">
        <label htmlFor={`${id}-mode`} className="text-sm font-medium">
          Mode for this service
        </label>
        <select id={`${id}-mode`} name="mode" defaultValue={row.mode} disabled={disabled} className={fieldClass}>
          <option value="OFF">Off — no analysis</option>
          <option value="SHADOW">Shadow — analyze and record only</option>
          <option value="SUGGEST">Suggest — show suggestions to responders</option>
        </select>
      </div>
      <div className="flex items-start gap-3">
        <input id={`${id}-sim`} name="similarityEnabled" type="checkbox" defaultChecked={row.similarityEnabled} disabled={disabled} className="mt-1 h-4 w-4" />
        <label htmlFor={`${id}-sim`} className="text-sm font-medium">Find similar past incidents</label>
      </div>
      <div className="flex items-start gap-3">
        <input id={`${id}-resp`} name="responseEnabled" type="checkbox" defaultChecked={row.responseEnabled} disabled={disabled} className="mt-1 h-4 w-4" />
        <label htmlFor={`${id}-resp`} className="text-sm font-medium">Suggest probable causes and runbooks</label>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">Reason (recorded in the audit log)</label>
        <input id={`${id}-reason`} name="reason" type="text" maxLength={500} disabled={disabled} className={fieldClass} />
      </div>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Publishing…' : row.source === 'service' ? 'Publish new version' : 'Create override'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export function ClearOverrideButton({ serviceId, serviceName }: { serviceId: string; serviceName: string }) {
  const [state, action, pending] = useActionState(clearServiceOverrideAction, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="serviceId" value={serviceId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label={`Use the global policy for ${serviceName}`}>
        Use global policy
      </Button>
      <Status state={state} />
    </form>
  );
}
