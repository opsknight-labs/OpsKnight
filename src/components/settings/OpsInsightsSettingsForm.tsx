'use client';
/* eslint-disable security/detect-object-injection -- Keys are members of the fixed area map. */

import { useActionState, useId } from 'react';
import type { IntelligenceActionState } from '@/app/(app)/settings/intelligence/actions';
import { saveOpsInsightSwitches } from '@/app/(app)/settings/intelligence/ops-insights-actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  OPS_INSIGHT_AREA_KEYS,
  OPS_INSIGHT_AREAS,
  type OpsInsightSwitches,
} from '@/lib/intelligence/ops-insights/contract';

const initialState: IntelligenceActionState = { message: '', ok: false };

function Toggle({
  name,
  label,
  help,
  checked,
  disabled,
}: {
  name: string;
  label: string;
  help?: string;
  checked: boolean;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={checked}
        disabled={disabled}
        className="mt-1 h-4 w-4"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
    </div>
  );
}

/** Operations insights: the master switch and one switch per area. Same layout as the General form. */
export default function OpsInsightsSettingsForm({
  settings,
  canManage,
}: {
  settings: OpsInsightSwitches & { revision: number };
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveOpsInsightSwitches, initialState);
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-6 py-4">
      <input type="hidden" name="expectedRevision" value={settings.revision} />
      <Toggle
        name="opsInsightsEnabled"
        label="Compute operations insights"
        help="Once a day, in the background, OpsKnight looks at each service, policy, schedule and runbook in the areas below and stores what it notices. It only suggests: a person makes every change. Needs Intelligence to be enabled. While off, nothing is computed or shown."
        checked={settings.opsInsightsEnabled}
        disabled={disabled}
      />
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 text-sm font-medium">Areas</legend>
        {OPS_INSIGHT_AREA_KEYS.map(area => (
          <Toggle
            key={area}
            name={OPS_INSIGHT_AREAS[area].setting}
            label={OPS_INSIGHT_AREAS[area].label}
            checked={settings[OPS_INSIGHT_AREAS[area].setting]}
            disabled={disabled}
          />
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {state.message && (
          <p
            role={state.ok ? 'status' : 'alert'}
            className={
              state.ok
                ? 'text-sm text-status-ok-deep dark:text-status-ok-soft'
                : 'text-sm text-destructive'
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
