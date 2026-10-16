import type { ReactNode } from 'react';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { cn } from '@/lib/utils';
import { RuleStatusPill } from './RuleStatusPill';
import { RuleTimestamp } from './RuleTimestamp';
import { TONE_DOT, TONE_TEXT, type ReadinessTone, type RuleStatusKind } from './rule-presentation';

export type RuleGlance = {
  mode: string;
  status: RuleStatusKind;
  trigger: string;
  target: string;
  version: string;
  readiness: { label: string; tone: ReadinessTone };
  eligibleAgents: number | null;
  certifiedAgents: number;
  lastRun: { status: string; iso: string; relative: string; absolute: string } | null;
  successRate: number | null;
  recentRuns: number;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

export function RuleAtAGlance({ glance }: { glance: RuleGlance }) {
  return (
    <dl className="divide-y">
      <Row label="Mode">{glance.mode}</Row>
      <Row label="Status">
        <RuleStatusPill kind={glance.status} />
      </Row>
      <Row label="Trigger">{glance.trigger}</Row>
      <Row label="Target">{glance.target}</Row>
      <Row label="Version">{glance.version}</Row>
      <Row label="Readiness">
        <span className={cn('inline-flex items-center gap-2', TONE_TEXT[glance.readiness.tone])}>
          <span
            aria-hidden
            className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[glance.readiness.tone])}
          />
          {glance.readiness.label}
        </span>
      </Row>
      <Row label="Eligible Agents">{glance.eligibleAgents ?? '—'}</Row>
      <Row label="Certified Agents">{glance.certifiedAgents}</Row>
      <Row label="Last run">
        {glance.lastRun ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <RunbookStatusBadge status={glance.lastRun.status} size="sm" />
            <RuleTimestamp
              iso={glance.lastRun.iso}
              relative={glance.lastRun.relative}
              absolute={glance.lastRun.absolute}
              className="text-xs font-normal text-muted-foreground"
            />
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">Never</span>
        )}
      </Row>
      <Row label={`Success rate (last ${glance.recentRuns || 50})`}>
        {glance.successRate === null ? (
          <span className="font-normal text-muted-foreground">No finished runs</span>
        ) : (
          <span
            className={cn(
              glance.successRate >= 90
                ? TONE_TEXT.success
                : glance.successRate >= 60
                  ? TONE_TEXT.warning
                  : TONE_TEXT.danger
            )}
          >
            {glance.successRate}%
          </span>
        )}
      </Row>
    </dl>
  );
}
