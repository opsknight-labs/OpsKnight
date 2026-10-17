'use client';
import type { LintIssue } from '@/lib/automation/compiler';

const warningLabels = new Map([
  ['UNUSED_FIELD', 'Unused fields'],
  ['SHADOWED_RULE', 'Shadowed rules'],
  ['PRIORITY_CONFLICT', 'Conflicting priority writes'],
  ['COMPLEX_POLICY', 'Rule ordering review'],
]);

export function ConfigurationHealth({ issues }: { issues: LintIssue[] }) {
  const errors = issues.filter(issue => issue.level === 'ERROR');
  const warnings = issues.filter(issue => issue.level === 'WARNING');
  if (!issues.length) return null;
  const groups = new Map<string, LintIssue[]>();
  for (const issue of warnings) {
    const label = warningLabels.get(issue.code) ?? 'Other warnings';
    groups.set(label, [...(groups.get(label) ?? []), issue]);
  }
  return (
    <section
      aria-label="Configuration health"
      className="rounded-lg border bg-muted/30 p-3 space-y-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Configuration health</h3>
        <p className="text-xs text-muted-foreground">
          {errors.length} {errors.length === 1 ? 'error' : 'errors'} · {warnings.length}{' '}
          {warnings.length === 1 ? 'warning' : 'warnings'}
        </p>
      </div>
      {errors.map((issue, index) => (
        <p key={`${issue.code}-${index}`} role="alert" className="text-sm text-destructive">
          {issue.message}
        </p>
      ))}
      {warnings.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Review warnings
          </summary>
          <div className="mt-3 space-y-3">
            {Array.from(groups, ([label, group]) => (
              <details key={label}>
                <summary className="cursor-pointer font-medium">
                  {label} ({group.length})
                </summary>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground space-y-1">
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
