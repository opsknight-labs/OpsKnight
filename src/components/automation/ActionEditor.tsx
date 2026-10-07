'use client';
import { Button } from '@/components/ui/shadcn/button';
import { TypedValueInput } from './TypedValueInput';
import { builtinFields, type Action, type Rule, type Field } from '@/lib/automation/contract';
import type { getAutomationArea } from '@/app/(app)/services/[id]/automation/actions';
type Data = Awaited<ReturnType<typeof getAutomationArea>>;
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
export function ActionEditor({
  action,
  phase,
  fields,
  policies,
  destinations,
  disabled,
  onChange,
  onRemove,
}: {
  action: Action;
  phase: Rule['phase'];
  fields: Field[];
  policies: Data['policies'];
  destinations: Data['destinations'];
  disabled: boolean;
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label="Action"
        className={controlClass}
        disabled={disabled}
        value={action.type}
        onChange={e => {
          const type = e.target.value;
          const next: Action =
            type === 'SET_PRIORITY'
              ? { type, value: 'P1' }
              : type === 'SET_CONTEXT'
                ? {
                    type,
                    fieldKey:
                      fields.find(f => !builtinFields.some(b => b.key === f.key))?.key ?? '',
                    value: '',
                  }
                : type === 'ADD_TAG'
                  ? { type, value: 'tag' }
                  : type === 'USE_ESCALATION_POLICY'
                    ? { type, policyId: policies[0]?.id ?? '' }
                    : type === 'NOTIFY_CHANNEL'
                      ? { type, provider: 'SLACK', destinationId: destinations[0]?.id ?? '' }
                      : type === 'NO_ESCALATION'
                        ? { type }
                        : { type: 'USE_SERVICE_DEFAULT' };
          onChange(next);
        }}
      >
        {(phase === 'ENRICH'
          ? ['SET_PRIORITY', 'SET_CONTEXT', 'ADD_TAG']
          : ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION', 'NOTIFY_CHANNEL']
        ).map(type => (
          <option key={type} value={type}>
            {type.replaceAll('_', ' ').toLowerCase()}
          </option>
        ))}
      </select>
      {action.type === 'SET_PRIORITY' && (
        <select
          aria-label="Priority"
          className={controlClass}
          disabled={disabled}
          value={action.value}
          onChange={e => onChange({ ...action, value: e.target.value as 'P1' })}
        >
          {['P1', 'P2', 'P3', 'P4', 'P5'].map(p => (
            <option key={p}>{p}</option>
          ))}
        </select>
      )}
      {action.type === 'USE_ESCALATION_POLICY' && (
        <select
          aria-label="Escalation policy"
          className={controlClass}
          disabled={disabled}
          value={action.policyId}
          onChange={e => onChange({ ...action, policyId: e.target.value })}
        >
          {policies.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {action.type === 'SET_CONTEXT' && (
        <select
          aria-label="Context field"
          className={controlClass}
          disabled={disabled}
          value={action.fieldKey}
          onChange={e => onChange({ ...action, fieldKey: e.target.value })}
        >
          {fields
            .filter(f => !builtinFields.some(b => b.key === f.key))
            .map(f => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
        </select>
      )}
      {(action.type === 'ADD_TAG' || action.type === 'SET_CONTEXT') && (
        <TypedValueInput
          label="Action value"
          type={
            action.type === 'SET_CONTEXT'
              ? fields.find(f => f.key === action.fieldKey)?.type
              : 'STRING'
          }
          disabled={disabled}
          value={action.value}
          onChange={value => {
            if (!Array.isArray(value)) onChange({ ...action, value } as Action);
          }}
        />
      )}
      {action.type === 'NOTIFY_CHANNEL' && (
        <select
          aria-label="Notification destination"
          className={controlClass}
          disabled={disabled}
          value={action.destinationId}
          onChange={e => {
            const d = destinations.find(d => d.id === e.target.value);
            if (d) onChange({ ...action, provider: d.provider, destinationId: d.id });
          }}
        >
          <option value="">Choose destination…</option>
          {destinations.map(d => (
            <option key={d.id} value={d.id}>
              {d.provider} · {d.channelName ?? d.id}
            </option>
          ))}
        </select>
      )}
      {!disabled && (
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      )}
    </div>
  );
}
