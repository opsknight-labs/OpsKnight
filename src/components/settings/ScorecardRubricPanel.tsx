'use client';

import { useId, useState, useTransition } from 'react';
import { notify as toast } from '@/lib/toast';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { saveScorecardRubricAction } from '@/app/(app)/settings/scorecard-actions';
import type { ScorecardRubric } from '@/lib/business-services/scorecard';

type Props = { rubric: ScorecardRubric; defaultRubric: ScorecardRubric };

const describeCheck = (check: ScorecardRubric['rules'][number]['check']) => {
  switch (check.type) {
    case 'field':
      return `Field: ${check.field}${check.maxAgeDays ? ` (${check.maxAgeDays} days)` : ''}`;
    case 'attribute':
      return `Attribute ${check.key}${check.equals !== undefined ? ` = ${String(check.equals)}` : ' is set'}`;
    case 'slo':
      return check.state === 'OK' ? 'SLO budget healthy' : 'SLO not breached';
    case 'hygiene':
      return `No ${check.flag.toLowerCase().replace(/_/g, ' ')} flag`;
  }
};

/** Admin editor for the business-service scorecard rubric: the current rules, and the JSON to change them. */
export default function ScorecardRubricPanel({ rubric, defaultRubric }: Props) {
  const id = useId();
  const [text, setText] = useState(() => JSON.stringify(rubric, null, 2));
  const [pending, startTransition] = useTransition();
  const levelLabel = new Map(rubric.levels.map(level => [level.id, level.label]));

  const save = () =>
    startTransition(async () => {
      const result = await saveScorecardRubricAction(text);
      if (result.success) toast.success('Scorecard rubric saved');
      else toast.error(result.error);
    });

  return (
    <SettingsSection
      title="Business service scorecards"
      description="Rules every business service is scored against, grouped into levels. A level is reached when its rules and every lower level's pass. Rules can be scoped to teams or tiers and given a deadline."
      footer={
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending}>
            Save rubric
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setText(JSON.stringify(defaultRubric, null, 2))}
          >
            Load default
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Current scorecard rules</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Rule
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Check
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Level
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Scope and deadline
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rubric.rules.map(rule => (
                <tr key={rule.id}>
                  <td className="py-1.5 pr-3 font-medium">{rule.label}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{describeCheck(rule.check)}</td>
                  <td className="py-1.5 pr-3">{rule.level ? levelLabel.get(rule.level) : '—'}</td>
                  <td className="py-1.5 text-muted-foreground">
                    {[
                      rule.tiers?.length ? rule.tiers.join(', ') : null,
                      rule.teamIds?.length ? `${rule.teamIds.length} team(s)` : null,
                      rule.deadline ? `by ${rule.deadline}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'All services'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-rubric`} className="text-sm font-medium">
            Rubric (JSON)
          </label>
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            Check types: field (owner, tier, members, slo, links, description, reviewed,
            escalationPolicy, contactChannel, statusPageSummary), attribute (key, optional equals),
            slo (state OK or NOT_BREACHED) and hygiene (REVIEW_OVERDUE, OWNER_INACTIVE,
            TEAM_NO_ONCALL). Optional per rule: level, tiers, teamIds, deadline (YYYY-MM-DD).
          </p>
          <Textarea
            id={`${id}-rubric`}
            aria-describedby={`${id}-hint`}
            value={text}
            onChange={event => setText(event.target.value)}
            spellCheck={false}
            rows={16}
            className="font-mono text-xs"
          />
        </div>
      </div>
    </SettingsSection>
  );
}
