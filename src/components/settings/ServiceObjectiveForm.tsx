'use client';

import { useActionState, useId } from 'react';
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
  const fieldClass = 'w-full rounded-md border border-border bg-background p-2';
  return (
    <form action={action} className="space-y-3">
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
              <label className="block" htmlFor={`${prefix}-metric`}>
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
          <label className="block" htmlFor={`${prefix}-name`}>
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
          <label className="block" htmlFor={`${prefix}-description`}>
            Description
          </label>
          <textarea
            className={fieldClass}
            id={`${prefix}-description`}
            name="description"
            maxLength={500}
            defaultValue={objective?.description ?? ''}
          />
          <label className="block" htmlFor={`${prefix}-target`}>
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
          <label className="block" htmlFor={`${prefix}-comparator`}>
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
          <label className="block" htmlFor={`${prefix}-window`}>
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
          <label className="block" htmlFor={`${prefix}-days`}>
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
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-4 py-2 disabled:opacity-50"
      >
        {pending
          ? 'Saving…'
          : archive
            ? 'Archive objective'
            : objective
              ? 'Save new version'
              : 'Create objective'}
      </button>
      {state.message && <p role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
    </form>
  );
}
