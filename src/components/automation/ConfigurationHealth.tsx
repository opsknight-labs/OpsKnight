'use client';
import { useMemo } from 'react';
import { AlertTriangle, ChevronRight, ShieldAlert, XCircle } from 'lucide-react';
import type { LintIssue } from '@/lib/automation/compiler';
import { toneClasses } from './workspace/status';

const warningLabels = new Map([
  ['UNUSED_FIELD', 'Unused fields'],
  ['SHADOWED_RULE', 'Shadowed rules'],
  ['PRIORITY_CONFLICT', 'Conflicting priority writes'],
  ['COMPLEX_POLICY', 'Rule ordering review'],
]);

const summaryClass =
  'flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden';

export function ConfigurationHealth({ issues }: { issues: LintIssue[] }) {
  const { errors, warnings, groups } = useMemo(() => {
    const errors = issues.filter(issue => issue.level === 'ERROR');
    const warnings = issues.filter(issue => issue.level === 'WARNING');
    const groups = new Map<string, LintIssue[]>();
    for (const issue of warnings) {
      const label = warningLabels.get(issue.code) ?? 'Other warnings';
      groups.set(label, [...(groups.get(label) ?? []), issue]);
    }
    return { errors, warnings, groups };
  }, [issues]);
  if (!issues.length) return null;
  const HeadingIcon = errors.length ? ShieldAlert : AlertTriangle;
  return (
    <section
      aria-label="Configuration health"
      className="space-y-2 rounded-lg border bg-muted/30 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <HeadingIcon
            className={`h-4 w-4 shrink-0 ${errors.length ? toneClasses.error : toneClasses.warn}`}
            aria-hidden="true"
          />
          Configuration health
        </h3>
        <p className="text-xs text-muted-foreground">
          {errors.length} {errors.length === 1 ? 'error' : 'errors'} · {warnings.length}{' '}
          {warnings.length === 1 ? 'warning' : 'warnings'}
        </p>
      </div>
      {errors.map((issue, index) => (
        <p
          key={`${issue.code}-${index}`}
          role="alert"
          className={`flex gap-2 text-sm ${toneClasses.error}`}
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{issue.message}</span>
        </p>
      ))}
      {warnings.length > 0 && (
        <details className="group/warnings text-sm">
          <summary className={summaryClass}>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/warnings:rotate-90"
              aria-hidden="true"
            />
            <span>Review warnings</span>
          </summary>
          <div className="mt-2 space-y-2 pl-5">
            {Array.from(groups, ([label, group]) => (
              <details key={label} className="group/group">
                <summary className={`${summaryClass} font-medium`}>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/group:rotate-90"
                    aria-hidden="true"
                  />
                  <span>
                    {label} ({group.length})
                  </span>
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-10 text-muted-foreground">
                  {group.map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
