'use client';

import { useActionState, useId } from 'react';
import {
  declareDependencyAction,
  removeDependencyAction,
  reviewDependencyAction,
  type DependencyActionState,
} from '@/app/(app)/settings/intelligence/response/actions';
import { Button } from '@/components/ui/shadcn/button';

const initial: DependencyActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

type ServiceOption = { id: string; name: string };
type DependencyRow = {
  id: string;
  upstreamName: string;
  downstreamName: string;
  origin: 'DECLARED' | 'OBSERVED';
  status: 'ACTIVE' | 'SUGGESTED' | 'REJECTED';
  confidence: number;
};

function Status({ state }: { state: DependencyActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
      {state.message}
    </p>
  );
}

export function DeclareDependencyForm({ services }: { services: ServiceOption[] }) {
  const [state, action, pending] = useActionState(declareDependencyAction, initial);
  const id = useId();
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <label htmlFor={`${id}-down`} className="text-sm font-medium">
          Service
        </label>
        <select id={`${id}-down`} name="downstreamServiceId" required className={fieldClass} defaultValue="">
          <option value="" disabled>
            Select a service
          </option>
          {services.map(service => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-up`} className="text-sm font-medium">
          Depends on
        </label>
        <select id={`${id}-up`} name="upstreamServiceId" required className={fieldClass} defaultValue="">
          <option value="" disabled>
            Select a service
          </option>
          {services.map(service => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add'}
      </Button>
      <div className="sm:col-span-3">
        <Status state={state} />
      </div>
    </form>
  );
}

function RowButton({
  action,
  fields,
  label,
  variant,
}: {
  action: (state: DependencyActionState, form: FormData) => Promise<DependencyActionState>;
  fields: Record<string, string>;
  label: string;
  variant?: 'outline' | 'ghost';
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant ?? 'outline'} disabled={pending}>
        {label}
      </Button>
      {state.message && !state.ok && (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function DependencyList({ dependencies, canManage }: { dependencies: DependencyRow[]; canManage: boolean }) {
  if (dependencies.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">No dependencies yet.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {dependencies.map(dependency => (
        <li key={dependency.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {dependency.downstreamName} <span className="text-muted-foreground">depends on</span> {dependency.upstreamName}
            </p>
            <p className="text-xs text-muted-foreground">
              {dependency.status === 'SUGGESTED'
                ? `Suggested from incident timing (${Math.round(dependency.confidence * 100)}% of its incidents followed one here). Not used until approved.`
                : dependency.origin === 'DECLARED'
                  ? 'Declared'
                  : 'Approved suggestion'}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {dependency.status === 'SUGGESTED' && (
                <>
                  <RowButton action={reviewDependencyAction} fields={{ id: dependency.id, decision: 'APPROVE' }} label="Approve" />
                  <RowButton action={reviewDependencyAction} fields={{ id: dependency.id, decision: 'REJECT' }} label="Reject" variant="ghost" />
                </>
              )}
              {dependency.status === 'ACTIVE' && (
                <RowButton action={removeDependencyAction} fields={{ id: dependency.id }} label="Remove" variant="ghost" />
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
