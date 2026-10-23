import type { ReactNode } from 'react';
import {
  AlertTriangle,
  BellOff,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  HelpCircle,
  Lock,
  Pin,
  Route,
  Send,
  Workflow,
  XCircle,
} from 'lucide-react';
import IncidentAlertContextCard from './IncidentAlertContextCard';
import { builtinFields, snapshotSchema } from '@/lib/automation/contract';
import { decodeExplanation } from '@/lib/automation/explanation';
import { toneChipClass, type ResponseTone } from '@/lib/incidents/response-presentation';
import prisma from '@/lib/prisma';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { cn } from '@/lib/utils';

type Presentation = { label: string; tone: ResponseTone; Icon: typeof CheckCircle2 };

const NOTIFICATION_STATUS: Record<string, Presentation> = {
  PENDING: { label: 'Queued', tone: 'neutral', Icon: Clock },
  SENT: { label: 'Accepted by provider', tone: 'info', Icon: Send },
  DELIVERED: { label: 'Delivery confirmed', tone: 'success', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', tone: 'critical', Icon: XCircle },
  SKIPPED: { label: 'Skipped', tone: 'neutral', Icon: CircleSlash },
  UNKNOWN: { label: 'Delivery uncertain', tone: 'warning', Icon: HelpCircle },
};

const MODE_LABEL: Record<string, string> = {
  LIVE: 'Live',
  SHADOW: 'Shadow',
  DISABLED: 'Disabled',
};

function Chip({ tone, children }: { tone: ResponseTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        toneChipClass(tone)
      )}
    >
      {children}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card p-2 sm:p-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 break-words text-xs font-semibold">
        {children}
      </dd>
    </div>
  );
}

