'use client';

import { useState } from 'react';
import type { RunbookInputType, RunbookVersionState } from '@prisma/client';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { FormSelect } from '@/components/runbooks/RunbookControls';
import RunbookTargetSelect, {
  type RunbookTargetOptions,
} from '@/components/runbooks/RunbookTargetSelect';

type InputDefinition = {
  key: string;
  label: string;
  type: RunbookInputType;
  required: boolean;
  defaultValue: string | null;
  description: string;
};

type Version = {
  id: string;
  version: number;
  state: RunbookVersionState;
  inputs: InputDefinition[];
  hasAgentWrite?: boolean;
};

export default function RunbookBindingVersionInputs({
  versions,
  publishedVersionId,
  initialStrategy,
  initialVersionId,
  values,
  targets,
}: {
  versions: Version[];
  publishedVersionId: string;
  initialStrategy: 'LATEST_PUBLISHED' | 'PINNED';
  initialVersionId: string | null;
  values: Record<string, unknown>;
  targets?: RunbookTargetOptions & { defaultValue: string };
}) {
  const [strategy, setStrategy] = useState(initialStrategy);
  const [versionId, setVersionId] = useState(initialVersionId ?? publishedVersionId);
  const effectiveVersionId = strategy === 'PINNED' ? versionId : publishedVersionId;
  const version = versions.find(candidate => candidate.id === effectiveVersionId);
  const selectable = versions.filter(
    candidate => candidate.state === 'PUBLISHED' || candidate.id === initialVersionId
  );

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`version-strategy-${publishedVersionId}`}>Version strategy</Label>
        <FormSelect
          name="versionStrategy"
          label="Version strategy"
          value={strategy}
          onValueChange={value => setStrategy(value as typeof strategy)}
          options={[
            { value: 'LATEST_PUBLISHED', label: 'Latest published' },
            { value: 'PINNED', label: 'Pinned' },
          ]}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`pinned-version-${publishedVersionId}`}>Pinned version</Label>
        <FormSelect
          name="runbookVersionId"
          label="Pinned version"
          value={versionId}
          onValueChange={setVersionId}
          disabled={strategy !== 'PINNED'}
          options={selectable.map(candidate => ({
            value: candidate.id,
            label: `v${candidate.version} · ${candidate.state}`,
          }))}
        />
      </div>
      {targets && (
        <div className="space-y-2">
          <Label>Execution target</Label>
          <RunbookTargetSelect {...targets} hasAgentWrite={version?.hasAgentWrite} />
        </div>
      )}
      <div
        key={effectiveVersionId}
        className="order-1 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-4"
      >
        <GeneratedFields definitions={version?.inputs ?? []} values={values} />
      </div>
    </>
  );
}

function GeneratedFields({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground sm:col-span-2">No inputs required.</p>;
  return definitions.map(input => {
    const current = values[input.key] ?? input.defaultValue ?? '';
    if (input.type === 'BOOLEAN') {
      return (
        <label key={input.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            name={`input:${input.key}`}
            type="checkbox"
            value="true"
            defaultChecked={current === true || current === 'true'}
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
    const displayed =
      input.type === 'SECRET_REF' && typeof current === 'string'
        ? current.replace(/^secret:\/\//, '')
        : typeof current === 'string' || typeof current === 'number'
          ? String(current)
          : '';
    return (
      <div key={input.key} className="space-y-2">
        <Label>
          {input.label}
          {input.required ? ' *' : ''}
        </Label>
        <Input
          name={`input:${input.key}`}
          type={input.type === 'NUMBER' ? 'number' : input.type === 'URL' ? 'url' : 'text'}
          step={input.type === 'NUMBER' ? 'any' : undefined}
          required={input.required}
          defaultValue={displayed}
          placeholder={
            input.type === 'DURATION'
              ? '30s, 5m, or 1h'
              : input.type === 'SECRET_REF'
                ? 'Secret name'
                : undefined
          }
        />
        {input.description && <p className="text-xs text-muted-foreground">{input.description}</p>}
      </div>
    );
  });
}
