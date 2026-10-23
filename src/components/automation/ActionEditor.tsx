'use client';
import { useId } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { TypedValueInput } from './TypedValueInput';
import { InlineError, Hint, NativeSelect } from './authoring/primitives';
import { builtinFields, type Action, type Rule, type Field } from '@/lib/automation/contract';
import type { getAutomationArea } from '@/app/(app)/services/[id]/automation/actions';
type Data = Awaited<ReturnType<typeof getAutomationArea>>;
const controlClass = 'w-full sm:w-auto sm:min-w-40 sm:flex-1 h-7.5 text-xs px-2';

function consequence(
  action: Action,
  fields: Field[],
  policies: Data['policies'],
  destinations: Data['destinations']
): { text?: string; problem?: string } {
  switch (action.type) {
    case 'SET_PRIORITY':
      return { text: `Sets incident priority to ${action.value}.` };
    case 'SET_CONTEXT': {
      const field = fields.find(f => f.key === action.fieldKey);
      return field
        ? { text: `Writes ${field.label}; later rules see the new value.` }
        : { problem: 'Add a context field before using “set context”.' };
    }
    case 'ADD_TAG':
      return action.value.trim()
        ? { text: 'Adds this tag to the incident.' }
        : { problem: 'Enter a tag (1–64 characters).' };
    case 'USE_SERVICE_DEFAULT':
      return { text: 'Pages the service’s default escalation policy.' };
    case 'USE_ESCALATION_POLICY': {
      const policy = policies.find(p => p.id === action.policyId);
      return policy
        ? { text: `Pages ${policy.name} instead of the service default.` }
        : { problem: 'Choose an available escalation policy.' };
    }
    case 'NOTIFY_CHANNEL': {
      const destination = destinations.find(d => d.id === action.destinationId);
      return destination
        ? {
            text: `Also posts to ${destination.channelName ?? 'this destination'}; does not change who is paged.`,
          }
        : { problem: 'Choose a notification destination.' };
    }
    case 'NO_ESCALATION':
      return {};
  }
}

