/* eslint-disable security/detect-object-injection -- Rule positions are bounds-checked local array indices. */
'use client';
import {
  memo,
  useId,
  useMemo,
  useRef,
  useEffect,
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
  Copy,
  GripVertical,
  Plus,
  RotateCcw,
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
import { newRule } from './workspace/constants';

import { RuleConditionsEditor } from './RuleConditionsEditor';
import { RuleActionsEditor } from './RuleActionsEditor';
import { ConfigurationHealth } from './ConfigurationHealth';
import type { LintIssue } from '@/lib/automation/compiler';
import { LimitCounter, NativeSelect } from './authoring/primitives';
import { useShallowStableArray, useStableCallback } from './authoring/hooks';
import { describeAction, describeCondition, ROUTE_ACTIONS } from './authoring/rule-language';
import { notify } from '@/lib/toast';

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
  query?: string;
  fields: Field[];
  fieldsByKey: Map<string, Field>;
  policies: Data['policies'];
  destinations: Data['destinations'];
  issues: LintIssue[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, update: Partial<Rule>) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, direction: number) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
};

function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query || !query.trim()) return <>{text}</>;
  const trimmed = query.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // eslint-disable-next-line security/detect-non-literal-regexp -- query is regex-escaped
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length <= 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark
            key={index}
            className="rounded-xs bg-amber-400/30 px-0.5 font-medium text-inherit dark:bg-amber-400/20"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

