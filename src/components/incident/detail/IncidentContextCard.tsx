import type { ReactNode } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Fingerprint,
  HelpCircle,
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
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
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
      <presentation.Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">State: </span>
      {presentation.label}
    </Chip>
  );
}

function displayValue(field: IncidentContextFieldView): string {
  if (field.redacted) return 'Restricted';
  if (field.state === 'MISSING') return 'Not provided';
  if (field.state === 'UNMAPPED') return 'Unrecognized value';
  return field.value ?? '—';
}

/**
 * Checksum-verified automation context captured with the live routing decision.
 * The same context drives runbook triggers and context-derived Agent targeting.
 */
export default function IncidentContextCard({
  context,
  className,
}: {
  context: IncidentContextView;
  className?: string;
}) {
  if (context.visibility === 'HIDDEN') return null;
  const available = context.status === 'AVAILABLE';
  const integrityTone: ResponseTone = available
    ? 'success'
    : context.reason === 'INTEGRITY_FAILED'
      ? 'critical'
      : 'warning';
  return (
    <section
      aria-labelledby="incident-context-heading"
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-border bg-card text-sm text-card-foreground shadow-sm',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2
          id="incident-context-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <Fingerprint className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Incident context
        </h2>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            toneChipClass(integrityTone)
          )}
        >
          {available ? (
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {available
            ? `Integrity verified · automation v${context.versionNumber}`
            : incidentContextReasonLabel(context.reason)}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          {available
            ? 'Verified field states that runbook triggers and Agent targeting act on. Only recognized fields are used.'
            : 'Context-based runbook triggers and targeting are skipped for this incident.'}
        </p>
        {available && context.visibility === 'REDACTED' && (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Context values are restricted. Field names, states and sources remain visible.
          </p>
        )}
        {available &&
          (context.fields.length ? (
            <dl className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
              {context.fields.map(field => (
                <div
                  key={field.key}
                  className="min-w-0 rounded-lg border border-border/70 px-3 py-2"
                  data-testid={`context-field-${field.key}`}
                >
                  <dt className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="break-all font-mono text-xs font-semibold">{field.key}</span>
                    <span className="flex flex-wrap gap-1">
                      <Chip tone="neutral">
                        <span className="sr-only">Type: </span>
                        {TYPE_LABEL.get(field.type) ?? field.type}
                      </Chip>
                      <StateChip state={field.state} />
                      {field.source !== 'NONE' && (
                        <Chip tone={field.source === 'ALERT' ? 'info' : 'oncall'}>
                          <span className="sr-only">Source: </span>
                          {field.source === 'ALERT' ? 'Alert' : 'Enrichment'}
                        </Chip>
                      )}
                    </span>
                  </dt>
                  <dd
                    className={cn(
                      'mt-1 break-words text-xs',
                      field.redacted || field.state !== 'RECOGNIZED'
                        ? 'italic text-muted-foreground'
                        : 'text-foreground'
                    )}
                  >
                    {displayValue(field)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              The automation version declares no context fields.
            </p>
          ))}
      </div>
    </section>
  );
}
