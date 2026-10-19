'use client';

import { useState } from 'react';
import type { RunbookInput } from '@prisma/client';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '@/components/runbooks/RunbookControls';
import Field from '@/components/runbooks/RunbookField';
import { requiresAgent, type RunbookRiskClass, type RunbookStepType } from '@/lib/runbooks/types';
import { minimumRiskForStep } from '@/lib/runbooks/definition';
import { parseSelectOptions } from '@/lib/runbooks/input-options';

export type InputDefinition = Pick<
  RunbookInput,
  'key' | 'label' | 'type' | 'required' | 'defaultValue' | 'description'
> & { options?: unknown };

const SENSITIVE_KEY = /password|secret|token|credential|api.?key|private.?key/i;

export function InputFields({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  const [entered, setEntered] = useState<Record<string, unknown>>(values);
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground sm:col-span-2">No inputs required.</p>;
  return definitions.map(input => {
    const current = entered[input.key] ?? input.defaultValue ?? '';
    if (input.type === 'BOOLEAN') {
      return (
        <label key={input.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            name={`input:${input.key}`}
            data-review-sensitive={SENSITIVE_KEY.test(input.key)}
            type="checkbox"
            value="true"
            checked={current === true || current === 'true'}
            onChange={event =>
              setEntered(previous => ({ ...previous, [input.key]: event.target.checked }))
            }
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">{input.label}</span>
            {input.description && (
              <span className="mt-1 block text-xs text-muted-foreground">{input.description}</span>
            )}
          </span>
        </label>
      );
    }
    if (input.type === 'SELECT') {
      const options = parseSelectOptions(input.options);
      return (
        <Field key={input.key} label={`${input.label}${input.required ? ' *' : ''}`}>
          <FormSelect
            name={`input:${input.key}`}
            label={input.label}
            value={typeof current === 'string' && current ? current : undefined}
            onValueChange={value => setEntered(previous => ({ ...previous, [input.key]: value }))}
            options={options.map(option => ({ value: option, label: option }))}
          />
          {input.description && (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          )}
        </Field>
      );
    }
    const displayed =
      input.type === 'SECRET_REF' && typeof current === 'string'
        ? current.replace(/^secret:\/\//, '')
        : typeof current === 'string' || typeof current === 'number'
          ? String(current)
          : '';
    return (
      <Field key={input.key} label={`${input.label}${input.required ? ' *' : ''}`}>
        <Input
          name={`input:${input.key}`}
          data-review-sensitive={input.type === 'SECRET_REF' || SENSITIVE_KEY.test(input.key)}
          type={input.type === 'NUMBER' ? 'number' : input.type === 'URL' ? 'url' : 'text'}
          step={input.type === 'NUMBER' ? 'any' : undefined}
          required={input.required}
          value={displayed}
          onChange={event =>
            setEntered(previous => ({ ...previous, [input.key]: event.target.value }))
          }
          placeholder={
            input.type === 'DURATION'
              ? '30s, 5m, or 1h'
              : input.type === 'SECRET_REF'
                ? 'Secret name'
                : undefined
          }
          aria-describedby={input.description ? `input-help-${input.key}` : undefined}
        />
        {input.description && (
          <p id={`input-help-${input.key}`} className="text-xs text-muted-foreground">
            {input.description}
          </p>
        )}
      </Field>
    );
  });
}

export function InputSummary({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground">No inputs configured.</p>;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {definitions.map(input => (
        <div key={input.key} className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <dt className="font-medium text-foreground">{input.label}</dt>
          <dd className="mt-0.5 break-words text-muted-foreground">
            {input.type === 'SECRET_REF' && (values[input.key] ?? input.defaultValue)
              ? 'Configured secret reference'
              : String(values[input.key] ?? input.defaultValue ?? 'Not set')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function hasAgentWrites(definition: unknown): boolean {
  if (!definition || typeof definition !== 'object') return true;
  try {
    const rawSteps = (definition as { steps?: unknown[] }).steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return true;

    const checkStep = (stepObj: unknown): boolean => {
      if (!stepObj || typeof stepObj !== 'object') return true;
      const step = stepObj as {
        type?: string;
        riskClass?: string;
        config?: Record<string, unknown>;
        precheck?: { steps?: unknown[] };
        verification?: { steps?: unknown[] };
      };

      if (typeof step.type === 'string' && requiresAgent(step.type as RunbookStepType)) {
        const derivedRisk = minimumRiskForStep({
          key: 'check',
          name: 'check',
          type: step.type as RunbookStepType,
          riskClass: (step.riskClass as RunbookRiskClass) ?? 'READ_ONLY',
          config: step.config ?? {},
        });
        const declaredRisk = step.riskClass;
        if (derivedRisk !== 'READ_ONLY' || (declaredRisk && declaredRisk !== 'READ_ONLY')) {
          return true;
        }
      }
      if (step.precheck && Array.isArray(step.precheck.steps)) {
        if (step.precheck.steps.some(checkStep)) return true;
      }
      if (step.verification && Array.isArray(step.verification.steps)) {
        if (step.verification.steps.some(checkStep)) return true;
      }
      return false;
    };

    return rawSteps.some(checkStep);
  } catch {
    return true;
  }
}
