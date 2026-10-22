import type { ReactNode } from 'react';
import { CheckCircle2, CircleDashed, HelpCircle, ListTree, Lock } from 'lucide-react';
import type { Field } from '@/lib/automation/contract';
import { toneChipClass, type ResponseTone } from '@/lib/incidents/response-presentation';
import { cn } from '@/lib/utils';

type CapturedValue = { state: string; value?: unknown; raw?: unknown };
type ValueState = 'RECOGNIZED' | 'MISSING' | 'UNMAPPED';

const MAX_INLINE_CHARACTERS = 160;

const STATE_PRESENTATION: Record<
  ValueState,
  { label: string; tone: ResponseTone; Icon: typeof CheckCircle2 }
> = {
  RECOGNIZED: { label: 'Recognized', tone: 'success', Icon: CheckCircle2 },
  MISSING: { label: 'Missing', tone: 'neutral', Icon: CircleDashed },
  UNMAPPED: { label: 'Unmapped', tone: 'warning', Icon: HelpCircle },
};

const TYPE_LABEL: Record<Field['type'], string> = {
  STRING: 'Text',
  ENUM: 'Enum',
  NUMBER: 'Number',
  BOOLEAN: 'Boolean',
};

const summaryClass =
  'inline-flex min-h-8 cursor-pointer items-center rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function stateOf(value: CapturedValue | undefined): ValueState {
  if (!value || value.state === 'MISSING') return 'MISSING';
  if (value.state === 'UNMAPPED') return 'UNMAPPED';
  return 'RECOGNIZED';
}

function describe(value: CapturedValue | undefined): string {
  const state = stateOf(value);
  if (state === 'MISSING') return 'Not provided';
  if (state === 'UNMAPPED') return 'Unrecognized value';
  return value?.value == null ? 'Diagnostic value unavailable' : String(value.value);
}

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

function ValueText({
  text,
  muted,
  summary,
  summaryLabel,
}: {
  text: string;
  muted: boolean;
  summary: string;
  summaryLabel: string;
}) {
  const characters = [...text];
  const className = cn('break-words', muted ? 'italic text-muted-foreground' : 'text-foreground');
  if (characters.length <= MAX_INLINE_CHARACTERS) return <span className={className}>{text}</span>;
  return (
    <>
      <span className={className}>{characters.slice(0, MAX_INLINE_CHARACTERS).join('')}…</span>
      <details>
        <summary className={summaryClass} aria-label={summaryLabel}>
          {summary}
        </summary>
        <p className="break-words text-foreground">{text}</p>
      </details>
    </>
  );
}

export default function IncidentAlertContextCard({
  fields,
  context,
  receivedContext,
  versionNumber,
  sensitive,
  omitted,
}: {
  fields: Field[];
  context: Record<string, CapturedValue>;
  receivedContext?: Record<string, CapturedValue>;
  versionNumber?: number;
  sensitive: boolean;
  omitted: boolean;
}) {
  const relevant = fields.filter(
    field => context[field.key] && context[field.key].state !== 'MISSING'
  );
  const visible = relevant.length ? relevant.slice(0, 6) : fields.slice(0, 6);
  const visibleKeys = new Set(visible.map(field => field.key));
  const remaining = fields.filter(field => !visibleKeys.has(field.key));
  function renderField(field: Field) {
    const value = context[field.key];
    const state = stateOf(value);
    const presentation =
      state === 'RECOGNIZED'
        ? STATE_PRESENTATION.RECOGNIZED
        : state === 'UNMAPPED'
          ? STATE_PRESENTATION.UNMAPPED
          : STATE_PRESENTATION.MISSING;
    const received = receivedContext?.[field.key];
    const changed =
      receivedContext &&
      (received?.state !== value?.state ||
        JSON.stringify(received?.value) !== JSON.stringify(value?.value));
    const muted = state !== 'RECOGNIZED' || value?.value == null;
    return (
      <div
        key={field.key}
        className="min-w-0 rounded-lg border border-border/70 bg-card p-2 sm:p-2.5 transition-colors hover:border-border"
        data-testid={`alert-context-field-${field.key}`}
      >
        <dt className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="min-w-0 break-words text-xs font-semibold text-foreground">
            {field.label}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <Chip tone="neutral">
              <span className="sr-only">Type: </span>
              {TYPE_LABEL[field.type] ?? field.type}
            </Chip>
            <Chip tone={presentation.tone}>
              <presentation.Icon className="h-2.5 w-2.5" aria-hidden="true" />
              <span className="sr-only">State: </span>
              {presentation.label}
            </Chip>
            {changed ? (
              <Chip tone="oncall">
                <span className="sr-only">Source: </span>Enriched
              </Chip>
            ) : receivedContext && state !== 'MISSING' ? (
              <Chip tone="info">
                <span className="sr-only">Source: </span>Alert
              </Chip>
            ) : null}
          </span>
        </dt>
        <dd className="mt-1 space-y-0.5 text-xs">
          {changed && (
            <div className="flex flex-wrap items-baseline gap-1 text-[11px]">
              <span className="text-muted-foreground">Received value: </span>
              <ValueText
                text={stateOf(received) === 'MISSING' ? 'Not in alert' : describe(received)}
                muted
                summary="Show full received value"
                summaryLabel={`Show full received ${field.label}`}
              />
            </div>
          )}
          <div className="flex flex-wrap items-baseline gap-1">
            {changed && (
              <span className="text-[11px] font-semibold text-foreground">
                Value after automation:{' '}
              </span>
            )}
            <ValueText
              text={describe(value)}
              muted={muted}
              summary="Show full value"
              summaryLabel={`Show full ${field.label}`}
            />
          </div>
        </dd>
      </div>
    );
  }
  return (
    <section
      aria-labelledby="incident-alert-context-heading"
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-sm text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 sm:px-4">
        <h2
          id="incident-alert-context-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <ListTree className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Alert Context
        </h2>
        <Chip tone="neutral">Automation · v{versionNumber ?? '—'}</Chip>
      </div>
      <div className="space-y-2.5 p-3 sm:p-3.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          What the alert sent when this incident was created, by field. Where automation changed a
          field, the received value is shown above the value after automation.
        </p>
        {!sensitive ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Alert context is restricted.
          </p>
        ) : (
          <>
            {omitted && (
              <p className={cn('rounded-md border px-3 py-1.5 text-xs', toneChipClass('warning'))}>
                Some diagnostic values were omitted from the stored explanation.
              </p>
            )}
            {fields.length ? (
              <>
                <dl className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {visible.map(renderField)}
                </dl>
                {!!remaining.length && (
                  <details>
                    <summary className={summaryClass}>
                      Show {remaining.length} more context fields
                    </summary>
                    <dl className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {remaining.map(renderField)}
                    </dl>
                  </details>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No mapped alert context was captured.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
