'use client';
import { memo, useId, useMemo } from 'react';
import { ArrowRight, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import type { Rule } from '@/lib/automation/contract';
import type { LintIssue } from '@/lib/automation/compiler';
import { cn } from '@/lib/utils';
import { noticeClasses } from './status';

/** Lists publish-blocking errors with a direct jump to the rule or context field at fault. */
export const ValidationSummary = memo(function ValidationSummary({
  issues,
  rules,
  onOpenRule,
  onOpenContext,
}: {
  issues: LintIssue[];
  rules: Rule[];
  onOpenRule: (ruleId: string) => void;
  onOpenContext: () => void;
}) {
  const headingId = useId();
  const errors = useMemo(() => issues.filter(issue => issue.level === 'ERROR'), [issues]);
  const ruleNames = useMemo(() => new Map(rules.map(rule => [rule.id, rule.name])), [rules]);
  if (!errors.length) return null;
  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-lg border p-3 sm:p-4', noticeClasses.error)}
    >
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {errors.length} blocking {errors.length === 1 ? 'issue prevents' : 'issues prevent'}{' '}
        publishing
      </h3>
      <ul className="mt-2 space-y-2 text-sm">
        {errors.map((issue, index) => {
          const ruleName = issue.ruleId ? ruleNames.get(issue.ruleId) : undefined;
          const fieldIssue = !ruleName && issue.code.includes('FIELD');
          return (
            <li
              key={`${issue.code}-${issue.ruleId ?? ''}-${index}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <span className="min-w-0 break-words">{issue.message}</span>
              {ruleName !== undefined && issue.ruleId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 sm:h-9"
                  onClick={() => onOpenRule(issue.ruleId!)}
                >
                  Open rule {ruleName}
                  <ArrowRight aria-hidden="true" />
                </Button>
              )}
              {fieldIssue && (
                <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={onOpenContext}>
                  Open context fields
                  <ArrowRight aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
});
