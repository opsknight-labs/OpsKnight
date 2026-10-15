'use client';

import { useVersionConfiguration } from '@/components/runbooks/useVersionConfiguration';
import { useId, useState } from 'react';
import type { RunbookInputType, RunbookVersionState } from '@prisma/client';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/shadcn/alert-dialog';
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
  metadataOnly?: boolean;
};

export default function RunbookBindingVersionInputs({
  versions,
  publishedVersionId,
  initialStrategy,
  initialVersionId,
  values,
  targets,
  initialMode,
  includeInputs = true,
  onVersionChange,
  runbookId,
}: {
  runbookId?: string;
  onVersionChange?: (versionId: string) => void;
  initialMode?: 'MANUAL' | 'SUGGESTED' | 'AUTOMATIC';
  includeInputs?: boolean;
  versions: Version[];
  publishedVersionId: string;
  initialStrategy: 'LATEST_PUBLISHED' | 'PINNED';
  initialVersionId: string | null;
  values: Record<string, unknown>;
  targets?: RunbookTargetOptions & { defaultValue: string };
}) {
  const [mode, setMode] = useState(initialMode ?? 'MANUAL');
  const [confirmAutomatic, setConfirmAutomatic] = useState(false);
  const published = versions.find(candidate => candidate.id === publishedVersionId);
  const id = useId();
  const [strategy, setStrategy] = useState(initialStrategy);
  const [versionId, setVersionId] = useState(initialVersionId ?? publishedVersionId);
  const effectiveVersionId = strategy === 'PINNED' ? versionId : publishedVersionId;
  const metadata = versions.find(candidate => candidate.id === effectiveVersionId);
  const loaded = useVersionConfiguration(
    metadata?.metadataOnly ? effectiveVersionId : null,
    runbookId
  );
  const version = metadata?.metadataOnly ? loaded.data : metadata;
  const selectable = versions.filter(
    candidate => candidate.state === 'PUBLISHED' || candidate.id === initialVersionId
  );

  return (
    <>
      <input type="hidden" name="expectedVersionId" value={effectiveVersionId} />
      {initialMode !== undefined && (
        <div className="space-y-2">
          <Label>Execution mode</Label>
          <FormSelect
            name="mode"
            label="Execution mode"
            value={mode}
            onValueChange={value => {
              if (value === 'AUTOMATIC') setConfirmAutomatic(true);
              else setMode(value as typeof mode);
            }}
            options={[
              { value: 'MANUAL', label: 'Manual · Run explicitly' },
              { value: 'SUGGESTED', label: 'Suggested · Offer matching incident actions' },
              { value: 'AUTOMATIC', label: 'Automatic · Exact version required' },
            ]}
          />
        </div>
      )}
      <AlertDialog open={confirmAutomatic} onOpenChange={setConfirmAutomatic}>
        <AlertDialogContent>
          <AlertDialogTitle>Pin published version v{published?.version ?? '?'}?</AlertDialogTitle>
          <AlertDialogDescription>
            Automatic execution uses this immutable version. Review its target, inputs and approval
            gates. Later publication will not change this rule.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current mode</AlertDialogCancel>
            <AlertDialogAction
              disabled={!published || published.state !== 'PUBLISHED'}
              onClick={() => {
                setMode('AUTOMATIC');
                setStrategy('PINNED');
                setVersionId(publishedVersionId);
                onVersionChange?.(publishedVersionId);
              }}
            >
              Pin version and select Automatic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {mode === 'AUTOMATIC' && (
        <>
          <input type="hidden" name="versionStrategy" value="PINNED" />
          <p className="text-xs text-muted-foreground">
            Automatic mode requires a pinned published version. Configure an active incident trigger
            before enabling automation.
          </p>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor={`version-strategy-${publishedVersionId}`}>Version strategy</Label>
        <FormSelect
          name="versionStrategy"
          label="Version strategy"
          value={strategy}
          disabled={mode === 'AUTOMATIC'}
          onValueChange={value => {
            setStrategy(value as typeof strategy);
            onVersionChange?.(value === 'PINNED' ? versionId : publishedVersionId);
          }}
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
          onValueChange={value => {
            setVersionId(value);
            onVersionChange?.(value);
          }}
          disabled={strategy !== 'PINNED'}
          options={selectable.map(candidate => ({
            value: candidate.id,
            label: `v${candidate.version} · ${candidate.state}`,
          }))}
        />
      </div>
      {metadata?.metadataOnly && !version && (
        <p data-form-invalid="true" role="status">
          {loaded.error
            ? 'Version configuration unavailable. Reload to retry.'
            : 'Loading selected version configuration…'}
        </p>
      )}
      {targets && (
        <div className="space-y-2">
          <Label>Execution target</Label>
          <RunbookTargetSelect {...targets} hasAgentWrite={version?.hasAgentWrite} />
        </div>
      )}
      {includeInputs && (
        <div
          key={effectiveVersionId}
          className="order-1 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:col-span-4"
        >
          <GeneratedFields definitions={version?.inputs ?? []} values={values} idPrefix={id} />
        </div>
      )}
    </>
  );
}

function GeneratedFields({
  definitions,
  values,
  idPrefix,
}: {
  idPrefix: string;
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
            data-review-sensitive={/password|secret|token|credential|api.?key|private.?key/i.test(
              input.key
            )}
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
        <Label htmlFor={`${idPrefix}-${input.key}`}>
          {input.label}
          {input.required ? ' *' : ''}
        </Label>
        <Input
          id={`${idPrefix}-${input.key}`}
          name={`input:${input.key}`}
          data-review-sensitive={
            input.type === 'SECRET_REF' ||
            /password|secret|token|credential|api.?key|private.?key/i.test(input.key)
          }
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
