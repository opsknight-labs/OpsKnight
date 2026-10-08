/* eslint-disable security/detect-object-injection -- Rule positions are bounds-checked local array indices. */
'use client';
import { useMemo, type Dispatch, type SetStateAction, type RefObject } from 'react';

import { ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { type Snapshot, type Rule, type Field } from '@/lib/automation/contract';

import { RuleConditionsEditor } from './RuleConditionsEditor';
import { RuleActionsEditor } from './RuleActionsEditor';

import type { Data } from './presentation-types';
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
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
  draggedRule,
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
  issues: Array<{ level: 'ERROR' | 'WARNING'; message: string }>;
}) {
  const ruleIndexes = useMemo(
    () => new Map(draft.rules.map((rule, index) => [rule.id, index])),
    [draft.rules]
  );
  const phaseIndexes = useMemo(() => {
    const counters = { ENRICH: 0, ROUTE: 0 };
    return new Map(draft.rules.map(rule => [rule.id, counters[rule.phase]++]));
  }, [draft.rules]);
  return (
    <>
      {mobile && expandedRules.size > 0 && (
        <Button variant="outline" onClick={() => setExpandedRules(new Set())}>
          ← Back to rules
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search rules"
          placeholder="Search rules…"
          value={ruleSearch}
          onChange={event => setRuleSearch(event.target.value)}
          className="flex-1 min-w-40"
        />
        <select
          aria-label="Filter rules"
          className={controlClass}
          value={ruleStateFilter}
          onChange={event => setRuleStateFilter(event.target.value)}
        >
          <option value="all">All rules</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
        {!mobile && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedRules(new Set(draft.rules.map(rule => rule.id)))}
          >
            Expand all
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setExpandedRules(new Set())}>
          Collapse all
        </Button>
      </div>
      {draft.rules.length === 0 && data.canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What would you like to automate?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[
              ['production', 'Route production alerts'],
              ['environment', 'Route by environment'],
              ['account', 'Route by AWS account'],
              ['priority', 'Route by alert priority'],
              ['vip', 'VIP/customer routing'],
              ['scratch', 'Start from scratch'],
            ].map(([key, label]) => (
              <Button variant="outline" key={key} onClick={() => createTemplate(key)}>
                {label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      {issues.map((issue, i) => (
        <p
          key={i}
          role={issue.level === 'ERROR' ? 'alert' : undefined}
          className={`rounded-md border p-2 text-sm ${issue.level === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {issue.level}: {issue.message}
        </p>
      ))}
      {(['ENRICH', 'ROUTE'] as const).map(phase => (
        <div key={phase} className="space-y-3">
          <h3 className="font-semibold">
            {phase === 'ENRICH' ? 'Enrichment · ordered writes' : 'Routing · first match wins'}
          </h3>
          {draft.rules
            .filter(r => r.phase === phase)
            .filter(r => !mobile || !expandedRules.size || expandedRules.has(r.id))
            .filter(
              r =>
                r.name.toLowerCase().includes(ruleSearch.toLowerCase()) &&
                (ruleStateFilter === 'all' || r.enabled === (ruleStateFilter === 'enabled'))
            )
            .map(rule => {
              const index = ruleIndexes.get(rule.id) ?? -1;
              return (
                <Card
                  key={rule.id}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    const source = draft.rules.findIndex(
                      candidate => candidate.id === draggedRule.current
                    );
                    if (!data.canEdit || source < 0 || draft.rules[source].phase !== rule.phase)
                      return;
                    const rules = [...draft.rules];
                    const [moved] = rules.splice(source, 1);
                    rules.splice(index, 0, moved);
                    edit({ ...draft, rules });
                    draggedRule.current = null;
                  }}
                >
                  <CardContent className="pt-4 space-y-3">
                    <button
                      type="button"
                      aria-expanded={expandedRules.has(rule.id)}
                      aria-label={`Configure ${rule.name}`}
                      className="w-full text-left rounded-md focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() =>
                        setExpandedRules(previous => {
                          const next = new Set(mobile ? [] : previous);
                          if (previous.has(rule.id)) next.delete(rule.id);
                          else next.add(rule.id);
                          return next;
                        })
                      }
                    >
                      <span className="font-semibold text-sm">
                        {(phaseIndexes.get(rule.id) ?? 0) + 1}. {rule.name}{' '}
                        <Badge variant="secondary">{rule.enabled ? 'Enabled' : 'Disabled'}</Badge>
                      </span>
                      <span className="block mt-1 text-sm text-muted-foreground">
                        IF{' '}
                        {rule.conditions.length
                          ? rule.conditions
                              .map(
                                condition =>
                                  `${fields.find(field => field.key === condition.fieldKey)?.label ?? condition.fieldKey} ${condition.operator.replaceAll('_', ' ').toLowerCase()} ${Array.isArray(condition.value) ? condition.value.join(', ') : (condition.value ?? '')}`
                              )
                              .join(' and ')
                          : 'every alert'}{' '}
                        → {phase === 'ROUTE' ? 'ROUTE TO' : 'THEN'}{' '}
                        {rule.actions
                          .map(action =>
                            action.type === 'USE_ESCALATION_POLICY'
                              ? (data.policies.find(policy => policy.id === action.policyId)
                                  ?.name ?? 'Selected policy')
                              : action.type.replaceAll('_', ' ').toLowerCase()
                          )
                          .join(', ')}
                      </span>
                    </button>
                    {expandedRules.has(rule.id) && (
                      <div className="space-y-3 border-t pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{(phaseIndexes.get(rule.id) ?? 0) + 1}</Badge>
                          {data.canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              draggable
                              onDragStart={() => {
                                draggedRule.current = rule.id;
                              }}
                              onDragEnd={() => {
                                draggedRule.current = null;
                              }}
                              aria-label={`Drag rule ${(phaseIndexes.get(rule.id) ?? 0) + 1}`}
                            >
                              ↕
                            </Button>
                          )}
                          <Input
                            aria-label="Rule name"
                            className="flex-1 min-w-40"
                            disabled={!data.canEdit}
                            value={rule.name}
                            onChange={e => updateRule(rule.id, { name: e.target.value })}
                          />
                          {data.canEdit && (
                            <>
                              <Button
                                aria-label="Move rule up"
                                variant="ghost"
                                size="icon"
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                aria-label="Move rule down"
                                variant="ghost"
                                size="icon"
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                aria-label="Delete rule"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeRule(rule)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            disabled={!data.canEdit}
                            checked={rule.enabled}
                            onChange={e => updateRule(rule.id, { enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                        <RuleConditionsEditor
                          rule={rule}
                          fields={fields}
                          canEdit={data.canEdit}
                          onChange={update => updateRule(rule.id, update)}
                        />
                        <RuleActionsEditor
                          rule={rule}
                          fields={fields}
                          policies={data.policies}
                          destinations={data.destinations}
                          disabled={!data.canEdit}
                          onChange={actions => updateRule(rule.id, { actions })}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          {data.canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const rule = newRule(phase);
                setExpandedRules(previous =>
                  mobile ? new Set([rule.id]) : new Set([...previous, rule.id])
                );
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
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add {phase === 'ENRICH' ? 'enrichment' : 'routing'} rule
            </Button>
          )}
        </div>
      ))}
      <p className="rounded-lg border p-3 text-sm">
        Fallback: service default escalation when no routing rule matches or evaluation fails.
      </p>
    </>
  );
}