const RuleRow = memo(
  function RuleRow({
    rule,
    position,
    expanded,
    canEdit,
    query,
    fields,
    fieldsByKey,
    policies,
    destinations,
    issues,
    onToggle,
    onUpdate,
    onDuplicate,
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
          'overflow-hidden rounded-xl border bg-card transition-all duration-150',
          expanded
            ? 'border-primary/50 shadow-xs ring-1 ring-primary/20'
            : 'border-border/70 hover:border-border hover:shadow-2xs',
          !rule.enabled && 'bg-muted/20 opacity-80'
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
          className="flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          onClick={() => onToggle(rule.id)}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/60 bg-muted/60 font-mono text-[10.5px] font-semibold text-muted-foreground">
            {position}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">
                <HighlightText text={rule.name} query={query} />
              </span>

              <span
                className={cn(
                  'rounded-md border px-1.5 py-px text-[10px] font-medium tracking-wide',
                  rule.enabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'border-border bg-muted text-muted-foreground'
                )}
              >
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </span>

              {errors > 0 && (
                <span className="rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-px text-[10px] font-medium text-destructive">
                  {errors} {errors === 1 ? 'error' : 'errors'}
                </span>
              )}
              {warnings > 0 && (
                <span className="rounded-md border border-amber-500/40 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  Review warnings
                </span>
              )}
            </span>

            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
              <HighlightText
                text={ruleSummary(rule, fieldsByKey, policies, destinations)}
                query={query}
              />
            </span>
          </span>

          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150',
              expanded && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>

        {expanded && (
          <div
            id={`${id}-panel`}
            className="space-y-2.5 border-t border-border/60 bg-muted/5 p-2.5 sm:p-3"
          >
            {issues.length > 0 && (
              <ul aria-label="Issues in this rule" className="space-y-1.5">
                {issues.map((issue, index) => (
                  <li
                    key={index}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
                      issue.level === 'ERROR'
                        ? 'border-destructive/40 bg-destructive/5 text-destructive'
                        : 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                    )}
                  >
                    {issue.level === 'ERROR' ? (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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

            {/* Compact Header Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <Label
                  htmlFor={`${id}-name`}
                  className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0"
                >
                  Rule name
                </Label>
                <Input
                  id={`${id}-name`}
                  disabled={!canEdit}
                  maxLength={100}
                  className="h-7.5 text-xs font-medium bg-background/90"
                  value={rule.name}
                  onChange={e => onUpdate(rule.id, { name: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1.5 pr-2 border-r border-border/60">
                  <Switch
                    id={`${id}-enabled`}
                    disabled={!canEdit}
                    checked={rule.enabled}
                    onCheckedChange={checked => onUpdate(rule.id, { enabled: checked })}
                  />
                  <Label
                    htmlFor={`${id}-enabled`}
                    className="cursor-pointer text-[11px] font-medium text-muted-foreground select-none"
                  >
                    Enabled
                  </Label>
                </div>

                {canEdit && (
                  <div
                    role="group"
                    aria-label="Order and removal"
                    className="flex items-center gap-0.5"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      draggable
                      className="h-7 w-7 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
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
                      <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label="Move rule up"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={event => moveAndKeepFocus(event.currentTarget, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label="Move rule down"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={event => moveAndKeepFocus(event.currentTarget, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Duplicate ${rule.name}`}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Duplicate rule"
                      onClick={() => onDuplicate(rule.id)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Delete ${rule.name}`}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemove(rule.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
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
  (prev, next) =>
    prev.rule === next.rule &&
    prev.position === next.position &&
    prev.expanded === next.expanded &&
    prev.canEdit === next.canEdit &&
    prev.query === next.query &&
    prev.fields === next.fields &&
    prev.fieldsByKey === next.fieldsByKey &&
    prev.policies === next.policies &&
    prev.destinations === next.destinations &&
    sameIssues(prev.issues, next.issues)
);

export function AutomationRules({
  data,
  draft,
  issues = [],
  ruleSearch,
  setRuleSearch,
  ruleStateFilter,
  setRuleStateFilter,
  expandedRules,
  setExpandedRules,
  updateRule,
  removeRule,
  move,
  edit,
  createTemplate,
  draggedRuleRef,
  draggedRule,
  rootRef: _rootRef,
  mobile,
  newRule: propNewRule,
  onOpenRule: propOnOpenRule,
  onOpenContext,
}: {
  data: Data;
  draft: Snapshot;
  fields?: Field[];
  issues?: LintIssue[];
  ruleSearch: string;
  setRuleSearch: (value: string) => void;
  ruleStateFilter: string;
  setRuleStateFilter: (value: string) => void;
  expandedRules: Set<string>;
  setExpandedRules: Dispatch<SetStateAction<Set<string>>>;
  updateRule: (id: string, update: Partial<Rule>) => void;
  removeRule: (rule: Rule) => void;
  move: (fromIndex: number, direction: number) => void;
  edit: (snapshot: Snapshot) => void;
  createTemplate: (template: string) => void;
  draggedRuleRef?: RefObject<string | null>;
  draggedRule?: RefObject<string | null>;
  rootRef?: RefObject<HTMLElement | null>;
  mobile: boolean;
  newRule?: (phase: Rule['phase']) => Rule;
  onOpenRule?: (ruleId: string) => void;
  onOpenContext?: () => void;
}) {
  const headingId = useId();
  const [announcement, setAnnouncement] = useState('');
  const query = ruleSearch.trim().toLowerCase();
  const activeDraggedRuleRef = draggedRuleRef ?? draggedRule;
  const generateRule = propNewRule ?? newRule;
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Do not intercept if a modal, sheet, or dialog is currently open in the document
      if (typeof document !== 'undefined') {
        const hasOpenModal = document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"], dialog[open]'
        );
        if (hasOpenModal) return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      const isInputActive =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable ||
          (typeof activeEl.closest === 'function' &&
            activeEl.closest(
              '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]'
            )));

      if (isInputActive) return;

      if (!searchInputRef.current) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current.focus();
        searchInputRef.current.select();
      } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current.focus();
        searchInputRef.current.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const stableFields = useShallowStableArray(draft.fields);
  const fieldsByKey = useMemo(
    () => new Map(draft.fields.map(field => [field.key, field])),
    [draft.fields]
  );
  const issuesByRule = useMemo(() => {
    const map = new Map<string, LintIssue[]>();
    for (const issue of issues) {
      if (issue.ruleId) {
        const list = map.get(issue.ruleId) ?? [];
        list.push(issue);
        map.set(issue.ruleId, list);
      }
    }
    return map;
  }, [issues]);

  const { phaseIndexes, phaseTotals } = useMemo(() => {
    const phaseIndexes = new Map<string, number>();
    const phaseTotals: Record<Rule['phase'], number> = { ENRICH: 0, ROUTE: 0 };
    for (const rule of draft.rules) {
      phaseIndexes.set(rule.id, phaseTotals[rule.phase]);
      phaseTotals[rule.phase] += 1;
    }
    return { phaseIndexes, phaseTotals };
  }, [draft.rules]);

  const ruleCounts = useMemo(() => {
    let enabled = 0;
    let disabled = 0;
    for (const rule of draft.rules) {
      if (rule.enabled) enabled++;
      else disabled++;
    }
    return { all: draft.rules.length, enabled, disabled };
  }, [draft.rules]);

  const onToggle = useStableCallback((id: string) =>
    setExpandedRules(previous => {
      const next = new Set(mobile ? [] : previous);
      if (previous.has(id)) next.delete(id);
      else next.add(id);
      return next;
    })
  );
  const handleOpenRule = useStableCallback((ruleId: string) => {
    if (propOnOpenRule) {
      propOnOpenRule(ruleId);
    } else {
      setExpandedRules(previous => (mobile ? new Set([ruleId]) : new Set([...previous, ruleId])));
      const targetRule = draft.rules.find(r => r.id === ruleId);
      if (targetRule) {
        setAnnouncement(`Expanded rule ${targetRule.name}`);
      }
    }
  });
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
  const onDuplicate = useStableCallback((id: string) => {
    if (draft.rules.length >= LIMITS.rules) {
      notify.error('Rule limit reached', {
        description: `Maximum limit of ${LIMITS.rules} rules reached.`,
      });
      return;
    }
    const index = draft.rules.findIndex(rule => rule.id === id);
    if (index < 0) return;
    const source = draft.rules[index];
    const newId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const clonedRule: Rule = {
      ...source,
      id: newId,
      name: `${source.name} (Copy)`,
      conditions: source.conditions.map(condition => ({ ...condition })),
      actions: source.actions.map(action => ({ ...action })),
    };
    const rules = [...draft.rules];
    rules.splice(index + 1, 0, clonedRule);
    edit({ ...draft, rules });
    setExpandedRules(previous =>
      mobile ? new Set([clonedRule.id]) : new Set([...previous, clonedRule.id])
    );
    notify.success(`Duplicated "${source.name}"`, {
      description: 'New copy created and expanded below.',
    });
  });
  const onDragStart = useStableCallback((id: string) => {
    // eslint-disable-next-line react-hooks/immutability
    if (activeDraggedRuleRef) activeDraggedRuleRef.current = id;
  });
  const onDragEnd = useStableCallback(() => {
    // eslint-disable-next-line react-hooks/immutability
    if (activeDraggedRuleRef) activeDraggedRuleRef.current = null;
  });
  const onDrop = useStableCallback((targetId: string) => {
    const source = draft.rules.findIndex(
      candidate => candidate.id === activeDraggedRuleRef?.current
    );
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
    // eslint-disable-next-line react-hooks/immutability
    if (activeDraggedRuleRef) activeDraggedRuleRef.current = null;
    const moveMsg = `${moved.name} moved to ${PHASES[moved.phase].noun} position ${(phaseIndexes.get(targetId) ?? 0) + 1}.`;
    setAnnouncement(moveMsg);
    notify.success(moveMsg, { id: 'automation:rule:reorder' });
  });

  const addRule = (phase: Rule['phase']) => {
    if (draft.rules.length >= LIMITS.rules) return;
    const rule = generateRule(phase);
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
    notify.success(`${PHASES[phase].noun} rule created`, {
      id: `automation:rule:${rule.id}:add`,
      description: 'Configure conditions and actions below.',
    });
  };

  const atRuleLimit = draft.rules.length >= LIMITS.rules;

  return (
    <div className="space-y-3.5">
      {mobile && expandedRules.size > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="self-start text-xs"
          onClick={() => setExpandedRules(new Set())}
        >
          ← Back to rules
        </Button>
      )}

      {/* High-density toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-card p-2 shadow-xs">
        <div className="relative min-w-44 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchInputRef}
            aria-label="Search rules"
            placeholder="Search rules… (⌘K)"
            value={ruleSearch}
            onChange={event => setRuleSearch(event.target.value)}
            className="search-input h-8 !pl-8 !pr-9 text-xs bg-background"
          />
          {!ruleSearch ? (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border/80 bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground hidden sm:inline-block">
              ⌘K
            </kbd>
          ) : (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setRuleSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
        {/* Segmented Filter Pills */}
        <div
          role="group"
          aria-label="Filter rules by state"
          className="hidden sm:inline-flex items-center rounded-lg border border-border/70 bg-muted/40 p-0.5 text-xs"
        >
          <button
            type="button"
            onClick={() => setRuleStateFilter('all')}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-all',
              ruleStateFilter === 'all'
                ? 'bg-background text-foreground shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All <span className="opacity-70 font-mono">({ruleCounts.all})</span>
          </button>
          <button
            type="button"
            onClick={() => setRuleStateFilter('enabled')}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-all',
              ruleStateFilter === 'enabled'
                ? 'bg-background text-emerald-700 dark:text-emerald-400 shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Enabled <span className="opacity-70 font-mono">({ruleCounts.enabled})</span>
          </button>
          <button
            type="button"
            onClick={() => setRuleStateFilter('disabled')}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-all',
              ruleStateFilter === 'disabled'
                ? 'bg-background text-foreground shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Disabled <span className="opacity-70 font-mono">({ruleCounts.disabled})</span>
          </button>
        </div>

        <NativeSelect
          aria-label="Filter rules"
          wrapperClassName="w-auto shrink-0 sm:hidden"
          className="h-8 min-w-[7.5rem] text-xs font-medium bg-background"
          value={ruleStateFilter}
          onChange={event => setRuleStateFilter(event.target.value)}
        >
          <option value="all">All ({ruleCounts.all})</option>
          <option value="enabled">Enabled ({ruleCounts.enabled})</option>
          <option value="disabled">Disabled ({ruleCounts.disabled})</option>
        </NativeSelect>
        {!mobile && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
            onClick={() => setExpandedRules(new Set(draft.rules.map(rule => rule.id)))}
          >
            Expand all
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-medium"
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
        <Card className="border-border/80 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              What would you like to automate?
            </CardTitle>
            <p className="text-xs text-muted-foreground">
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
                size="sm"
                className="h-9 justify-start text-xs font-medium"
                key={key}
                onClick={() => createTemplate(key)}
              >
                {label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <ConfigurationHealth
        issues={issues}
        rules={draft.rules}
        onOpenRule={handleOpenRule}
        onOpenContext={onOpenContext}
      />

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
            className="min-w-0 space-y-2.5 rounded-xl border border-border/80 bg-card/60 p-3 shadow-xs"
          >
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between border-b border-border/60 pb-2">
              <h3
                id={`${headingId}-${phase}`}
                className="text-xs font-semibold uppercase tracking-wider text-foreground"
              >
                {PHASES[phase].title}
              </h3>
              <p className="text-[11px] text-muted-foreground">{PHASES[phase].explanation}</p>
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
                    query={query}
                    fields={stableFields}
                    fieldsByKey={fieldsByKey}
                    policies={data.policies}
                    destinations={data.destinations}
                    issues={issuesByRule.get(rule.id) ?? NO_ISSUES}
                    onToggle={onToggle}
                    onUpdate={onUpdate}
                    onDuplicate={onDuplicate}
                    onMove={onMove}
                    onRemove={onRemove}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDrop={onDrop}
                  />
                ))}
              </ol>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 py-6 text-center text-xs text-muted-foreground">
                <p>
                  {phaseTotals[phase] === 0
                    ? `No ${PHASES[phase].noun} rules yet.`
                    : `No ${PHASES[phase].noun} rules match the current search or filter.`}
                </p>
                {phaseTotals[phase] > 0 && (query || ruleStateFilter !== 'all') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-medium gap-1.5"
                    onClick={() => {
                      setRuleSearch('');
                      setRuleStateFilter('all');
                    }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset filters
                  </Button>
                )}
              </div>
            )}
            {data.canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-8.5 w-full justify-center gap-1.5 border-dashed text-xs font-medium hover:border-primary/50"
                disabled={atRuleLimit}
                onClick={() => addRule(phase)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add {PHASES[phase].noun} rule
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}
