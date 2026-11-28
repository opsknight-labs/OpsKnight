'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useId, useState, type ReactNode } from 'react';
import {
  createHeartbeatAction,
  createRuleAction,
  createWindowAction,
  deleteHeartbeatAction,
  deleteRuleAction,
  endWindowAction,
  reverseDecisionAction,
  rollbackPolicyAction,
  savePolicyAction,
  simulateAction,
  toggleHeartbeatAction,
  toggleRuleAction,
  toggleWindowAction,
  type NoiseActionState,
} from '@/app/(app)/settings/intelligence/noise-controls/actions';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import ChoiceCards, { type Choice } from '@/components/ui/ChoiceCards';
import SearchableSelect from '@/components/ui/SearchableSelect';
import OrchestrationRulesBuilder from '@/components/settings/noise-controls/OrchestrationRulesBuilder';
import {
  highUrgencyNote,
  RowAction as RowButton,
} from '@/components/settings/noise-controls/shared';
import type { NoiseControlKpis } from '@/lib/intelligence/noise-controls/kpis';
import type {
  MaintenanceWindowView,
  NoiseControlPolicyView,
  NoiseReadiness,
  SuppressionSuggestion,
} from '@/lib/intelligence/noise-controls/manage';
import type { PrePagingDecisionRow } from '@/lib/intelligence/noise-controls/decisions';
import type { NoiseControlVersionView } from '@/lib/intelligence/noise-controls/policy-versions';
import type { NoiseVersionDiffEntry } from '@/lib/intelligence/noise-controls/versioning';
import { StatGrid, StatTile } from '@/components/intelligence/overview/primitives';
import { ActionMessage as Status, fieldClass, labelClass } from '@/components/settings/form-kit';

const initial: NoiseActionState = { message: '', ok: false };

type Option = { id: string; name: string };

function formatAt(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function ServiceSelect({
  id,
  name,
  services,
  allowAll,
  defaultValue,
  onChange,
}: {
  id: string;
  /** Omit for a select that only navigates and must not be submitted with its form. */
  name?: string;
  services: Option[];
  allowAll?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <SearchableSelect
      id={id}
      name={name}
      options={services.map(service => ({ value: service.id, label: service.name }))}
      defaultValue={defaultValue ?? ''}
      onChange={onChange}
      clearLabel={allowAll}
      placeholder="Select a service"
      searchPlaceholder="Search services…"
      noun="services"
    />
  );
}

export function KpiTiles({ kpis }: { kpis: NoiseControlKpis }) {
  const tiles = [
    { label: `Alerts per incident (${kpis.days}d)`, value: kpis.compressionRatio.toFixed(2) },
    {
      label: 'Pages avoided',
      value: String(kpis.pagesAvoided),
      hint: `${kpis.shadowWouldAvoid} more in shadow`,
    },
    { label: 'Downgraded / held', value: `${kpis.downgraded} / ${kpis.held}` },
    {
      label: 'False-group rate',
      value: `${Math.round(kpis.falseGroupRate * 100)}%`,
      hint: `${kpis.ungrouped} of ${kpis.grouped} reversed`,
    },
    {
      label: 'Heartbeats missing',
      value: String(kpis.heartbeats.missing),
      hint: `${kpis.heartbeats.monitors} monitors, ${kpis.heartbeats.late} late`,
    },
  ];
  return (
    <StatGrid label="Noise control KPIs">
      {tiles.map(tile => (
        <StatTile key={tile.label} label={tile.label} value={tile.value} hint={tile.hint} />
      ))}
    </StatGrid>
  );
}

type NoiseMode = 'OFF' | 'SHADOW' | 'ON';

const MODE_CHOICES: ReadonlyArray<Choice<NoiseMode>> = [
  { value: 'OFF', title: 'Off', body: 'Nothing changes. Every alert pages as it does today.' },
  {
    value: 'SHADOW',
    title: 'Watch only',
    body: 'Records what would be merged or held back, without changing anything. The safe way to start.',
  },
  {
    value: 'ON',
    title: 'On',
    body: 'Merges repeats, quiets flapping alerts and groups storms before anyone is paged.',
  },
];

/**
 * The three modes as cards, with the evidence for turning ON shown only when it matters. It lives inside the
 * keyed form, so it starts from the saved mode again after every publish.
 */
function ModeChoices({ initial, readiness }: { initial: NoiseMode; readiness: NoiseReadiness }) {
  const [mode, setMode] = useState<NoiseMode>(initial);
  const needsAcknowledgement = mode === 'ON' && initial !== 'ON' && !readiness.ready;
  const wrong = Math.round(readiness.falsePositiveRate * 100);
  const allowed = Math.round(readiness.maxFalsePositiveRate * 100);
  return (
    <div className="space-y-3">
      <ChoiceCards
        name="mode"
        legend="What should noise controls do here?"
        choices={MODE_CHOICES}
        value={mode}
        onChange={setMode}
      />
      <div className="text-sm text-muted-foreground">
        Evidence from watching: {readiness.shadowDecisions} of {readiness.minimumShadowDecisions}{' '}
        decisions in the last {readiness.windowDays} days, {wrong}% marked wrong (up to {allowed}%
        is fine).{' '}
        {readiness.ready ? (
          <Badge>Enough to turn on</Badge>
        ) : (
          <Badge variant="secondary">Keep watching</Badge>
        )}
      </div>
      {needsAcknowledgement && (
        <div role="note" className="space-y-2 rounded-md border border-border bg-muted p-3 text-sm">
          <p>
            There is not enough evidence yet. Watching first shows what would be hidden before
            anyone is affected. You can still turn it on now.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="acknowledgeReadiness" /> I understand: turn ON without the
            shadow evidence above
          </label>
        </div>
      )}
    </div>
  );
}

/** One thing noise controls can do: a switch with a plain sentence, and the numbers behind it folded away. */
function NoiseFeature({
  name,
  title,
  body,
  defaultChecked,
  children,
}: {
  name: string;
  title: string;
  body: string;
  defaultChecked: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <label className="flex cursor-pointer items-start gap-3 p-4">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{body}</span>
        </span>
      </label>
      <details className="border-t border-border px-4 py-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">Fine-tune</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">{children}</div>
      </details>
    </div>
  );
}

function NumberField({
  label,
  name,
  value,
  min,
  max,
}: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        type="number"
        name={name}
        defaultValue={value}
        min={min}
        max={max}
        className={fieldClass}
      />
    </label>
  );
}

