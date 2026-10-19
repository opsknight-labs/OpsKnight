/* eslint-disable security/detect-object-injection -- Rule positions are bounds-checked local array indices. */
'use client';
import {
  memo,
  useId,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';

import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { cn } from '@/lib/utils';
import { LIMITS, type Snapshot, type Rule, type Field } from '@/lib/automation/contract';

import { RuleConditionsEditor } from './RuleConditionsEditor';
import { RuleActionsEditor } from './RuleActionsEditor';
import { ConfigurationHealth } from './ConfigurationHealth';
import type { LintIssue } from '@/lib/automation/compiler';
import { LimitCounter, NativeSelect } from './authoring/primitives';
import { useShallowStableArray, useStableCallback } from './authoring/hooks';
import { describeAction, describeCondition, ROUTE_ACTIONS } from './authoring/rule-language';

import type { Data } from './presentation-types';

const PHASES = {
  ENRICH: {
    title: 'Enrichment · ordered writes',
    noun: 'enrichment',
    explanation:
      'Every enabled rule whose conditions match runs, top to bottom. Later rules see values written by earlier ones.',
  },
  ROUTE: {
    title: 'Routing · first match wins',
    noun: 'routing',
    explanation:
      'Enabled rules are checked top to bottom. The first rule whose conditions all match chooses the responder route; later routing rules are skipped.',
  },
} as const;

const NO_ISSUES: LintIssue[] = [];

function sameIssues(a: LintIssue[], b: LintIssue[]) {
  return (
    a === b ||
    (a.length === b.length &&
      a.every(
        (issue, index) => issue.level === b[index].level && issue.message === b[index].message
      ))
  );
}

function ruleSummary(
  rule: Rule,
  fieldsByKey: Map<string, Field>,
  policies: Data['policies'],
  destinations: Data['destinations']
) {
  const lookups = { policies, destinations, fieldsByKey };
  const when = rule.conditions.length
    ? rule.conditions.map(condition => describeCondition(condition, fieldsByKey)).join(' and ')
    : 'any alert arrives';
  if (rule.phase === 'ROUTE') {
    const route = rule.actions.find(action => ROUTE_ACTIONS.includes(action.type));
    const notifications = rule.actions.filter(action => action.type === 'NOTIFY_CHANNEL').length;
    return `When ${when} → route to ${route ? describeAction(route, lookups) : 'Service default escalation'}${
      notifications ? ` + ${notifications} notification${notifications === 1 ? '' : 's'}` : ''
    }`;
  }
  return `When ${when} → ${rule.actions.map(action => describeAction(action, lookups)).join(', ') || 'no actions'}`;
}

type RuleRowProps = {
  rule: Rule;
  position: number;
  expanded: boolean;
  canEdit: boolean;
  fields: Field[];
  fieldsByKey: Map<string, Field>;
  policies: Data['policies'];
  destinations: Data['destinations'];
  issues: LintIssue[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, update: Partial<Rule>) => void;
  onMove: (id: string, direction: number) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
};

const RuleRow = memo(
  function RuleRow({
    rule,
    position,
    expanded,
    canEdit,
    fields,
    fieldsByKey,
    policies,
    destinations,
    issues,
    onToggle,
    onUpdate,
    onMove,
    onRemove,
    onDragStart,
    onDragEnd,
    onDrop,
  }: RuleRowProps) {
    const id = useId();
    const errors = issues.filter(issue => issue.level === 'ERROR').length;
    const warnings = issues.length - errors;
    const moveAndKeepFocus = (target: HTMLElement, direction: number) => {
      onMove(rule.id, direction);
      requestAnimationFrame(() => target.focus());
    };
    return (
      <li
        className={cn(
          'rounded-lg border bg-card transition-colors',
          expanded ? 'border-primary/40 shadow-sm' : 'border-border/70 hover:border-border',
          !rule.enabled && 'bg-muted/30'
        )}
        onDragOver={canEdit ? event => event.preventDefault() : undefined}
        onDrop={event => {
          event.preventDefault();
          onDrop(rule.id);
        }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-panel` : undefined}
          aria-label={`Configure ${rule.name}`}
          className="flex min-h-12 w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onToggle(rule.id)}
        >
          <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {position}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-0 break-words text-sm font-semibold">{rule.name}</span>
              <span
                className={cn(
                  'rounded-md border px-1.5 py-px text-[11px] font-medium',
                  rule.enabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'border-border bg-muted text-muted-foreground'
                )}
              >
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {errors > 0 && (
                <span className="rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-px text-[11px] font-medium text-destructive">
                  {errors} {errors === 1 ? 'error' : 'errors'}
                </span>
              )}
              {warnings > 0 && (
                <span className="rounded-md border border-amber-500/40 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  Review warnings
                </span>
              )}
            </span>
            <span className="mt-1 line-clamp-2 block break-words text-xs text-muted-foreground">
              {ruleSummary(rule, fieldsByKey, policies, destinations)}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div id={`${id}-panel`} className="space-y-4 border-t border-border/70 p-3 sm:p-4">
            {issues.length > 0 && (
              <ul aria-label="Issues in this rule" className="space-y-1.5">
                {issues.map((issue, index) => (
                  <li
                    key={index}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                      issue.level === 'ERROR'
                        ? 'border-destructive/40 bg-destructive/5 text-destructive'
                        : 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                    )}
                  >
                    {issue.level === 'ERROR' ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      <span className="sr-only">
                        {issue.level === 'ERROR' ? 'Error: ' : 'Warning: '}
                      </span>
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-56 space-y-1.5">
                <Label htmlFor={`${id}-name`}>Rule name</Label>
                <Input
                  id={`${id}-name`}
                  disabled={!canEdit}
                  maxLength={100}
                  value={rule.name}
                  onChange={e => onUpdate(rule.id, { name: e.target.value })}
                />
              </div>
              {canEdit && (
                <div
                  role="group"
                  aria-label="Order and removal"
                  className="flex items-center gap-1"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    draggable
                    className="cursor-grab text-muted-foreground active:cursor-grabbing"
                    aria-label={`Reorder rule ${position}`}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    title="Drag to reorder, or focus and press ↑ / ↓"
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', rule.id);
                      onDragStart(rule.id);
                    }}
                    onDragEnd={onDragEnd}
                    onKeyDown={event => {
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                      event.preventDefault();
                      moveAndKeepFocus(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1);
                    }}
                  >
                    <GripVertical aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label="Move rule up"
                    variant="ghost"
                    size="icon"
                    onClick={event => moveAndKeepFocus(event.currentTarget, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label="Move rule down"
                    variant="ghost"
                    size="icon"
                    onClick={event => moveAndKeepFocus(event.currentTarget, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label="Delete rule"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(rule.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
              <Switch
                id={`${id}-enabled`}
                disabled={!canEdit}
                checked={rule.enabled}
                onCheckedChange={enabled => onUpdate(rule.id, { enabled })}
              />
              <Label htmlFor={`${id}-enabled`}>Enabled</Label>
              <span className="text-xs text-muted-foreground">
                {rule.enabled ? 'Evaluated for new alerts.' : 'Skipped during evaluation.'}
              </span>
            </div>
            <RuleConditionsEditor
              rule={rule}
              fields={fields}
              canEdit={canEdit}
              onChange={update => onUpdate(rule.id, update)}
            />
            <RuleActionsEditor
              rule={rule}
              fields={fields}
              policies={policies}
              destinations={destinations}
              disabled={!canEdit}
              onChange={actions => onUpdate(rule.id, { actions })}
            />
          </div>
        )}
      </li>
    );
  },
  (previous, next) =>
    (Object.keys(next) as Array<keyof RuleRowProps>).every(key =>
      key === 'issues' ? sameIssues(previous.issues, next.issues) : previous[key] === next[key]
    )
);

export function AutomationRules({
  data,
  draft,
  fields,
  ruleSearch,
  setRuleSearch,
  ruleStateFilter,
  setRuleStateFilter,
  expandedRules,
  setExpandedRules,
  draggedRule: draggedRuleRef,
  edit,
  updateRule,
  move,
  removeRule,
  mobile,
  createTemplate,
  newRule,
  issues,
}: {
  data: Data;
  draft: Snapshot;
  fields: Field[];
  ruleSearch: string;
  setRuleSearch: (value: string) => void;
  ruleStateFilter: string;
  setRuleStateFilter: (value: string) => void;
  expandedRules: Set<string>;
  setExpandedRules: Dispatch<SetStateAction<Set<string>>>;
  draggedRule: RefObject<string | null>;
  edit: (snapshot: Snapshot) => void;
  updateRule: (id: string, update: Partial<Rule>) => void;
  move: (index: number, direction: number) => void;
  removeRule: (rule: Rule) => void;
  mobile: boolean;
  createTemplate: (kind: string) => void;
  newRule: (phase: Rule['phase']) => Rule;
  issues: LintIssue[];
}) {
  const headingId = useId();
  const [announcement, setAnnouncement] = useState('');
  const stableFields = useShallowStableArray(fields);
  const fieldsByKey = useMemo(
    () => new Map(stableFields.map(field => [field.key, field])),
    [stableFields]
  );
  const issuesByRule = useMemo(() => {
    const grouped = new Map<string, LintIssue[]>();
    for (const issue of issues) {
      if (!issue.ruleId) continue;
      const list = grouped.get(issue.ruleId);
      if (list) list.push(issue);
      else grouped.set(issue.ruleId, [issue]);
    }
    return grouped;
  }, [issues]);
  const { phaseIndexes, phaseTotals } = useMemo(() => {
    const counters = { ENRICH: 0, ROUTE: 0 };
    const indexes = new Map(draft.rules.map(rule => [rule.id, counters[rule.phase]++]));
    return { phaseIndexes: indexes, phaseTotals: counters };
  }, [draft.rules]);
  const query = ruleSearch.toLowerCase();

  const onToggle = useStableCallback((id: string) =>
    setExpandedRules(previous => {
      const next = new Set(mobile ? [] : previous);
      if (previous.has(id)) next.delete(id);
      else next.add(id);
      return next;
    })
  );
  const onUpdate = useStableCallback((id: string, update: Partial<Rule>) => updateRule(id, update));
  const onMove = useStableCallback((id: string, direction: number) => {
    const index = draft.rules.findIndex(rule => rule.id === id);
    if (index < 0) return;
    const rule = draft.rules[index];
    const target = draft.rules[index + direction];
    move(index, direction);
    const phase = PHASES[rule.phase].noun;
    setAnnouncement(
      target && target.phase === rule.phase
        ? `${rule.name} moved to ${phase} position ${(phaseIndexes.get(rule.id) ?? 0) + 1 + direction}.`
        : `${rule.name} is already ${direction < 0 ? 'first' : 'last'} in ${phase} rules.`
    );
  });
  const onRemove = useStableCallback((id: string) => {
    const rule = draft.rules.find(candidate => candidate.id === id);
    if (rule) removeRule(rule);
  });
  const onDragStart = useStableCallback((id: string) => {
    draggedRuleRef.current = id;
  });
  const onDragEnd = useStableCallback(() => {
    draggedRuleRef.current = null;
  });
  const onDrop = useStableCallback((targetId: string) => {
    const source = draft.rules.findIndex(candidate => candidate.id === draggedRuleRef.current);
    const index = draft.rules.findIndex(candidate => candidate.id === targetId);
    if (
      !data.canEdit ||
      source < 0 ||
      index < 0 ||
      draft.rules[source].phase !== draft.rules[index].phase
    )
      return;
    const rules = [...draft.rules];
    const [moved] = rules.splice(source, 1);
    rules.splice(index, 0, moved);
    edit({ ...draft, rules });
    draggedRuleRef.current = null;
    setAnnouncement(
      `${moved.name} moved to ${PHASES[moved.phase].noun} position ${(phaseIndexes.get(targetId) ?? 0) + 1}.`
    );
  });
  const addRule = (phase: Rule['phase']) => {
    if (draft.rules.length >= LIMITS.rules) return;
    const rule = newRule(phase);
    setExpandedRules(previous => (mobile ? new Set([rule.id]) : new Set([...previous, rule.id])));
    edit({
      ...draft,
      rules:
        phase === 'ENRICH'
          ? [
              ...draft.rules.filter(r => r.phase === 'ENRICH'),
              rule,
              ...draft.rules.filter(r => r.phase === 'ROUTE'),
            ]
          : [...draft.rules, rule],
    });
  };
  const atRuleLimit = draft.rules.length >= LIMITS.rules;

  return (
    <>
      {mobile && expandedRules.size > 0 && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setExpandedRules(new Set())}
        >
          ← Back to rules
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search rules"
            placeholder="Search rules…"
            value={ruleSearch}
            onChange={event => setRuleSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <NativeSelect
          aria-label="Filter rules"
          className="w-auto"
          value={ruleStateFilter}
          onChange={event => setRuleStateFilter(event.target.value)}
        >
          <option value="all">All rules</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </NativeSelect>
        {!mobile && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedRules(new Set(draft.rules.map(rule => rule.id)))}
          >
            Expand all
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-10 sm:h-9"
          onClick={() => setExpandedRules(new Set())}
        >
          Collapse all
        </Button>
        <LimitCounter count={draft.rules.length} limit={LIMITS.rules} noun="rules" />
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {draft.rules.length === 0 && data.canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What would you like to automate?</CardTitle>
            <p className="text-sm text-muted-foreground">
              Start from a template — each creates an editable rule and any context field it needs.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['production', 'Route production alerts'],
              ['environment', 'Route by environment'],
              ['account', 'Route by AWS account'],
              ['priority', 'Route by alert priority'],
              ['vip', 'VIP/customer routing'],
              ['scratch', 'Start from scratch'],
            ].map(([key, label]) => (
              <Button
                variant="outline"
                className="justify-start"
                key={key}
                onClick={() => createTemplate(key)}
              >
                {label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      <ConfigurationHealth issues={issues} />
      {(['ENRICH', 'ROUTE'] as const).map(phase => {
        const visible = draft.rules
          .filter(r => r.phase === phase)
          .filter(r => !mobile || !expandedRules.size || expandedRules.has(r.id))
          .filter(
            r =>
              r.name.toLowerCase().includes(query) &&
              (ruleStateFilter === 'all' || r.enabled === (ruleStateFilter === 'enabled'))
          );
        return (
          <section
            key={phase}
            aria-labelledby={`${headingId}-${phase}`}
            className="min-w-0 space-y-3"
          >
            <div className="space-y-1">
              <h3 id={`${headingId}-${phase}`} className="font-semibold tracking-tight">
                {PHASES[phase].title}
              </h3>
              <p className="text-xs text-muted-foreground">{PHASES[phase].explanation}</p>
            </div>
            {visible.length > 0 ? (
              <ol className="space-y-2">
                {visible.map(rule => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    position={(phaseIndexes.get(rule.id) ?? 0) + 1}
                    expanded={expandedRules.has(rule.id)}
                    canEdit={data.canEdit}
                    fields={stableFields}
                    fieldsByKey={fieldsByKey}
                    policies={data.policies}
                    destinations={data.destinations}
                    issues={issuesByRule.get(rule.id) ?? NO_ISSUES}
                    onToggle={onToggle}
                    onUpdate={onUpdate}
                    onMove={onMove}
                    onRemove={onRemove}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDrop={onDrop}
                  />
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                {phaseTotals[phase] === 0
                  ? `No ${PHASES[phase].noun} rules yet.`
                  : `No ${PHASES[phase].noun} rules match the current search or filter.`}
              </p>
            )}
            {data.canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 sm:h-9"
                disabled={atRuleLimit}
                onClick={() => addRule(phase)}
              >
                <Plus aria-hidden="true" />
                Add {phase === 'ENRICH' ? 'enrichment' : 'routing'} rule
              </Button>
            )}
          </section>
        );
      })}
      <p className="rounded-lg border border-border/70 bg-muted/40 p-3 text-sm">
        Fallback: service default escalation when no routing rule matches or evaluation fails.
      </p>
    </>
  );
}
