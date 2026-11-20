'use client';

import { useActionState, useId } from 'react';
import {
  publishGlobalPolicy,
  publishTriagePolicy,
  replayIntelligenceDeadLetter,
  rollbackGlobalPolicy,
  saveIntelligenceSettings,
  type IntelligenceActionState,
} from '@/app/(app)/settings/intelligence/actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  INTELLIGENCE_SETTINGS_BOUNDS,
  type IntelligenceModeValue,
} from '@/lib/intelligence/contract';

const initialState: IntelligenceActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

function Status({ state }: { state: IntelligenceActionState }) {
  if (!state.message) return null;
  return (
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
  handoffSummaryEnabled: boolean;
  opsHelpersEnabled: boolean;
  automationIntelligenceFieldsEnabled: boolean;
  pageContextEnabled: boolean;
  peopleInsightsEnabled: boolean;
  warRoomKickoffEnabled: boolean;
  warRoomCaptureEnabled: boolean;
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
      <input
        id={id}
        name={name}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={1}
        required
        disabled={disabled}
        className={fieldClass}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export function IntelligenceSettingsForm({
  settings,
  canManage,
}: {
  settings: SettingsValues;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveIntelligenceSettings, initialState);
  const enabledId = useId();
  const b = INTELLIGENCE_SETTINGS_BOUNDS;
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-6 py-4">
      <input type="hidden" name="expectedRevision" value={settings.revision} />
      <div className="flex items-start gap-3">
        <input
          id={enabledId}
          name="enabled"
          type="checkbox"
          defaultChecked={settings.enabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
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
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-handoff`}
          name="handoffSummaryEnabled"
          type="checkbox"
          defaultChecked={settings.handoffSummaryEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-handoff`} className="text-sm font-medium">
            Send shift handoff summaries
          </label>
          <p className="text-xs text-muted-foreground">
            At each on-call rotation the incoming responder gets a summary of open and recently
            resolved incidents and overdue follow-ups for the schedule&apos;s services.
            Deterministic; an AI narrative is added only when AI is enabled.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-helpers`}
          name="opsHelpersEnabled"
          type="checkbox"
          defaultChecked={settings.opsHelpersEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-helpers`} className="text-sm font-medium">
            Show small helpers
          </label>
          <p className="text-xs text-muted-foreground">
            Suggests a service, urgency and a likely duplicate while someone creates an incident,
            drafts status-page updates from an incident, searches incidents, postmortems and
            runbooks from the command palette, explains what moved a metric on analytics cards,
            flags duplicate action items and suggests an owner, marks follow-ups whose cause came
            back, forecasts error budgets on service objectives and lists incidents that followed a
            change. Deterministic; nothing is created or published without a person.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-automation-fields`}
          name="automationIntelligenceFieldsEnabled"
          type="checkbox"
          defaultChecked={settings.automationIntelligenceFieldsEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-automation-fields`} className="text-sm font-medium">
            Use intelligence signals in automation rules
          </label>
          <p className="text-xs text-muted-foreground">
            Adds In maintenance, Recent risky change, SLO burning, Flapping and Storm active as rule
            conditions. Values come from a snapshot refreshed every 30 seconds; until it loads they
            read as unknown and no rule matches on them.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-page-context`}
          name="pageContextEnabled"
          type="checkbox"
          defaultChecked={settings.pageContextEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-page-context`} className="text-sm font-medium">
            Add leads to page emails
          </label>
          <p className="text-xs text-muted-foreground">
            Links the top similar past incident, the likely change and the best runbook in page
            emails, from findings already computed for the incident. Links only, no titles; each one
            still checks the reader when opened. A first page often goes out before analysis
            finishes, so leads usually show from the first escalation on.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-people`}
          name="peopleInsightsEnabled"
          type="checkbox"
          defaultChecked={settings.peopleInsightsEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-people`} className="text-sm font-medium">
            Suggest people
          </label>
          <p className="text-xs text-muted-foreground">
            Ranks cover candidates when someone adds a schedule override, lists people who fixed
            similar incidents as possible responders, and adds load and expertise to profiles. Load
            numbers are visible only to the person, their team lead and admins. Deterministic.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-war-room-kickoff`}
          name="warRoomKickoffEnabled"
          type="checkbox"
          defaultChecked={settings.warRoomKickoffEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-war-room-kickoff`} className="text-sm font-medium">
            Post a kickoff message in new war rooms
          </label>
          <p className="text-xs text-muted-foreground">
            When a Slack war room opens, posts one message with similar past incidents, likely
            causes and recommended runbooks already found for the incident. Deterministic; nothing
            is posted when nothing was found, and private incidents are never named.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${enabledId}-war-room-capture`}
          name="warRoomCaptureEnabled"
          type="checkbox"
          defaultChecked={settings.warRoomCaptureEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <div>
          <label htmlFor={`${enabledId}-war-room-capture`} className="text-sm font-medium">
            Save war-room messages to the incident timeline
          </label>
          <p className="text-xs text-muted-foreground">
            Saves people&apos;s messages in an incident&apos;s Slack war room to its timeline, so
            the time axis and postmortem draft include the discussion. Secrets are redacted; at most
            2,000 messages of 4 KB each per incident. Private channels are saved only for private
            incidents.
          </p>
        </div>
      </div>
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Worker budgets</legend>
        <NumberField
          name="maxConcurrency"
          label="Concurrent work items"
          help="Parallel items per worker process."
          value={settings.maxConcurrency}
          min={b.maxConcurrency.min}
          max={b.maxConcurrency.max}
          disabled={disabled}
        />
        <NumberField
          name="batchSize"
          label="Batch size"
          help="Items claimed per cycle."
          value={settings.batchSize}
          min={b.batchSize.min}
          max={b.batchSize.max}
          disabled={disabled}
        />
        <NumberField
          name="maxJobMs"
          label="Time budget per item (ms)"
          help="Work exceeding this is stopped and retried with backoff."
          value={settings.maxJobMs}
          min={b.maxJobMs.min}
          max={b.maxJobMs.max}
          disabled={disabled}
        />
        <NumberField
          name="maxDbMs"
          label="Database time budget (ms)"
          help="Statement timeout for intelligence queries. Cannot exceed the item budget."
          value={settings.maxDbMs}
          min={b.maxDbMs.min}
          max={b.maxDbMs.max}
          disabled={disabled}
        />
        <NumberField
          name="candidateCap"
          label="Candidates per source"
          help="Upper bound on historical incidents examined per search."
          value={settings.candidateCap}
          min={b.candidateCap.min}
          max={b.candidateCap.max}
          disabled={disabled}
        />
        <NumberField
          name="lookbackDays"
          label="Lookback (days)"
          help="How far back similar incidents are searched."
          value={settings.lookbackDays}
          min={b.lookbackDays.min}
          max={b.lookbackDays.max}
          disabled={disabled}
        />
        <NumberField
          name="backpressureEscalationLagMs"
          label="Yield to paging above (ms)"
          help="Intelligence pauses while escalations or notifications wait longer than this."
          value={settings.backpressureEscalationLagMs}
          min={b.backpressureEscalationLagMs.min}
          max={b.backpressureEscalationLagMs.max}
          disabled={disabled}
        />
      </fieldset>
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Retention (days)</legend>
        <NumberField
          name="fingerprintRetentionDays"
          label="Fingerprints"
          help="Searchable incident history."
          value={settings.fingerprintRetentionDays}
          min={b.retentionDays.min}
          max={b.retentionDays.max}
          disabled={disabled}
        />
        <NumberField
          name="correlationRetentionDays"
          label="Correlation records"
          help="Groups, members and decisions."
          value={settings.correlationRetentionDays}
          min={b.retentionDays.min}
          max={b.retentionDays.max}
          disabled={disabled}
        />
        <NumberField
          name="findingRetentionDays"
          label="Findings"
          help="Suggestions and their evidence."
          value={settings.findingRetentionDays}
          min={b.retentionDays.min}
          max={b.retentionDays.max}
          disabled={disabled}
        />
        <NumberField
          name="feedbackRetentionDays"
          label="Feedback"
          help="Responder feedback on suggestions."
          value={settings.feedbackRetentionDays}
          min={b.retentionDays.min}
          max={b.retentionDays.max}
          disabled={disabled}
        />
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
        <select
          id={`${id}-mode`}
          name="mode"
          defaultValue={mode}
          disabled={disabled}
          className={fieldClass}
        >
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
        <input
          id={`${id}-sim`}
          name="similarityEnabled"
          type="checkbox"
          defaultChecked={similarityEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <label htmlFor={`${id}-sim`} className="text-sm font-medium">
          Find similar past incidents
        </label>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`${id}-resp`}
          name="responseEnabled"
          type="checkbox"
          defaultChecked={responseEnabled}
          disabled={disabled}
          className="mt-1 h-4 w-4"
        />
        <label htmlFor={`${id}-resp`} className="text-sm font-medium">
          Suggest probable causes and runbooks
          <span className="block text-xs font-normal text-muted-foreground">
            Uses recent changes, service dependencies and past runbook results. Recommendations
            only; nothing is run.
          </span>
        </label>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-score`} className="text-sm font-medium">
          Minimum similarity (0 to 1)
        </label>
        <input
          id={`${id}-score`}
          name="minScore"
          type="number"
          min={0}
          max={1}
          step={0.05}
          defaultValue={minScore}
          disabled={disabled}
          className={fieldClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">
          Reason (recorded in the audit log)
        </label>
        <input
          id={`${id}-reason`}
          name="reason"
          type="text"
          maxLength={500}
          disabled={disabled}
          className={fieldClass}
        />
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

/**
 * Triage has its own card and its own publish: one switch, one policy version. The global policy
 * form no longer carries the checkbox, so publishing either never changes the other.
 */
export function TriagePolicyForm({
  headVersion,
  enabled,
  canManage,
}: {
  headVersion: number;
  enabled: boolean;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(publishTriagePolicy, initialState);
  const id = useId();
  return (
    <form action={action} className="space-y-4 border-t border-border py-4">
      <input type="hidden" name="expectedHeadVersion" value={headVersion} />
      <div className="flex min-h-11 items-center gap-3">
        <input
          id={`${id}-triage`}
          name="triageEnabled"
          type="checkbox"
          defaultChecked={enabled}
          disabled={!canManage || pending}
          className="h-4 w-4"
        />
        <label htmlFor={`${id}-triage`} className="text-sm font-medium">
          Suggest triage: urgency, owner, duplicates and expected time to resolve
        </label>
      </div>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Publishing…' : 'Save triage setting'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export function RollbackForm({
  targetVersion,
  headVersion,
}: {
  targetVersion: number;
  headVersion: number;
}) {
  const [state, action, pending] = useActionState(rollbackGlobalPolicy, initialState);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="targetVersion" value={targetVersion} />
      <input type="hidden" name="expectedHeadVersion" value={headVersion} />
      <label htmlFor={id} className="sr-only">
        Reason for restoring version {targetVersion}
      </label>
      <input
        id={id}
        name="reason"
        required
        maxLength={500}
        placeholder="Reason"
        disabled={pending}
        className={`${fieldClass} max-w-xs`}
      />
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
