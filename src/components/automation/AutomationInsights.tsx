'use client';
import { useMemo } from 'react';
import InsightsPanel from '@/components/intelligence/insights/InsightsPanel';
import type { Field, Rule } from '@/lib/automation/contract';
import type { OpsInsightView } from '@/lib/intelligence/ops-insights/contract';

export interface AutomationInsightsData {
  items: OpsInsightView[];
  canDecide: boolean;
  squireName: string | null;
}

/**
 * Stored rule-health insights name no rule or field (a service reader without automation access sees the
 * same rows in the inbox). The workspace is only open to automation readers, so it puts the names back from
 * the rule id or field key in the insight's key.
 */
export function nameAutomationInsight(
  insight: OpsInsightView,
  rules: readonly Pick<Rule, 'id' | 'name'>[],
  fields: readonly Pick<Field, 'key' | 'label'>[]
): OpsInsightView {
  const split = insight.key.indexOf(':');
  const [kind, id] = [insight.key.slice(0, split), insight.key.slice(split + 1)];
  const name =
    kind === 'unmapped'
      ? fields.find(field => field.key === id)?.label
      : rules.find(rule => rule.id === id)?.name;
  if (!name || split < 0) return insight;
  const quoted = `“${name}”`;
  return {
    ...insight,
    title: insight.title
      .replace(/^(A route rule|An enrichment rule|A context field)/, quoted)
      .replace(/by a route rule$/, `by ${quoted}`),
  };
}

export function AutomationInsights({
  data,
  kind,
  rules = [],
  fields = [],
  label,
  draftLabel,
}: {
  data?: AutomationInsightsData;
  kind: 'automation.rule_health' | 'automation.suggested_rule';
  rules?: readonly Pick<Rule, 'id' | 'name'>[];
  fields?: readonly Pick<Field, 'key' | 'label'>[];
  label: string;
  draftLabel?: string;
}) {
  const items = useMemo(
    () =>
      (data?.items ?? [])
        .filter(insight => insight.kind === kind)
        .map(insight => nameAutomationInsight(insight, rules, fields)),
    [data, kind, rules, fields]
  );
  if (!data || items.length === 0) return null;
  return (
    <InsightsPanel
      insights={items}
      canDecide={data.canDecide}
      squireName={data.squireName}
      draftLabel={draftLabel}
      label={label}
    />
  );
}
