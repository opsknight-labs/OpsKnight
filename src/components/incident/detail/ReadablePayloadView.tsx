'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink, ImageIcon } from 'lucide-react';
import { useTimezone } from '@/contexts/TimezoneContext';
import type { ReadablePayload } from '@/lib/payload-reader/types';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';

const STATUS_VIEW: Record<NonNullable<ReadablePayload['status']>, { label: string; tone: ToneKey }> = {
  firing: { label: 'Firing', tone: 'critical' },
  resolved: { label: 'Resolved', tone: 'ok' },
  acknowledged: { label: 'Acknowledged', tone: 'elevated' },
  info: { label: 'Info', tone: 'info' },
};

const SEVERITY_TONE: Array<[RegExp, ToneKey]> = [
  [/^(critical|crit|p1|sev1|sev-1|emergency|fatal|disaster|high)$/, 'critical'],
  [/^(error|major|p2|sev2|warning|warn|average|medium|p3)$/, 'elevated'],
  [/^(minor|low|info|information|p4|p5|notice|debug)$/, 'info'],
];

const CHIP = 'inline-flex h-6 items-center rounded-md border px-2 text-2xs font-semibold';

/**
 * The readable view of an alert payload (built by lib/payload-reader on the server): what fired, where, when,
 * the numbers, links and tags, then everything else as readable fields. No AI; the raw payload stays one click
 * away in the card that hosts this.
 */
export default function ReadablePayloadView({ view }: { view: ReadablePayload }) {
  const { userTimeZone } = useTimezone();
  const [showFields, setShowFields] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const status = view.status ? STATUS_VIEW[view.status] : null;
  const severityTone =
    (view.severity && SEVERITY_TONE.find(([re]) => re.test(view.severity!))?.[1]) || 'neutral';
  const longMessage = (view.message?.length ?? 0) > 280;

  return (
    <div className="min-w-0 space-y-3 text-xs">
      {/* What fired */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {view.source && (
            <span className={cn(CHIP, 'border-border bg-background text-foreground')}>
              {view.source.name}
            </span>
          )}
          {status && (
            <span className={cn(CHIP, toneClasses(status.tone).soft)}>{status.label}</span>
          )}
          {view.severity && (
            <span className={cn(CHIP, toneClasses(severityTone).soft, 'uppercase')}>
              {view.severity}
            </span>
          )}
        </div>
        {view.title && (
          <p className="text-sm font-semibold leading-snug text-foreground">{view.title}</p>
        )}
        {(view.condition || view.measured) && (
          <p className="text-xs text-muted-foreground">
            {view.condition && <span className="text-foreground/90">{view.condition}</span>}
            {view.condition && view.measured && ' · '}
            {view.measured && (
              <span className="tabular-nums">
                <span className="font-semibold text-foreground">{view.measured.value}</span>
                {view.measured.threshold && <> (threshold {view.measured.threshold})</>}
              </span>
            )}
          </p>
        )}
      </div>

      {view.query && (
        <div className="min-w-0 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5">
          <p className="mb-0.5 text-2xs font-semibold text-muted-foreground">
            Query{view.query.language ? ` · ${view.query.language}` : ''}
          </p>
          <code className="block overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
            {view.query.text}
          </code>
        </div>
      )}

      {(view.where.length > 0 || view.when.length > 0) && (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          {view.where.map(field => (
            <div key={`w-${field.label}`} className="contents">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 truncate font-medium text-foreground" title={field.value}>
                {field.value}
              </dd>
            </div>
          ))}
          {view.when.map(time => (
            <div key={`t-${time.label}`} className="contents">
              <dt className="text-muted-foreground">{time.label}</dt>
              <dd className="tabular-nums font-medium text-foreground" suppressHydrationWarning>
                {formatDateTime(time.at, userTimeZone, { format: 'datetime' })}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {view.message && (
        <div className="min-w-0">
          <p className="mb-0.5 text-2xs font-semibold text-muted-foreground">Message</p>
          <p
            className={cn(
              'whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90',
              longMessage && !showMessage && 'line-clamp-4'
            )}
          >
            {view.message}
          </p>
          {longMessage && (
            <button
              type="button"
              onClick={() => setShowMessage(v => !v)}
              className="mt-0.5 text-2xs font-medium text-primary hover:underline"
            >
              {showMessage ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>
      )}

      {(view.links.length > 0 || view.images.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {view.links.map(link => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={link.url}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-muted/60"
            >
              {link.label}
              <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
            </a>
          ))}
          {view.images.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-muted/60"
            >
              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {view.images.length > 1 ? `Graph ${i + 1}` : 'Graph'}
            </a>
          ))}
        </div>
      )}

      {view.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Tags">
          {view.tags.map(tag => (
            <li
              key={tag}
              className="inline-flex h-6 items-center rounded-md border border-border/70 bg-muted/30 px-1.5 font-mono text-2xs text-foreground/90"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      {view.fields.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFields(v => !v)}
            aria-expanded={showFields}
            className="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Other fields · {view.fields.length}
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', showFields && 'rotate-180')}
              aria-hidden
            />
          </button>
          {showFields && (
            <dl className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-3 gap-y-1 border-l-2 border-border pl-2.5">
              {view.fields.map((field, i) => (
                <div key={`${field.label}-${i}`} className="contents">
                  <dt className="truncate text-muted-foreground" title={field.label}>
                    {field.label}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-foreground/90">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
