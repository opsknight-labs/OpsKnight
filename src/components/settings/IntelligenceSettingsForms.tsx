'use client';

import { useActionState, useId } from 'react';
import {
  publishGlobalPolicy,
  replayIntelligenceDeadLetter,
  rollbackGlobalPolicy,
  saveIntelligenceSettings,
  type IntelligenceActionState,
} from '@/app/(app)/settings/intelligence/actions';
import { Button } from '@/components/ui/shadcn/button';
import { INTELLIGENCE_SETTINGS_BOUNDS, type IntelligenceModeValue } from '@/lib/intelligence/contract';

const initialState: IntelligenceActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

function Status({ state }: { state: IntelligenceActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
      {state.message}
    </p>
  );
}

type SettingsValues = {
  enabled: boolean;
  maxConcurrency: number;
  batchSize: number;
  maxJobMs: number;
  maxDbMs: number;
  candidateCap: number;
  lookbackDays: number;
  backpressureEscalationLagMs: number;
  fingerprintRetentionDays: number;
  correlationRetentionDays: number;
  findingRetentionDays: number;
  feedbackRetentionDays: number;
  revision: number;
};

function NumberField({
  name,
  label,
  help,
  value,
  min,
  max,
  disabled,
}: {
  name: string;
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} name={name} type="number" defaultValue={value} min={min} max={max} step={1} required disabled={disabled} className={fieldClass} />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export function IntelligenceSettingsForm({ settings, canManage }: { settings: SettingsValues; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveIntelligenceSettings, initialState);
  const enabledId = useId();
  const b = INTELLIGENCE_SETTINGS_BOUNDS;
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-6 py-4">
      <input type="hidden" name="expectedRevision" value={settings.revision} />
      <div className="flex items-start gap-3">
        <input id={enabledId} name="enabled" type="checkbox" defaultChecked={settings.enabled} disabled={disabled} className="mt-1 h-4 w-4" />
        <div>
          <label htmlFor={enabledId} className="text-sm font-medium">
            Enable OpsKnight Intelligence
          </label>
          <p className="text-xs text-muted-foreground">
            Master switch and kill switch. While off, no analysis runs and incident handling is
            exactly as before. Per-service modes are set by policy.
          </p>
        </div>
      </div>
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Worker budgets</legend>
        <NumberField name="maxConcurrency" label="Concurrent work items" help="Parallel items per worker process." value={settings.maxConcurrency} min={b.maxConcurrency.min} max={b.maxConcurrency.max} disabled={disabled} />
        <NumberField name="batchSize" label="Batch size" help="Items claimed per cycle." value={settings.batchSize} min={b.batchSize.min} max={b.batchSize.max} disabled={disabled} />
        <NumberField name="maxJobMs" label="Time budget per item (ms)" help="Work exceeding this is stopped and retried with backoff." value={settings.maxJobMs} min={b.maxJobMs.min} max={b.maxJobMs.max} disabled={disabled} />
        <NumberField name="maxDbMs" label="Database time budget (ms)" help="Statement timeout for intelligence queries. Cannot exceed the item budget." value={settings.maxDbMs} min={b.maxDbMs.min} max={b.maxDbMs.max} disabled={disabled} />
        <NumberField name="candidateCap" label="Candidates per source" help="Upper bound on historical incidents examined per search." value={settings.candidateCap} min={b.candidateCap.min} max={b.candidateCap.max} disabled={disabled} />
        <NumberField name="lookbackDays" label="Lookback (days)" help="How far back similar incidents are searched." value={settings.lookbackDays} min={b.lookbackDays.min} max={b.lookbackDays.max} disabled={disabled} />
        <NumberField name="backpressureEscalationLagMs" label="Yield to paging above (ms)" help="Intelligence pauses while escalations or notifications wait longer than this." value={settings.backpressureEscalationLagMs} min={b.backpressureEscalationLagMs.min} max={b.backpressureEscalationLagMs.max} disabled={disabled} />
      </fieldset>
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Retention (days)</legend>
        <NumberField name="fingerprintRetentionDays" label="Fingerprints" help="Searchable incident history." value={settings.fingerprintRetentionDays} min={b.retentionDays.min} max={b.retentionDays.max} disabled={disabled} />
        <NumberField name="correlationRetentionDays" label="Correlation records" help="Groups, members and decisions." value={settings.correlationRetentionDays} min={b.retentionDays.min} max={b.retentionDays.max} disabled={disabled} />
        <NumberField name="findingRetentionDays" label="Findings" help="Suggestions and their evidence." value={settings.findingRetentionDays} min={b.retentionDays.min} max={b.retentionDays.max} disabled={disabled} />
        <NumberField name="feedbackRetentionDays" label="Feedback" help="Responder feedback on suggestions." value={settings.feedbackRetentionDays} min={b.retentionDays.min} max={b.retentionDays.max} disabled={disabled} />
      </fieldset>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save settings'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export function IntelligencePolicyForm({
  headVersion,
  mode,
  similarityEnabled,
  responseEnabled,
  minScore,
  canManage,
  autoAvailable,
}: {
  headVersion: number;
  mode: IntelligenceModeValue;
  similarityEnabled: boolean;
  responseEnabled: boolean;
  minScore: number;
  canManage: boolean;
  autoAvailable: boolean;
}) {
  const [state, action, pending] = useActionState(publishGlobalPolicy, initialState);
  const id = useId();
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-4 py-4">
      <input type="hidden" name="expectedHeadVersion" value={headVersion} />
      <div className="space-y-1">
        <label htmlFor={`${id}-mode`} className="text-sm font-medium">
          Mode
        </label>
        <select id={`${id}-mode`} name="mode" defaultValue={mode} disabled={disabled} className={fieldClass}>
          <option value="OFF">Off — no analysis</option>
          <option value="SHADOW">Shadow — analyze and record only</option>
          <option value="SUGGEST">Suggest — show suggestions to responders</option>
          <option value="AUTO" disabled={!autoAvailable}>
            Automatic{autoAvailable ? '' : ' — not available until certified'}
          </option>
        </select>
        <p className="text-xs text-muted-foreground">
          Applies to every service without its own policy. No mode changes paging or escalation.
        </p>
      </div>
      <div className="flex items-start gap-3">
        <input id={`${id}-sim`} name="similarityEnabled" type="checkbox" defaultChecked={similarityEnabled} disabled={disabled} className="mt-1 h-4 w-4" />
        <label htmlFor={`${id}-sim`} className="text-sm font-medium">
          Find similar past incidents
        </label>
      </div>
      <div className="flex items-start gap-3">
        <input id={`${id}-resp`} name="responseEnabled" type="checkbox" defaultChecked={responseEnabled} disabled={disabled} className="mt-1 h-4 w-4" />
        <label htmlFor={`${id}-resp`} className="text-sm font-medium">
          Suggest probable causes and runbooks
          <span className="block text-xs font-normal text-muted-foreground">
            Uses recent changes, service dependencies and past runbook results. Recommendations only; nothing is run.
          </span>
        </label>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-score`} className="text-sm font-medium">
          Minimum similarity (0 to 1)
        </label>
        <input id={`${id}-score`} name="minScore" type="number" min={0} max={1} step={0.05} defaultValue={minScore} disabled={disabled} className={fieldClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">
          Reason (recorded in the audit log)
        </label>
        <input id={`${id}-reason`} name="reason" type="text" maxLength={500} disabled={disabled} className={fieldClass} />
      </div>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Publishing…' : 'Publish new version'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export function RollbackForm({ targetVersion, headVersion }: { targetVersion: number; headVersion: number }) {
  const [state, action, pending] = useActionState(rollbackGlobalPolicy, initialState);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="targetVersion" value={targetVersion} />
      <input type="hidden" name="expectedHeadVersion" value={headVersion} />
      <label htmlFor={id} className="sr-only">
        Reason for restoring version {targetVersion}
      </label>
      <input id={id} name="reason" required maxLength={500} placeholder="Reason" disabled={pending} className={`${fieldClass} max-w-xs`} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Restore as new version
      </Button>
      <Status state={state} />
    </form>
  );
}

export function ReplayForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(replayIntelligenceDeadLetter, initialState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Retry
      </Button>
      <Status state={state} />
    </form>
  );
}