export function ActionEditor({
  action,
  phase,
  fields,
  policies,
  destinations,
  disabled,
  allowRemove = true,
  onChange,
  onRemove,
}: {
  action: Action;
  phase: Rule['phase'];
  fields: Field[];
  policies: Data['policies'];
  destinations: Data['destinations'];
  disabled: boolean;
  allowRemove?: boolean;
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
  const noteId = useId();
  const { text, problem } = consequence(action, fields, policies, destinations);
  const policyMissing =
    action.type === 'USE_ESCALATION_POLICY' && !policies.some(p => p.id === action.policyId);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <NativeSelect
          aria-label={
            phase === 'ROUTE'
              ? action.type === 'NOTIFY_CHANNEL'
                ? 'Notification action'
                : 'Responder route'
              : 'Action'
          }
          aria-describedby={text || problem ? noteId : undefined}
          className={controlClass}
          disabled={disabled}
          value={action.type}
          onChange={e => {
            const type = e.target.value;
            const contextField = fields.find(
              field => !builtinFields.some(builtin => builtin.key === field.key)
            );
            const next: Action =
              type === 'SET_PRIORITY'
                ? { type, value: 'P1' }
                : type === 'SET_CONTEXT'
                  ? {
                      type,
                      fieldKey: contextField?.key ?? '',
                      value:
                        contextField?.type === 'NUMBER'
                          ? 0
                          : contextField?.type === 'BOOLEAN'
                            ? false
                            : contextField?.type === 'ENUM'
                              ? (contextField.allowedValues?.[0] ?? '')
                              : '',
                    }
                  : type === 'ADD_TAG'
                    ? { type, value: 'tag' }
                    : type === 'USE_ESCALATION_POLICY'
                      ? { type, policyId: policies[0]?.id ?? '' }
                      : type === 'NOTIFY_CHANNEL'
                        ? {
                            type,
                            provider: destinations[0]?.provider ?? 'SLACK',
                            destinationId: destinations[0]?.id ?? '',
                          }
                        : type === 'NO_ESCALATION'
                          ? { type }
                          : { type: 'USE_SERVICE_DEFAULT' };
            onChange(next);
          }}
        >
          {(phase === 'ENRICH'
            ? ['SET_PRIORITY', 'SET_CONTEXT', 'ADD_TAG']
            : action.type === 'NOTIFY_CHANNEL'
              ? ['NOTIFY_CHANNEL']
              : ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION']
          ).map(type => (
            <option
              key={type}
              value={type}
              disabled={
                (type === 'SET_CONTEXT' &&
                  !fields.some(f => !builtinFields.some(b => b.key === f.key))) ||
                (type === 'USE_ESCALATION_POLICY' && !policies.length) ||
                (type === 'NOTIFY_CHANNEL' && !destinations.length)
              }
            >
              {type.replaceAll('_', ' ').toLowerCase()}
            </option>
          ))}
        </NativeSelect>
        {action.type === 'SET_PRIORITY' && (
          <NativeSelect
            aria-label="Priority"
            className={controlClass}
            disabled={disabled}
            value={action.value}
            onChange={e => onChange({ ...action, value: e.target.value as 'P1' })}
          >
            {['P1', 'P2', 'P3', 'P4', 'P5'].map(p => (
              <option key={p}>{p}</option>
            ))}
          </NativeSelect>
        )}
        {action.type === 'USE_ESCALATION_POLICY' && (
          <NativeSelect
            aria-label="Escalation policy"
            aria-invalid={policyMissing || undefined}
            className={controlClass}
            disabled={disabled}
            value={action.policyId}
            onChange={e => onChange({ ...action, policyId: e.target.value })}
          >
            {policyMissing && <option value={action.policyId}>Unavailable policy</option>}
            {policies.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {action.type === 'SET_CONTEXT' && (
          <NativeSelect
            aria-label="Context field"
            className={controlClass}
            disabled={disabled}
            value={action.fieldKey}
            onChange={e => {
              const field = fields.find(f => f.key === e.target.value);
              onChange({
                ...action,
                fieldKey: e.target.value,
                value:
                  field?.type === 'NUMBER'
                    ? 0
                    : field?.type === 'BOOLEAN'
                      ? false
                      : field?.type === 'ENUM'
                        ? (field.allowedValues?.[0] ?? '')
                        : '',
              });
            }}
          >
            {fields
              .filter(f => !builtinFields.some(b => b.key === f.key))
              .map(f => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </NativeSelect>
        )}
        {(action.type === 'ADD_TAG' || action.type === 'SET_CONTEXT') && (
          <div className="w-full sm:w-auto sm:min-w-40 sm:flex-1">
            <TypedValueInput
              label="Action value"
              type={
                action.type === 'SET_CONTEXT'
                  ? fields.find(f => f.key === action.fieldKey)?.type
                  : 'STRING'
              }
              canonicalValues={
                action.type === 'SET_CONTEXT'
                  ? fields.find(f => f.key === action.fieldKey)?.allowedValues
                  : undefined
              }
              disabled={disabled}
              value={action.value}
              compact
              onChange={value => {
                if (!Array.isArray(value)) onChange({ ...action, value } as Action);
              }}
            />
          </div>
        )}
        {action.type === 'NOTIFY_CHANNEL' && (
          <NativeSelect
            aria-label="Notification destination"
            aria-invalid={!destinations.some(d => d.id === action.destinationId) || undefined}
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
          </NativeSelect>
        )}
        {!disabled && allowRemove && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove action"
            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      {problem ? (
        <InlineError id={noteId}>{problem}</InlineError>
      ) : (
        text && <Hint id={noteId}>{text}</Hint>
      )}
    </div>
  );
}