export default async function IncidentAutomationCard({ incidentId }: { incidentId: string }) {
  await assertCanViewIncident(incidentId);
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes('automation.read')) return null;
  const sensitive = permissions.capabilities.includes('incident.sensitive.read');
  const decision = await prisma.incidentAutomationDecision.findUnique({
    where: { incidentId },
    include: { version: { select: { versionNumber: true, snapshot: true } } },
  });
  if (!decision) return null;
  const notifications = await prisma.notification.groupBy({
    by: ['channel', 'status'],
    where: {
      incidentId,
      OR: [
        { eventType: 'triggered' },
        {
          templateKey: {
            in: ['automation-slack', 'service-slack-triggered', 'service-teams-triggered'],
          },
        },
      ],
      channel: { in: ['SLACK', 'MICROSOFT_TEAMS'] },
    },
    _count: { _all: true },
  });
  const summary = (sensitive ? decodeExplanation(decision.summary) : {}) as {
    inputContext?: Record<string, { state: string; value?: unknown; raw?: unknown }>;
    enrichedContext?: Record<string, { state: string; value?: unknown; raw?: unknown }>;
    normalization?: Array<{
      fieldKey: string;
      raw: unknown;
      canonical: { state: string; value?: unknown };
    }>;
    writes?: Array<{ fieldKey: string; value: unknown }>;
    diagnosticsOmitted?: boolean;
    omittedValues?: number[];
    supplementalActions?: Array<{ provider: string }>;
  };
  const version = snapshotSchema.safeParse(decision.version?.snapshot);
  const fields = version.success ? version.data.fields : [];
  const context = summary.enrichedContext ?? summary.inputContext ?? {};
  const matchedRule = version.success
    ? version.data.rules.find(
        rule => rule.id === decision.matchedRouteRuleId && rule.phase === 'ROUTE'
      )
    : undefined;
  const fieldLabels = new Map([...builtinFields, ...fields].map(field => [field.key, field.label]));
  const operators = new Map([
    ['EQ', 'equals'],
    ['NE', 'does not equal'],
    ['IN', 'is one of'],
    ['NOT_IN', 'is not one of'],
    ['LT', 'is less than'],
    ['LTE', 'is at most'],
    ['GT', 'is greater than'],
    ['GTE', 'is at least'],
    ['IS_SET', 'is provided'],
    ['IS_MISSING', 'is not provided'],
    ['IS_UNMAPPED', 'is unrecognized'],
  ]);
  const matchedRuleName = decision.matchedRouteRuleName ?? matchedRule?.name;
  const route: Presentation = decision.fallbackReason
    ? { label: 'Fallback · service default', tone: 'warning', Icon: AlertTriangle }
    : decision.routeType === 'NO_ESCALATION'
      ? { label: 'No escalation', tone: 'warning', Icon: BellOff }
      : decision.routeType === 'ESCALATION_POLICY'
        ? {
            label: decision.mode === 'LIVE' ? 'Policy pinned' : 'Policy selected',
            tone: 'info',
            Icon: Pin,
          }
        : { label: 'Service default', tone: 'neutral', Icon: Route };
  const priorityChanged =
    decision.finalPriority != null && decision.basePriority !== decision.finalPriority;
  const modeLabel = decision.mode ? (MODE_LABEL[decision.mode] ?? decision.mode) : null;
  const selectedChannels = [
    ...new Set(
      (summary.supplementalActions ?? []).map(action =>
        action.provider === 'TEAMS' ? 'Teams' : 'Slack'
      )
    ),
  ];
  const hasEvaluation =
    !!summary.normalization?.length ||
    !!Object.keys(summary.inputContext ?? {}).length ||
    !!summary.writes?.length;
  return (
    <div className="space-y-3">
      <IncidentAlertContextCard
        fields={fields}
        context={context}
        receivedContext={summary.inputContext}
        versionNumber={decision.version?.versionNumber}
        sensitive={sensitive}
        omitted={!!summary.diagnosticsOmitted || !!summary.omittedValues?.length}
      />
      <section
        aria-labelledby="incident-automation-decision-heading"
        className="min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card text-sm text-card-foreground shadow-2xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-muted/20 px-3 py-2 sm:px-3.5">
          <h2
            id="incident-automation-decision-heading"
            className="flex items-center gap-2 text-xs font-semibold tracking-tight"
          >
            <Workflow className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Automation Decision
          </h2>
          <Chip tone={route.tone}>
            <route.Icon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Route outcome: </span>
            {route.label}
          </Chip>
        </div>
        <div className="min-w-0 space-y-2 break-words p-2.5 sm:p-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-2 space-y-1">
            <p className="text-xs font-semibold text-foreground">
              {matchedRuleName
                ? `Matched rule: ${matchedRuleName}`
                : decision.fallbackReason
                  ? 'Automation could not be applied; service-default routing was used.'
                  : decision.routeType === 'NO_ESCALATION'
                    ? 'Personal paging was intentionally skipped by automation.'
                    : decision.routeType === 'ESCALATION_POLICY'
                      ? 'An escalation policy was selected by automation.'
                      : 'No routing rule matched; service-default routing was used.'}
            </p>
            {sensitive && !!matchedRule?.conditions.length && (
              <ul
                aria-label="Matched rule conditions"
                className="flex flex-wrap gap-1.5 text-xs text-muted-foreground"
              >
                {matchedRule.conditions.map((condition, index) => (
                  <li
                    key={index}
                    className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-background/90 px-2 py-0.5 font-mono text-[11px]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    {`${fieldLabels.get(condition.fieldKey) ?? condition.fieldKey} ${operators.get(condition.operator) ?? condition.operator}${
                      condition.value === undefined
                        ? ''
                        : ` ${Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value)}`
                    }`}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <dl className="grid min-w-0 gap-2 sm:grid-cols-3">
            <Fact label="Responder route">
              {decision.routeType === 'NO_ESCALATION'
                ? 'Personal paging intentionally skipped'
                : (decision.escalationPolicyNameSnapshot ?? 'Service default')}
            </Fact>
            <Fact label="Priority">
              <span>
                <span className="sr-only">Base </span>
                {decision.basePriority ?? 'Unset'}
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> final </span>
                <span className={cn(priorityChanged && 'font-semibold text-primary')}>
                  {decision.finalPriority ?? 'Unset'}
                </span>
              </span>
              {priorityChanged && (
                <span className="text-xs font-normal text-muted-foreground">
                  (set by automation)
                </span>
              )}
            </Fact>
            <Fact label="Automation">
              v{decision.version?.versionNumber ?? '—'}
              {modeLabel && (
                <Chip tone={decision.mode === 'LIVE' ? 'success' : 'neutral'}>
                  <span className="sr-only">Mode: </span>
                  {modeLabel}
                </Chip>
              )}
            </Fact>
          </dl>
          {decision.fallbackReason && (
            <p className={cn('rounded-md border px-2.5 py-1 text-xs', toneChipClass('warning'))}>
              {`Fallback: ${decision.fallbackReason}`}
            </p>
          )}
          {sensitive && !!selectedChannels.length && (
            <p className="text-xs text-muted-foreground">{`Selected channel actions: ${selectedChannels.join(', ')}.`}</p>
          )}
          <section
            aria-label="Channel notification status"
            className="space-y-1 rounded-lg border border-border/60 bg-muted/15 p-2 sm:p-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h3 className="text-xs font-semibold">Incident channel notifications</h3>
              <p className="text-[10.5px] text-muted-foreground">
                Current notification records are separate from the routing decision. Provider
                acceptance does not confirm delivery.
              </p>
            </div>
            {notifications.length ? (
              <ul className="flex flex-wrap gap-1.5 pt-0.5">
                {notifications.map(row => {
                  const status = NOTIFICATION_STATUS[row.status];
                  const StatusIcon = status?.Icon ?? HelpCircle;
                  return (
                    <li
                      key={`${row.channel}:${row.status}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-card px-2 py-0.5 text-xs"
                    >
                      <span
                        className={cn(
                          'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                          toneChipClass(status?.tone ?? 'neutral')
                        )}
                      >
                        <StatusIcon className="h-2 w-2" aria-hidden="true" />
                      </span>
                      <span className="text-[11px]">
                        {`${row.channel === 'SLACK' ? 'Slack' : 'Teams'} · ${row._count._all} · ${status?.label ?? row.status}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No channel notification records are available.
              </p>
            )}
          </section>
          {!sensitive && (
            <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Evaluation context is restricted.
            </p>
          )}
          {sensitive && (
            <details className="group rounded-lg border border-border/70 bg-card">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                View evaluation
                <ChevronDown
                  className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-2 border-t border-border/70 px-2.5 py-2 text-xs">
                {!hasEvaluation && (
                  <p className="text-muted-foreground">No evaluation details were stored.</p>
                )}
                {!!summary.normalization?.length && (
                  <div>
                    <h4 className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">
                      Normalization
                    </h4>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                      {summary.normalization.map(n => (
                        <li key={n.fieldKey} className="break-all">
                          {`${n.fieldKey}: ${String(n.raw ?? 'Missing')} → ${
                            n.canonical.state === 'RECOGNIZED'
                              ? String(n.canonical.value)
                              : n.canonical.state.toLowerCase()
                          }`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!Object.keys(summary.inputContext ?? {}).length && (
                  <div>
                    <h4 className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">
                      Evaluated input
                    </h4>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                      {Object.entries(summary.inputContext ?? {}).map(([key, field]) => (
                        <li key={key} className="break-all">
                          {`${key}: ${field.state === 'MISSING' ? 'Missing' : String(field.value ?? field.raw)}${
                            field.state === 'UNMAPPED' ? ' (unmapped)' : ''
                          }`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!summary.writes?.length && (
                  <div>
                    <h4 className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">
                      Context writes
                    </h4>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                      {summary.writes.map((write, i) => (
                        <li key={i} className="break-all">
                          {`${write.fieldKey} → ${String(write.value)}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