function CheckField({ label, name, checked }: { label: string; name: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} /> {label}
    </label>
  );
}

export function NoisePolicyForm({
  policy,
  readiness,
  services,
  policies,
  selectedServiceId,
  canManage,
  runbooks = [],
}: {
  policy: NoiseControlPolicyView;
  readiness: NoiseReadiness;
  services: Option[];
  policies: Array<{
    scopeKey: string;
    serviceId: string | null;
    serviceName: string;
    mode: string;
    revision: number;
  }>;
  selectedServiceId: string | null;
  canManage: boolean;
  /** Options for the orchestration "attach a runbook" action. */
  runbooks?: Option[];
}) {
  const [state, action, pending] = useActionState(savePolicyAction, initial);
  const router = useRouter();
  const id = useId();
  const d = policy.definition;
  return (
    <div className="space-y-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Scope:</span>
        <a
          href="/settings/intelligence/noise-controls"
          className={!selectedServiceId ? 'font-semibold underline' : 'underline'}
        >
          All services
        </a>
        {policies
          .filter(row => row.serviceId)
          .map(row => (
            <a
              key={row.scopeKey}
              href={`/settings/intelligence/noise-controls?service=${row.serviceId}`}
              className={
                row.serviceId === selectedServiceId ? 'font-semibold underline' : 'underline'
              }
            >
              {row.serviceName} <Badge variant="outline">{row.mode}</Badge>
            </a>
          ))}
      </div>
      {/* Keyed by scope and revision: the fields are uncontrolled, so another service's policy, or the policy
          just published, needs a fresh form. Without the revision the form was reset to the values it was first
          rendered with, so a saved ON showed as OFF and publishing again quietly put it back. */}
      <form
        key={`${selectedServiceId ?? 'global'}:${policy.revision}`}
        action={action}
        className="grid gap-5"
      >
        <input type="hidden" name="expectedRevision" value={policy.revision} />
        <div className="max-w-md space-y-1">
          <label htmlFor={`${id}-service`} className={labelClass}>
            Service
          </label>
          {/* The select only navigates. It is not submitted: until the page for the chosen scope has
              loaded, this form still carries the scope and revision it was rendered with, together. */}
          <input type="hidden" name="serviceId" value={selectedServiceId ?? ''} />
          <ServiceSelect
            id={`${id}-service`}
            services={services}
            allowAll="All services (global)"
            defaultValue={selectedServiceId ?? ''}
            // The revision above belongs to the policy on screen. Picking another service here and
            // publishing sent that revision for a service with no row yet ("modified since it was read"),
            // so the page reloads for the chosen scope instead.
            onChange={value =>
              router.push(
                value
                  ? `/settings/intelligence/noise-controls?service=${encodeURIComponent(value)}`
                  : '/settings/intelligence/noise-controls'
              )
            }
          />
        </div>
        <ModeChoices initial={policy.mode} readiness={readiness} />
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">What it does</h3>
          <NoiseFeature
            name="contentDedupEnabled"
            title="Merge repeat alerts"
            body="An alert with the same content as an open incident on this service joins that incident instead of opening a new one."
            defaultChecked={d.contentDedup.enabled}
          >
            <NumberField
              label="Count as a repeat within (seconds)"
              name="contentDedupWindowSeconds"
              value={d.contentDedup.windowSeconds}
              min={60}
              max={86400}
            />
            <CheckField
              label="Only when the labels match too"
              name="contentDedupRequireLabelSubset"
              checked={d.contentDedup.requireLabelSubset}
            />
          </NoiseFeature>
          <NoiseFeature
            name="flappingEnabled"
            title="Quiet flapping alerts"
            body="An alert that keeps opening and closing is held as a suppressed incident, visible but paging nobody, until it settles."
            defaultChecked={d.flapping.enabled}
          >
            <NumberField
              label="Look back (seconds)"
              name="flappingWindowSeconds"
              value={d.flapping.windowSeconds}
              min={30}
              max={3600}
            />
            <NumberField
              label="Open-and-close cycles that count as flapping"
              name="flappingThreshold"
              value={d.flapping.threshold}
              min={2}
              max={50}
            />
            <CheckField
              label="Also match on alert content"
              name="flappingKeyOnFingerprint"
              checked={d.flapping.keyOnFingerprint}
            />
          </NoiseFeature>
          <NoiseFeature
            name="stormEnabled"
            title="Group alert storms"
            body="When many incidents open on this service in a short time, the later ones attach under the first so one person is paged, not many."
            defaultChecked={d.storm.enabled}
          >
            <NumberField
              label="Incidents that make a storm"
              name="stormThreshold"
              value={d.storm.threshold}
              min={2}
              max={1000}
            />
            <NumberField
              label="Within (seconds)"
              name="stormWindowSeconds"
              value={d.storm.windowSeconds}
              min={10}
              max={3600}
            />
            <NumberField
              label="Wait before paging (seconds, max 60)"
              name="stormHoldSeconds"
              value={d.storm.holdSeconds}
              min={0}
              max={60}
            />
            <CheckField
              label="Also group across dependent services"
              name="stormTopology"
              checked={d.storm.topology}
            />
          </NoiseFeature>
        </div>
        <details
          className="rounded-lg border border-border p-4"
          open={d.allowHighUrgency || policy.pipelineOrder !== 'OFF'}
        >
          <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${id}-pipeline`} className={labelClass}>
                Run before automation
              </label>
              <select
                id={`${id}-pipeline`}
                name="pipelineOrder"
                aria-describedby={`${id}-pipeline-help`}
                className={fieldClass}
                defaultValue={policy.pipelineOrder}
              >
                <option value="OFF">OFF (automation first)</option>
                <option value="SHADOW">SHADOW (record the difference)</option>
                <option value="ON">ON (noise controls first)</option>
              </select>
              <p id={`${id}-pipeline-help`} className="text-xs text-muted-foreground">
                Noise controls first: automation sees transformed severity, urgency and labels,
                skips dropped and appended alerts, and orchestration reroutes and runbook
                attachments apply.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="allowHighUrgency"
                defaultChecked={d.allowHighUrgency}
                className="mt-1"
              />
              <span>
                Let dedup, flapping and storms touch HIGH urgency
                <span className="block text-xs text-muted-foreground">
                  Leave this off and high-urgency alerts always page.
                </span>
              </span>
            </label>
          </div>
        </details>
        <OrchestrationRulesBuilder
          key={`${policy.scopeKey}:${policy.revision}`}
          name="orchestration"
          initialRules={d.orchestration.rules}
          services={services}
          runbooks={runbooks}
          serviceId={selectedServiceId}
          canManage={canManage}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || !canManage}>
            {pending ? 'Publishing…' : 'Publish new version'}
          </Button>
          <Status state={state} />
          {state.ok && selectedServiceId && (
            <a
              href={`/services/${selectedServiceId}?tab=intelligence`}
              className="text-sm underline"
            >
              View on the service page
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Every publish is saved as a version. Compare versions or roll back under Orchestration
          versions.
        </p>
      </form>
    </div>
  );
}

export function MaintenanceWindowForm({
  services,
  teams,
}: {
  services: Option[];
  teams: Option[];
}) {
  const [state, action, pending] = useActionState(createWindowAction, initial);
  const [scope, setScope] = useState<'SERVICE' | 'TEAM' | 'LABEL' | 'ALL'>('SERVICE');
  const [effect, setEffect] = useState<'SUPPRESS' | 'DOWNGRADE'>('SUPPRESS');
  const id = useId();
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-4">
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor={`${id}-name`} className={labelClass}>
          Name
        </label>
        <input id={`${id}-name`} name="name" required maxLength={120} className={fieldClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-scope`} className={labelClass}>
          Scope
        </label>
        <select
          id={`${id}-scope`}
          name="scope"
          className={fieldClass}
          value={scope}
          onChange={event => setScope(event.target.value as typeof scope)}
        >
          <option value="SERVICE">One service</option>
          <option value="TEAM">A team&apos;s services</option>
          <option value="LABEL">Alerts with a label</option>
          <option value="ALL">Everything</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-effect`} className={labelClass}>
          Effect
        </label>
        <select
          id={`${id}-effect`}
          name="effect"
          className={fieldClass}
          value={effect}
          onChange={event => setEffect(event.target.value as typeof effect)}
        >
          <option value="SUPPRESS">Suppress (never page)</option>
          <option value="DOWNGRADE">Downgrade urgency</option>
        </select>
      </div>
      {scope === 'SERVICE' && (
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-service`} className={labelClass}>
            Service
          </label>
          <ServiceSelect id={`${id}-service`} name="serviceId" services={services} />
        </div>
      )}
      {scope === 'TEAM' && (
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-team`} className={labelClass}>
            Team
          </label>
          <select id={`${id}-team`} name="teamId" className={fieldClass} defaultValue="">
            <option value="" disabled>
              Select a team
            </option>
            {teams.map(team => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {scope === 'LABEL' && (
        <>
          <div className="space-y-1">
            <label htmlFor={`${id}-lk`} className={labelClass}>
              Label key
            </label>
            <input id={`${id}-lk`} name="labelKey" className={fieldClass} placeholder="env" />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-lv`} className={labelClass}>
              Label value
            </label>
            <input id={`${id}-lv`} name="labelValue" className={fieldClass} placeholder="staging" />
          </div>
        </>
      )}
      {effect === 'DOWNGRADE' && (
        <div className="space-y-1">
          <label htmlFor={`${id}-du`} className={labelClass}>
            Downgrade to
          </label>
          <select id={`${id}-du`} name="downgradeUrgency" className={fieldClass} defaultValue="LOW">
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
          </select>
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-start`} className={labelClass}>
          Starts (local)
        </label>
        <input
          id={`${id}-start`}
          name="startsAt"
          type="datetime-local"
          required
          className={fieldClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-end`} className={labelClass}>
          Ends (local)
        </label>
        <input
          id={`${id}-end`}
          name="endsAt"
          type="datetime-local"
          required
          className={fieldClass}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor={`${id}-rec`} className={labelClass}>
          Repeats (RRULE, optional)
        </label>
        <input
          id={`${id}-rec`}
          name="recurrence"
          className={fieldClass}
          placeholder="FREQ=WEEKLY;BYDAY=SA,SU"
        />
      </div>
      <div className="sm:col-span-4 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add window'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function MaintenanceWindowList({
  windows,
  canManage,
}: {
  windows: MaintenanceWindowView[];
  canManage: boolean;
}) {
  if (windows.length === 0)
    return <p className="py-4 text-sm text-muted-foreground">No maintenance windows.</p>;
  return (
    <ul className="divide-y divide-border">
      {windows.map(window => (
        <li key={window.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium">
              {window.name} {window.active && <Badge>Active now</Badge>}
              {window.endedAt && <Badge variant="secondary">Ended early</Badge>}
              {!window.enabled && <Badge variant="outline">Disabled</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {window.scope === 'SERVICE' && `Service ${window.serviceName ?? window.serviceId}`}
              {window.scope === 'TEAM' && `Team ${window.teamId}`}
              {window.scope === 'LABEL' && `Label ${window.labelKey}=${window.labelValue}`}
              {window.scope === 'ALL' && 'All services'} ·{' '}
              {window.effect === 'SUPPRESS'
                ? 'suppress'
                : `downgrade to ${window.downgradeUrgency}`}{' '}
              ·{' '}
              {window.recurrence
                ? `repeats ${window.recurrence}; next ${formatAt(window.nextSpan?.startsAt)}`
                : `${formatAt(window.startsAt)} → ${formatAt(window.endsAt)}`}
            </p>
          </div>
          {canManage && !window.endedAt && (
            <div className="flex items-center gap-2">
              {window.active && (
                <RowButton
                  action={endWindowAction}
                  fields={{ id: window.id }}
                  label="End now"
                  confirm={{
                    title: 'End this maintenance window now?',
                    description: 'Alerts for these services page normally again straight away.',
                  }}
                />
              )}
              <RowButton
                action={toggleWindowAction}
                fields={{ id: window.id, enabled: window.enabled ? 'false' : 'true' }}
                label={window.enabled ? 'Disable' : 'Enable'}
                variant="ghost"
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SuppressionRuleForm({ services }: { services: Option[] }) {
  const [state, action, pending] = useActionState(createRuleAction, initial);
  const [field, setField] = useState('severity');
  const [effect, setEffect] = useState<'SUPPRESS' | 'DOWNGRADE'>('SUPPRESS');
  const id = useId();
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-4">
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor={`${id}-name`} className={labelClass}>
          Name
        </label>
        <input id={`${id}-name`} name="name" required maxLength={120} className={fieldClass} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor={`${id}-service`} className={labelClass}>
          Service
        </label>
        <ServiceSelect
          id={`${id}-service`}
          name="serviceId"
          services={services}
          allowAll="Any service"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-field`} className={labelClass}>
          Match field
        </label>
        <select
          id={`${id}-field`}
          name="matcherField"
          className={fieldClass}
          value={field}
          onChange={event => setField(event.target.value)}
        >
          <option value="severity">Severity</option>
          <option value="source">Source</option>
          <option value="summary">Summary</option>
          <option value="resourceKey">Resource</option>
          <option value="label">Label</option>
        </select>
      </div>
      {field === 'label' && (
        <div className="space-y-1">
          <label htmlFor={`${id}-key`} className={labelClass}>
            Label key
          </label>
          <input id={`${id}-key`} name="matcherKey" className={fieldClass} placeholder="env" />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-op`} className={labelClass}>
          Operator
        </label>
        <select id={`${id}-op`} name="matcherOp" className={fieldClass} defaultValue="equals">
          <option value="equals">equals</option>
          <option value="contains">contains</option>
          <option value="prefix">starts with</option>
          <option value="regex">matches regex</option>
          <option value="exists">exists</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-value`} className={labelClass}>
          Value
        </label>
        <input id={`${id}-value`} name="matcherValue" className={fieldClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-effect`} className={labelClass}>
          Effect
        </label>
        <select
          id={`${id}-effect`}
          name="effect"
          className={fieldClass}
          value={effect}
          onChange={event => setEffect(event.target.value as typeof effect)}
        >
          <option value="SUPPRESS">Suppress</option>
          <option value="DOWNGRADE">Downgrade</option>
        </select>
      </div>
      {effect === 'DOWNGRADE' && (
        <div className="space-y-1">
          <label htmlFor={`${id}-du`} className={labelClass}>
            Downgrade to
          </label>
          <select id={`${id}-du`} name="downgradeUrgency" className={fieldClass} defaultValue="LOW">
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
          </select>
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-exp`} className={labelClass}>
          Expires (local, optional)
        </label>
        <input id={`${id}-exp`} name="expiresAt" type="datetime-local" className={fieldClass} />
      </div>
      <div className="sm:col-span-4 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add rule'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function SuggestionList({
  suggestions,
  canManage,
}: {
  suggestions: SuppressionSuggestion[];
  canManage: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2 py-3">
      <p className="text-sm font-medium">
        Suggested from{' '}
        <a href="/settings/intelligence/services#alert-quality" className="underline">
          alert quality
        </a>
      </p>
      <ul className="divide-y divide-border">
        {suggestions.map(suggestion => (
          <li
            key={suggestion.serviceId}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm">{suggestion.rule.name}</p>
              <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
            </div>
            {canManage && (
              <RowButton
                action={createRuleAction}
                fields={{
                  name: suggestion.rule.name,
                  serviceId: suggestion.rule.serviceId,
                  matchers: JSON.stringify(suggestion.rule.matchers),
                  effect: 'DOWNGRADE',
                  downgradeUrgency: 'LOW',
                  origin: 'SUGGESTED',
                  suggestion: JSON.stringify(suggestion.rule.suggestion),
                }}
                label="Add as rule"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SuppressionRuleList({
  rules,
  canManage,
}: {
  rules: Array<{
    id: string;
    name: string;
    serviceName: string | null;
    matchers: Array<{ field: string; key?: string; op: string; value?: string }>;
    effect: string;
    downgradeUrgency: string | null;
    expiresAt: Date | null;
    enabled: boolean;
    origin: string;
  }>;
  canManage: boolean;
}) {
  if (rules.length === 0)
    return <p className="py-4 text-sm text-muted-foreground">No suppression rules.</p>;
  return (
    <ul className="divide-y divide-border">
      {rules.map(rule => (
        <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium">
              {rule.name} {!rule.enabled && <Badge variant="outline">Disabled</Badge>}{' '}
              {rule.origin === 'SUGGESTED' && <Badge variant="secondary">Suggested</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.serviceName ?? 'Any service'} ·{' '}
              {rule.matchers
                .map(m => `${m.field}${m.key ? `:${m.key}` : ''} ${m.op} ${m.value ?? ''}`)
                .join(' AND ')}{' '}
              · {rule.effect === 'SUPPRESS' ? 'suppress' : `downgrade to ${rule.downgradeUrgency}`}{' '}
              · {rule.expiresAt ? `expires ${formatAt(rule.expiresAt)}` : 'no expiry'}
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <RowButton
                action={toggleRuleAction}
                fields={{ id: rule.id, enabled: rule.enabled ? 'false' : 'true' }}
                label={rule.enabled ? 'Disable' : 'Enable'}
              />
              <RowButton
                action={deleteRuleAction}
                fields={{ id: rule.id }}
                label="Delete"
                confirm={{
                  title: 'Delete this suppression rule?',
                  description:
                    'Alerts it matched will page normally again. You can create the rule again, but this one is gone.',
                  confirmLabel: 'Delete rule',
                }}
                variant="ghost"
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function HeartbeatForm({ services }: { services: Option[] }) {
  const [state, action, pending] = useActionState(createHeartbeatAction, initial);
  const id = useId();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-5">
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor={`${id}-name`} className={labelClass}>
          Name
        </label>
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          className={fieldClass}
          placeholder="Nightly backup"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-service`} className={labelClass}>
          Service
        </label>
        <ServiceSelect id={`${id}-service`} name="serviceId" services={services} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-int`} className={labelClass}>
          Expected every (s)
        </label>
        <input
          id={`${id}-int`}
          name="intervalSeconds"
          type="number"
          min={10}
          defaultValue={300}
          className={fieldClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-grace`} className={labelClass}>
          Grace (s)
        </label>
        <input
          id={`${id}-grace`}
          name="graceSeconds"
          type="number"
          min={0}
          defaultValue={60}
          className={fieldClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-urg`} className={labelClass}>
          Urgency when missing
        </label>
        <select id={`${id}-urg`} name="urgency" className={fieldClass} defaultValue="MEDIUM">
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
        </select>
      </div>
      <div className="sm:col-span-5 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create monitor'}
        </Button>
        <Status state={state} />
      </div>
      {state.token && (
        <div
          className="sm:col-span-5 rounded-md border border-border bg-muted p-3 text-sm"
          role="status"
        >
          <p className="font-medium">Ping URL (shown once)</p>
          <code className="block break-all text-xs">{`${origin}/api/heartbeats/${state.token}`}</code>
          <p className="mt-1 text-xs text-muted-foreground">{`curl -fsS ${origin}/api/heartbeats/${state.token}`}</p>
        </div>
      )}
    </form>
  );
}

export function HeartbeatList({
  monitors,
  canManage,
}: {
  monitors: Array<{
    id: string;
    name: string;
    serviceName: string;
    tokenPrefix: string;
    intervalSeconds: number;
    graceSeconds: number;
    urgency: string;
    enabled: boolean;
    state: string;
    lastPingAt: Date | null;
    dueAt: Date;
  }>;
  canManage: boolean;
}) {
  if (monitors.length === 0)
    return <p className="py-4 text-sm text-muted-foreground">No heartbeat monitors.</p>;
  const tone = (state: string) =>
    state === 'MISSING' ? 'destructive' : state === 'HEALTHY' ? 'default' : 'secondary';
  return (
    <ul className="divide-y divide-border">
      {monitors.map(monitor => (
        <li key={monitor.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium">
              {monitor.name}{' '}
              <Badge variant={tone(monitor.state) as 'default'}>{monitor.state}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {monitor.serviceName} · every {monitor.intervalSeconds}s (+{monitor.graceSeconds}s
              grace) · {monitor.urgency} · token {monitor.tokenPrefix}… · last ping{' '}
              {formatAt(monitor.lastPingAt)} · due {formatAt(monitor.dueAt)}
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <RowButton
                action={toggleHeartbeatAction}
                fields={{ id: monitor.id, enabled: monitor.enabled ? 'false' : 'true' }}
                label={monitor.enabled ? 'Pause' : 'Resume'}
              />
              <RowButton
                action={deleteHeartbeatAction}
                fields={{ id: monitor.id }}
                label="Delete"
                confirm={{
                  title: 'Delete this heartbeat monitor?',
                  description:
                    'Its ping address stops working and you will no longer be told if the job goes quiet.',
                  confirmLabel: 'Delete monitor',
                }}
                variant="ghost"
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SimulationForm({ services }: { services: Option[] }) {
  const [state, action, pending] = useActionState(simulateAction, initial);
  const id = useId();
  const result = state.simulation;
  return (
    <div className="space-y-3 py-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={`${id}-service`} className={labelClass}>
            Service
          </label>
          <ServiceSelect
            id={`${id}-service`}
            name="serviceId"
            services={services}
            allowAll="All services"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-days`} className={labelClass}>
            Days
          </label>
          <input
            id={`${id}-days`}
            name="days"
            type="number"
            min={1}
            max={30}
            defaultValue={7}
            className={fieldClass}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Replaying…' : 'Replay history'}
        </Button>
      </form>
      <Status state={state} />
      {result && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {result.incidentsEvaluated} incidents from {result.alertsScanned} alerts
            {result.truncated ? ' (most recent only)' : ''}. By control:{' '}
            {Object.entries(result.byControl)
              .map(([control, count]) => `${control} ${count}`)
              .join(', ') || 'none'}
            .
          </p>
          {highUrgencyNote(result) && (
            <p className="text-muted-foreground">{highUrgencyNote(result)}</p>
          )}
          {result.examples.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {result.examples.map(example => (
                <li key={`${example.incidentId}-${example.action}`} className="px-3 py-2">
                  <span className="font-medium">{example.action}</span> · {example.reason} ·{' '}
                  <a className="underline" href={`/incidents/${example.incidentId}`}>
                    {example.summary || example.incidentId}
                  </a>{' '}
                  · {formatAt(example.at)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function DecisionList({
  decisions,
  canManage,
}: {
  decisions: PrePagingDecisionRow[];
  canManage: boolean;
}) {
  if (decisions.length === 0)
    return <p className="py-4 text-sm text-muted-foreground">No decisions recorded yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {decisions.map(decision => (
        <li key={decision.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium">
              {decision.control} → {decision.action}{' '}
              <Badge variant={decision.applied ? 'default' : 'secondary'}>
                {decision.applied
                  ? 'applied'
                  : decision.mode === 'SHADOW'
                    ? 'shadow'
                    : 'not applied'}
              </Badge>{' '}
              {decision.reversedAt && <Badge variant="outline">reversed</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {decision.serviceName} · {decision.reason} · {formatAt(decision.createdAt)}
              {decision.policyVersionNumber !== null && (
                <> · policy v{decision.policyVersionNumber}</>
              )}
              {decision.incidentId && (
                <>
                  {' '}
                  ·{' '}
                  <a className="underline" href={`/incidents/${decision.incidentId}`}>
                    incident
                  </a>
                </>
              )}
            </p>
          </div>
          {canManage && !decision.reversedAt && (
            <RowButton
              action={reverseDecisionAction}
              fields={{ id: decision.id }}
              label={decision.applied ? 'Reverse and page' : 'Mark wrong'}
              confirm={
                decision.applied
                  ? {
                      title: 'Reverse this decision and page?',
                      description:
                        'The alert is sent through again and pages whoever is on call. Use Mark wrong on an unapplied decision to only record the mistake.',
                      confirmLabel: 'Reverse and page',
                    }
                  : undefined
              }
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function ChangeList({ changes, empty }: { changes: NoiseVersionDiffEntry[]; empty: string }) {
  if (changes.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-xs">
      {changes.map(change => (
        <li key={`${change.kind}:${change.path}`}>
          <span className="font-mono">{change.path}</span> — {change.summary}
        </li>
      ))}
    </ul>
  );
}

function RollbackForm({
  version,
  serviceId,
  expectedRevision,
  currentMode,
}: {
  version: NoiseControlVersionView;
  serviceId: string | null;
  expectedRevision: number;
  currentMode: string;
}) {
  const [state, action, pending] = useActionState(rollbackPolicyAction, initial);
  const needsAcknowledgement = version.mode === 'ON' && currentMode !== 'ON';
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="versionId" value={version.id} />
      <input type="hidden" name="serviceId" value={serviceId ?? ''} />
      <input type="hidden" name="expectedRevision" value={String(expectedRevision)} />
      {needsAcknowledgement && (
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="acknowledgeReadiness" /> I understand this turns noise
          controls ON
        </label>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Rolling back…' : `Roll back to v${version.versionNumber}`}
      </Button>
      <Status state={state} />
    </form>
  );
}

/**
 * Published versions of the selected scope, newest first. Each shows what it changed from the one before;
 * older versions also show what rolling back to them would change, and a rollback publishes a clone.
 */
export function PolicyVersionHistory({
  versions,
  serviceId,
  revision,
  currentMode,
  canManage,
}: {
  versions: NoiseControlVersionView[];
  serviceId: string | null;
  revision: number;
  currentMode: string;
  canManage: boolean;
}) {
  if (versions.length === 0)
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No versions yet. Publishing the policy above creates version 1.
      </p>
    );
  return (
    <ol className="divide-y divide-border">
      {versions.map(version => (
        <li key={version.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">v{version.versionNumber}</span>
            <Badge variant="secondary">{version.mode}</Badge>
            {version.active && <Badge>running</Badge>}
            {version.origin !== 'PUBLISH' && (
              <Badge variant="outline">
                {version.origin === 'ROLLBACK'
                  ? `rollback of v${version.sourceVersionNumber ?? '?'}`
                  : 'captured from pre-versioning policy'}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {formatAt(version.publishedAt)} · {version.orchestrationRuleCount} orchestration rule
              {version.orchestrationRuleCount === 1 ? '' : 's'} ·{' '}
              <span className="font-mono" title={version.checksum}>
                {version.checksum.slice(0, 10)}
              </span>
            </span>
          </div>
          <ChangeList changes={version.changes} empty="First version in this history." />
          {!version.active && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Diff against the running version ({version.changesFromActive.length} change
                {version.changesFromActive.length === 1 ? '' : 's'})
              </summary>
              <div className="pt-1">
                <ChangeList
                  changes={version.changesFromActive}
                  empty="Same content as the running version."
                />
              </div>
            </details>
          )}
          {canManage && !version.active && (
            <RollbackForm
              version={version}
              serviceId={serviceId}
              expectedRevision={revision}
              currentMode={currentMode}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
