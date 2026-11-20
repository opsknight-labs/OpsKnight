'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Archive } from 'lucide-react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { saveObjective } from '@/app/(app)/settings/service-objectives/actions';
import { SearchableRunbookSelect } from '@/components/runbooks/SearchableRunbookSelect';
import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';

type Definition = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  target: number;
  comparator: string;
  windowType: string;
  windowValue: number | null;
};
export function ServiceObjectiveForm({
  objective,
  archive = false,
}: {
  objective?: Definition;
  archive?: boolean;
}) {
  const [state, action, pending] = useActionState(saveObjective, { message: '', ok: false });
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.ok && state.message) notify.success(state.message);
  }, [state]);
  const fieldClass =
    'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
  const labelClass = 'block text-sm font-medium text-foreground';
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input
        type="hidden"
        name="operation"
        value={archive ? 'archive' : objective ? 'update' : 'create'}
      />
      {objective && (
        <>
          <input type="hidden" name="id" value={objective.id} />
          <input type="hidden" name="version" value={objective.version} />
        </>
      )}
      {!archive && (
        <fieldset disabled={pending} className="space-y-3">
          {!objective && (
            <>
              <SearchableRunbookSelect
                kind="service"
                name="serviceId"
                label="Service (required for uptime and availability)"
              />
              <label className={labelClass} htmlFor={`${prefix}-metric`}>
                Measurement
              </label>
              <select className={fieldClass} id={`${prefix}-metric`} name="metricType">
                {SERVICE_OBJECTIVE_CONTRACT.metrics.map(metric => (
                  <option key={metric.id} value={metric.id}>
                    {metric.id} ({metric.unit})
                  </option>
                ))}
              </select>
            </>
          )}
          <label className={labelClass} htmlFor={`${prefix}-name`}>
            Name
          </label>
          <input
            className={fieldClass}
            id={`${prefix}-name`}
            name="name"
            required
            maxLength={100}
            defaultValue={objective?.name}
          />
          <label className={labelClass} htmlFor={`${prefix}-description`}>
            Description
          </label>
          <textarea
            className={fieldClass}
            id={`${prefix}-description`}
            name="description"
            maxLength={500}
            defaultValue={objective?.description ?? ''}
          />
          <label className={labelClass} htmlFor={`${prefix}-target`}>
            Target (percent for uptime, minutes for MTTA/MTTR)
          </label>
          <input
            className={fieldClass}
            id={`${prefix}-target`}
            name="target"
            type="number"
            min="0"
            step="any"
            required
            defaultValue={objective?.target ?? 99.9}
          />
          <label className={labelClass} htmlFor={`${prefix}-comparator`}>
            Comparison
          </label>
          <select
            className={fieldClass}
            id={`${prefix}-comparator`}
            name="comparator"
            defaultValue={objective?.comparator ?? 'GREATER_THAN_OR_EQUAL'}
          >
            <option value="GREATER_THAN_OR_EQUAL">At least</option>
            <option value="LESS_THAN_OR_EQUAL">At most</option>
          </select>
          <label className={labelClass} htmlFor={`${prefix}-window`}>
            Rolling window
          </label>
          <select
            className={fieldClass}
            id={`${prefix}-window`}
            name="windowType"
            defaultValue={objective?.windowType ?? 'THIRTY_DAYS'}
          >
            {SERVICE_OBJECTIVE_CONTRACT.windows.map(window => (
              <option key={window} value={window}>
                {window.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <label className={labelClass} htmlFor={`${prefix}-days`}>
            Days (for ROLLING DAYS only)
          </label>
          <input
            className={fieldClass}
            id={`${prefix}-days`}
            name="windowValue"
            type="number"
            min="1"
            max="3650"
            step="1"
            defaultValue={objective?.windowValue ?? 30}
          />
        </fieldset>
      )}
      {archive ? (
        <>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            loading={pending}
            className="gap-2"
            onClick={() => setConfirmArchive(true)}
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            Archive objective
          </Button>
          <DeleteConfirmDialog
            open={confirmArchive}
            onOpenChange={setConfirmArchive}
            title={`Archive "${objective?.name ?? 'objective'}"?`}
            description="The objective stops being evaluated and disappears from this list. Earlier versions and measurements stay available through the API."
            confirmText="Archive objective"
            onConfirm={() => formRef.current?.requestSubmit()}
          />
        </>
      ) : (
        <Button type="submit" size="sm" loading={pending}>
          {objective ? 'Save new version' : 'Create objective'}
        </Button>
      )}
      {state.message && !state.ok && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
