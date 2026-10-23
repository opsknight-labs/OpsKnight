import type { ReactNode } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Fingerprint,
  HelpCircle,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  incidentContextReasonLabel,
  toneChipClass,
  type ResponseTone,
} from '@/lib/incidents/response-presentation';
import type {
  IncidentContextFieldView,
  IncidentContextView,
} from '@/lib/incidents/response-timeline';

const STATE_LABEL = new Map<
  IncidentContextFieldView['state'],
  { label: string; tone: ResponseTone; Icon: typeof CheckCircle2 }
>([
  ['RECOGNIZED', { label: 'Recognized', tone: 'success', Icon: CheckCircle2 }],
  ['MISSING', { label: 'Missing', tone: 'neutral', Icon: CircleDashed }],
  ['UNMAPPED', { label: 'Unmapped', tone: 'warning', Icon: HelpCircle }],
]);

const TYPE_LABEL = new Map<IncidentContextFieldView['type'], string>([
  ['STRING', 'Text'],
  ['ENUM', 'Enum'],
  ['NUMBER', 'Number'],
  ['BOOLEAN', 'Boolean'],
]);

function Chip({ tone, children }: { tone: ResponseTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.25 text-[9.5px] font-semibold uppercase tracking-wider',
        toneChipClass(tone)
      )}
    >
      {children}
    </span>
  );
}

function StateChip({ state }: { state: IncidentContextFieldView['state'] }) {
  const presentation = STATE_LABEL.get(state);
  if (!presentation) return <Chip tone="neutral">{state}</Chip>;
  return (
    <Chip tone={presentation.tone}>
      <presentation.Icon className="h-2.5 w-2.5" aria-hidden="true" />
      <span className="sr-only">State: </span>
      {presentation.label}
    </Chip>
  );
}

function renderFieldValue(field: IncidentContextFieldView) {
  if (field.redacted) {
    return (
      <span className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Restricted
      </span>
    );
  }
  if (field.state === 'MISSING') {
    return <span className="text-xs italic text-muted-foreground/80">Not provided</span>;
  }
  if (field.state === 'UNMAPPED') {
    return (
      <span className="inline-flex items-center rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        Unrecognized value
      </span>
    );
  }
  const val = field.value != null ? String(field.value) : '—';
  const valLower = val.toLowerCase();

  // Highlight key operational signals (severity & urgency) with semantic tones
  if (field.key === 'severity' || field.key === 'urgency') {
    if (valLower === 'critical') {
      return (
        <span className="inline-flex items-center rounded-sm border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-300">
          {val}
        </span>
      );
    }
    if (valLower === 'high') {
      return (
        <span className="inline-flex items-center rounded-sm border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
          {val}
        </span>
      );
    }
    if (valLower === 'medium' || valLower === 'warning') {
      return (
        <span className="inline-flex items-center rounded-sm border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
          {val}
        </span>
      );
    }
    if (valLower === 'low' || valLower === 'info') {
      return (
        <span className="inline-flex items-center rounded-sm border border-slate-500/30 bg-slate-500/10 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
          {val}
        </span>
      );
    }
  }

  return (
    <span className="break-all font-mono text-xs font-medium text-foreground select-all">
      {val}
    </span>
  );
}

const MAX_INITIAL_FIELDS = 6;

export type IncidentContextCardProps = {
  context: IncidentContextView;
  className?: string;
  embedded?: boolean;
};

/**
 * Checksum-verified automation context captured with the live routing decision.
 * The same context drives runbook triggers and context-derived Agent targeting.
 */
export default function IncidentContextCard({
  context,
  className,
  embedded = false,
}: IncidentContextCardProps) {
  if (context.visibility === 'HIDDEN') return null;
  const available = context.status === 'AVAILABLE';
  const integrityTone: ResponseTone = available
    ? 'success'
    : context.reason === 'INTEGRITY_FAILED'
      ? 'critical'
      : 'warning';

  const renderField = (field: IncidentContextFieldView) => {
    const typeLabel = TYPE_LABEL.get(field.type) ?? field.type;
    const isRecognized = field.state === 'RECOGNIZED';
    const isAlert = field.source === 'ALERT';
    const isEnriched = field.source === 'ENRICHMENT';

    return (
      <div
        key={field.key}
        className="flex min-w-0 items-center justify-between gap-2.5 rounded-lg border border-border/50 bg-background/60 dark:bg-muted/15 px-3 py-2 text-xs transition-colors hover:border-border/80 hover:bg-muted/25"
        data-testid={`context-field-${field.key}`}
      >
        <dt className="flex min-w-0 items-center gap-1.5 shrink-0">
          <span className="font-mono text-xs font-medium text-muted-foreground select-all">
            {field.key}
          </span>
          <span className="sr-only">Type: {typeLabel}</span>
        </dt>
        <dd className="flex min-w-0 items-center justify-end gap-1.5">
          {renderFieldValue(field)}
          {isRecognized ? (
            <span className="sr-only">Recognized</span>
          ) : (
            <StateChip state={field.state} />
          )}
          {isAlert && <span className="sr-only">Source: Alert</span>}
          {isEnriched && (
            <Chip tone="oncall">
              <span className="sr-only">Source: </span>Enrichment
            </Chip>
          )}
        </dd>
      </div>
    );
  };

  const hasFields = available && context.fields.length > 0;
  const hasOverflow = available && context.fields.length > MAX_INITIAL_FIELDS;
  const initialFields = hasOverflow
    ? context.fields.slice(0, MAX_INITIAL_FIELDS)
    : available
      ? context.fields
      : [];
  const overflowFields = hasOverflow ? context.fields.slice(MAX_INITIAL_FIELDS) : [];

  const innerContent = (
    <>
      <p className="text-[10.5px] leading-normal text-muted-foreground">
        {available
          ? 'Verified field states that runbook triggers and Agent targeting act on. Only recognized fields are used.'
          : 'Context-based runbook triggers and targeting are skipped for this incident.'}
      </p>
      {available && context.visibility === 'REDACTED' && (
        <p className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          Context values are restricted. Field names, states and sources remain visible.
        </p>
      )}
      {!available && embedded && (
        <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5 text-xs text-foreground">
          {incidentContextReasonLabel(context.reason)}
        </div>
      )}
      {available &&
        (hasFields ? (
          <>
            <dl className="grid min-w-0 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
              {initialFields.map(renderField)}
            </dl>
            {hasOverflow && (
              <details className="mt-1">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary hover:underline select-none">
                  Show {overflowFields.length} more context fields
                </summary>
                <dl className="mt-1.5 grid min-w-0 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                  {overflowFields.map(renderField)}
                </dl>
              </details>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            The automation version declares no context fields.
          </p>
        ))}
    </>
  );

  if (embedded) {
    return (
      <div className={cn('min-w-0 space-y-2', className)}>
        <h2 id="incident-context-heading" className="sr-only">
          Incident context
        </h2>
        {innerContent}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="incident-context-heading"
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card text-sm text-card-foreground shadow-2xs',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/80 bg-muted/20 px-3 py-2 sm:px-3.5">
        <h2
          id="incident-context-heading"
          className="flex items-center gap-1.5 text-xs font-semibold tracking-tight"
        >
          <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Incident context
        </h2>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
            toneChipClass(integrityTone)
          )}
        >
          {available ? (
            <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          {available
            ? `Integrity verified · automation v${context.versionNumber}`
            : incidentContextReasonLabel(context.reason)}
        </span>
      </div>
      <div className="space-y-2 p-2.5 sm:p-3">{innerContent}</div>
    </section>
  );
}
