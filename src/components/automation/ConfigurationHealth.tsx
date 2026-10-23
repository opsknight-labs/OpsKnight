'use client';
import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  ChevronRight,
  Database,
  EyeOff,
  Info,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import type { LintIssue } from '@/lib/automation/compiler';
import type { Rule } from '@/lib/automation/contract';

const WARNING_CONFIG = new Map<string, { label: string; description: string; icon: LucideIcon }>([
  [
    'PRIORITY_CONFLICT',
    {
      label: 'Conflicting priority writes',
      description:
        'Multiple enrichment rules write priority without mutually exclusive conditions. The last matching rule wins.',
      icon: ArrowDownUp,
    },
  ],
  [
    'UNUSED_FIELD',
    {
      label: 'Unused fields',
      description:
        'Declared context fields that are not evaluated in any conditions or written by actions.',
      icon: Database,
    },
  ],
  [
    'SHADOWED_RULE',
    {
      label: 'Shadowed rules',
      description:
        'An earlier unconditional routing rule prevents subsequent rules from ever being reached.',
      icon: EyeOff,
    },
  ],
  [
    'COMPLEX_POLICY',
    {
      label: 'Rule ordering review',
      description:
        'Large rule configurations benefit from review to guarantee intended top-to-bottom precedence.',
      icon: SlidersHorizontal,
    },
  ],
]);

const warningLabels = new Map([
  ['UNUSED_FIELD', 'Unused fields'],
  ['SHADOWED_RULE', 'Shadowed rules'],
  ['PRIORITY_CONFLICT', 'Conflicting priority writes'],
  ['COMPLEX_POLICY', 'Rule ordering review'],
]);

export function ConfigurationHealth({
  issues,
  rules = [],
  onOpenRule,
  onOpenContext,
}: {
  issues: LintIssue[];
  rules?: Rule[];
  onOpenRule?: (ruleId: string) => void;
  onOpenContext?: () => void;
}) {
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

  const rulesById = useMemo(() => new Map(rules.map(rule => [rule.id, rule])), [rules]);

  if (!issues.length) return null;

  const hasErrors = errors.length > 0;
  const HeadingIcon = hasErrors ? ShieldAlert : AlertTriangle;

  return (
    <section
      aria-label="Configuration health"
      className={cn(
        'overflow-hidden rounded-xl border p-3.5 shadow-xs transition-all space-y-3',
        hasErrors
          ? 'border-destructive/40 bg-destructive/5 text-destructive dark:border-destructive/50 dark:bg-destructive/10'
          : 'border-amber-500/30 bg-amber-500/5 text-foreground dark:border-amber-500/20 dark:bg-amber-950/20'
      )}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-2xs',
              hasErrors
                ? 'bg-destructive/15 text-destructive'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            )}
          >
            <HeadingIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">
                Configuration health
              </h3>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-semibold tracking-wide uppercase',
                  hasErrors
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                )}
              >
                {hasErrors ? 'Action required' : 'Review recommended'}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {hasErrors
                ? 'Blocking validation errors must be resolved before publishing.'
                : 'Static analysis check of rule ordering, precedence, and field usage.'}
            </p>
          </div>
        </div>

        <p className="font-mono text-xs font-medium tabular-nums text-muted-foreground">
          {errors.length} {errors.length === 1 ? 'error' : 'errors'} · {warnings.length}{' '}
          {warnings.length === 1 ? 'warning' : 'warnings'}
        </p>
      </div>

      {/* Errors list */}
      {hasErrors && (
        <div className="space-y-1.5 pt-1">
          {errors.map((issue, index) => {
            const rule = issue.ruleId ? rulesById.get(issue.ruleId) : undefined;
            return (
              <div
                key={`${issue.code}-${index}`}
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-background/80 p-2.5 text-xs text-destructive shadow-2xs"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="font-semibold">{issue.message}</span>
                    {rule && (
                      <span className="ml-1.5 text-muted-foreground font-mono text-[11px]">
                        in rule &ldquo;{rule.name}&rdquo;
                      </span>
                    )}
                  </div>
                </div>
                {issue.ruleId && onOpenRule && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-medium gap-1 text-destructive hover:bg-destructive/10"
                    onClick={() => onOpenRule(issue.ruleId!)}
                  >
                    Open rule
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Warnings Disclosures */}
      {warnings.length > 0 && (
        <details className="group/warnings overflow-hidden rounded-xl border border-amber-500/25 bg-background/70 shadow-2xs">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open/warnings:rotate-90"
                aria-hidden="true"
              />
              <span className="font-semibold text-foreground">Review warnings</span>
            </span>
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 font-mono">
              {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'} to inspect
            </span>
          </summary>

          <div className="space-y-2.5 border-t border-border/60 bg-muted/10 p-2.5 sm:p-3">
            {Array.from(groups, ([label, group]) => {
              const code = group[0]?.code ?? '';
              const meta = WARNING_CONFIG.get(code);
              const CategoryIcon = meta?.icon ?? Info;

              return (
                <details
                  key={label}
                  className="group/group overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xs"
                  open
                >
                  <summary className="flex min-h-8.5 cursor-pointer list-none items-center justify-between gap-2 bg-muted/20 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open/group:rotate-90"
                        aria-hidden="true"
                      />
                      <CategoryIcon
                        className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        {label} ({group.length})
                      </span>
                    </span>
                    <Badge
                      variant="outline"
                      className="border-border/70 bg-background font-mono text-[10px] font-medium text-muted-foreground"
                    >
                      {group.length} {group.length === 1 ? 'item' : 'items'}
                    </Badge>
                  </summary>

                  <div className="border-t border-border/60 p-2.5 sm:p-3 space-y-2 bg-background/50">
                    {meta?.description && (
                      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground pb-1">
                        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <span>{meta.description}</span>
                      </div>
                    )}

                    <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-background text-xs overflow-hidden">
                      {group.map((issue, index) => {
                        const rule = issue.ruleId ? rulesById.get(issue.ruleId) : undefined;
                        const unusedFieldMatch = issue.message.match(/^Field\s+(.+)\s+is unused$/);
                        const fieldName = unusedFieldMatch ? unusedFieldMatch[1] : null;

                        return (
                          <li
                            key={index}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                              <div className="min-w-0">
                                {fieldName ? (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className="font-mono text-[10px] font-semibold bg-muted/40 text-foreground"
                                    >
                                      {fieldName}
                                    </Badge>
                                    <span className="text-muted-foreground text-[11px]">
                                      is unused in draft rules
                                    </span>
                                  </div>
                                ) : rule ? (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className="font-mono text-[10px] font-semibold bg-primary/10 text-primary border-primary/20"
                                    >
                                      {rule.name}
                                    </Badge>
                                    <span className="text-foreground/90 font-medium text-xs">
                                      {issue.message}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-foreground/90 font-medium text-xs">
                                    {issue.message}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {issue.ruleId && onOpenRule && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px] font-medium text-primary hover:text-primary hover:bg-primary/10 gap-1"
                                  onClick={() => onOpenRule(issue.ruleId!)}
                                >
                                  Open rule
                                  <ArrowRight className="h-2.5 w-2.5" />
                                </Button>
                              )}
                              {fieldName && onOpenContext && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 gap-1"
                                  onClick={onOpenContext}
                                >
                                  Context catalog
                                  <ArrowRight className="h-2.5 w-2.5" />
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
