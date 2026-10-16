'use client';

import { useVersionConfiguration } from '@/components/runbooks/useVersionConfiguration';
import { useState, type ReactNode } from 'react';
import type { RunbookInputType, RunbookVersionState } from '@prisma/client';
import { Info } from 'lucide-react';
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
import { InputFields } from './runbooks/rule-fields';
import { SheetGroup } from './runbooks/RuleSheet';

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
  targetExtras,
  initialMode,
  includeInputs = true,
  onVersionChange,
  runbookId,
  layout = 'inline',
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
  /** Rendered directly after the target select (e.g. selector builder). */
  targetExtras?: ReactNode;
  /** `sections` groups fields under Version & mode / Target / Inputs headings. */
  layout?: 'inline' | 'sections';
}) {
  const [mode, setMode] = useState(initialMode ?? 'MANUAL');
  const [confirmAutomatic, setConfirmAutomatic] = useState(false);
  const published = versions.find(candidate => candidate.id === publishedVersionId);
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

  const versionFields = (
    <>
      {initialMode !== undefined && (
        <div className="space-y-2">
          <Label htmlFor="mode">Execution mode</Label>
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
      {mode === 'AUTOMATIC' && <input type="hidden" name="versionStrategy" value="PINNED" />}
      <div className="space-y-2">
        <Label htmlFor="versionStrategy">Version strategy</Label>
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
        <Label htmlFor="runbookVersionId">Pinned version</Label>
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
      {mode === 'AUTOMATIC' && (
        <p className="col-span-full flex items-start gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground ring-1 ring-inset ring-primary/15">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          Automatic runs one pinned published version. Add an incident trigger before enabling it.
        </p>
      )}
      {metadata?.metadataOnly && !version && (
        <p
          data-form-invalid="true"
          role="status"
          className="col-span-full text-xs text-muted-foreground"
        >
          {loaded.error
            ? 'Version configuration unavailable. Reload to retry.'
            : 'Loading selected version configuration…'}
        </p>
      )}
    </>
  );
  const targetField = targets && (
    <div className="space-y-2">
      <Label htmlFor="executionTarget">Execution target</Label>
      <RunbookTargetSelect {...targets} hasAgentWrite={version?.hasAgentWrite} />
    </div>
  );
  const inputFields = (
    <div key={effectiveVersionId} className="col-span-full grid gap-4 sm:grid-cols-2">
      <InputFields definitions={version?.inputs ?? []} values={values} />
    </div>
  );
  const confirmDialog = (
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
  );

  return (
    <>
      <input type="hidden" name="expectedVersionId" value={effectiveVersionId} />
      {layout === 'sections' ? (
        <>
          <SheetGroup
            id="rule-config-version"
            title="Version & mode"
            description="How this rule runs and which published version it uses."
          >
            <div className="grid gap-4 sm:grid-cols-2">{versionFields}</div>
          </SheetGroup>
          {includeInputs && (
            <SheetGroup
              id="rule-config-inputs"
              title="Inputs"
              description="Values passed to the selected version on every run."
            >
              {inputFields}
            </SheetGroup>
          )}
          {targets && (
            <SheetGroup
              id="rule-config-target"
              title="Target"
              description="Where the workflow runs. Leave empty for control-plane-only steps."
              className="space-y-4"
            >
              {targetField}
              {targetExtras}
            </SheetGroup>
          )}
        </>
      ) : (
        <>
          {versionFields}
          {targetField}
          {targetExtras}
          {includeInputs && inputFields}
        </>
      )}
      {confirmDialog}
    </>
  );
}
