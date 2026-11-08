'use client';

import { useActionState, useId } from 'react';
import {
  saveAiRoutingAction,
  type AiRoutingActionState,
} from '@/app/(app)/settings/intelligence/ai/routing-actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  CAPABILITY_ROUTE_LABELS,
  ROUTABLE_CAPABILITIES,
  type CapabilityRouting,
} from '@/lib/intelligence/ai/routing';

const initial: AiRoutingActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

export interface RoutingProviderOption {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
}

/**
 * Investigation mode and per-capability model routing. Each capability may prefer one provider (and a model
 * on it); the rest of the priority chain stays behind it as fallback, and data-class, region and external
 * fallback rules still decide per request whether that provider may be used at all.
 */
export default function AiRoutingForm({
  investigationEnabled,
  routing,
  providers,
  revision,
  canManage,
}: {
  investigationEnabled: boolean;
  routing: CapabilityRouting;
  providers: RoutingProviderOption[];
  revision: number;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiRoutingAction, initial);
  const disabled = !canManage || pending;
  const switchId = useId();
  return (
    <form action={action} className="space-y-4 py-4" aria-label="Investigation and model routing">
      <input type="hidden" name="expectedRevision" value={revision} />
      <div className="flex items-start gap-3">
        <input
          id={switchId}
          name="squireInvestigationEnabled"
          type="checkbox"
          defaultChecked={investigationEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <label htmlFor={switchId} className="space-y-0.5">
          <span className="block text-sm font-medium">Investigation mode</span>
          <span className="block text-xs text-muted-foreground">
            For diagnostic questions (&quot;why…&quot;, &quot;what caused…&quot;,
            &quot;investigate…&quot;) the assistant plans, reads several sources in parallel (at
            most 4 at a time, at most 12 steps) and answers with ranked hypotheses, each tied to the
            evidence it read. Uses more tokens per question; capped per turn. Off by default.
          </span>
        </label>
      </div>
      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="text-sm font-medium">Model routing</legend>
        <p className="text-xs text-muted-foreground">
          Leave a capability on &quot;Priority order&quot; to use the provider list below. A routed
          provider is tried first; if it is unavailable, not cleared for the data, or failing, the
          normal priority order takes over.
        </p>
        {ROUTABLE_CAPABILITIES.map(capability => {
          // eslint-disable-next-line security/detect-object-injection -- capability is a member of a fixed list
          const route = routing[capability];
          return (
            <div key={capability} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_12rem]">
              <span className="self-center text-sm">
                {/* eslint-disable-next-line security/detect-object-injection -- fixed label table */}
                {CAPABILITY_ROUTE_LABELS[capability]}
              </span>
              <select
                name={`route.${capability}.provider`}
                aria-label={`Provider for ${CAPABILITY_ROUTE_LABELS[capability]}`} // eslint-disable-line security/detect-object-injection
                defaultValue={route?.providerId ?? ''}
                className={fieldClass}
              >
                <option value="">Priority order</option>
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                    {provider.enabled ? '' : ' (disabled)'}
                  </option>
                ))}
              </select>
              <input
                name={`route.${capability}.model`}
                aria-label={`Model for ${CAPABILITY_ROUTE_LABELS[capability]}`} // eslint-disable-line security/detect-object-injection
                defaultValue={route?.model ?? ''}
                placeholder="Provider's model"
                maxLength={128}
                className={fieldClass}
              />
            </div>
          );
        })}
      </fieldset>
      {canManage && (
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save investigation and routing'}
        </Button>
      )}
      {state.message && (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
