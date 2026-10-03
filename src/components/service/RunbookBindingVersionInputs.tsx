'use client';

import { useState } from 'react';
import type { RunbookInputType, RunbookVersionState } from '@prisma/client';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

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
};

const selectClass = 'h-10 w-full rounded-md border bg-background px-3 text-sm';

export default function RunbookBindingVersionInputs({
  versions,
  publishedVersionId,
  initialStrategy,
  initialVersionId,
  values,
}: {
  versions: Version[];
  publishedVersionId: string;
  initialStrategy: 'LATEST_PUBLISHED' | 'PINNED';
  initialVersionId: string | null;
  values: Record<string, unknown>;
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
        <select
          id={`version-strategy-${publishedVersionId}`}
          name="versionStrategy"
          value={strategy}
          onChange={event => setStrategy(event.target.value as typeof strategy)}
          className={selectClass}
        >
          <option value="LATEST_PUBLISHED">Latest published</option>
          <option value="PINNED">Pinned</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`pinned-version-${publishedVersionId}`}>Pinned version</Label>
        <select
          id={`pinned-version-${publishedVersionId}`}
          name="runbookVersionId"
          value={versionId}
          onChange={event => setVersionId(event.target.value)}
          disabled={strategy !== 'PINNED'}
          className={selectClass}
        >
          {selectable.map(candidate => (
            <option key={candidate.id} value={candidate.id}>
              v{candidate.version} · {candidate.state}
            </option>
          ))}
        </select>
      </div>
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
