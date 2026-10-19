'use client';
import Link from 'next/link';
import { AlertTriangle, Plus } from 'lucide-react';
import { ActionEditor } from './ActionEditor';
import { Button } from '@/components/ui/shadcn/button';
import { AuthoringFieldset, Hint, LimitCounter } from './authoring/primitives';
import { LIMITS, type Field, type Rule, type Action } from '@/lib/automation/contract';
import type { getAutomationArea } from '@/app/(app)/services/[id]/automation/actions';
type Data = Awaited<ReturnType<typeof getAutomationArea>>;
export function RuleActionsEditor({
  rule,
  fields,
  policies,
  destinations,
  disabled,
  onChange,
}: {
  rule: Rule;
  fields: Field[];
  policies: Data['policies'];
  destinations: Data['destinations'];
  disabled: boolean;
  onChange: (actions: Action[]) => void;
}) {
  const route = rule.actions.find(a =>
    ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION'].includes(a.type)
  ) ?? { type: 'USE_SERVICE_DEFAULT' as const };
  const supplemental = rule.actions.filter(a => a.type === 'NOTIFY_CHANNEL');
  const atLimit = rule.actions.length >= LIMITS.actions;
  const counter = (
    <LimitCounter count={rule.actions.length} limit={LIMITS.actions} noun="actions" />
  );
  const editor = (action: Action, index: number) => (
    <ActionEditor
      key={index}
      action={action}
      phase={rule.phase}
      fields={fields}
      policies={policies}
      destinations={destinations}
      disabled={disabled}
      onChange={next => onChange(rule.actions.map((a, i) => (i === index ? next : a)))}
      onRemove={() => onChange(rule.actions.filter((_, i) => i !== index))}
    />
  );
  const addButton = !disabled && (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="h-10 sm:h-9"
        disabled={atLimit || (rule.phase === 'ROUTE' && !destinations.length)}
        onClick={() =>
          onChange([
            ...rule.actions,
            rule.phase === 'ENRICH'
              ? { type: 'ADD_TAG', value: 'tag' }
              : {
                  type: 'NOTIFY_CHANNEL',
                  provider: destinations[0].provider,
                  destinationId: destinations[0].id,
                },
          ])
        }
      >
        <Plus aria-hidden="true" />
        {rule.phase === 'ROUTE' ? 'Add notification' : 'Add enrichment'}
      </Button>
      {atLimit && <Hint>Action limit reached. Remove one to add another.</Hint>}
    </div>
  );
  if (rule.phase !== 'ROUTE')
    return (
      <AuthoringFieldset
        legend="Then enrich this incident"
        aside={counter}
        description="Actions run in order when the conditions match."
      >
        {rule.actions.map(editor)}
        {addButton}
      </AuthoringFieldset>
    );
  return (
    <div className="space-y-3">
      <AuthoringFieldset
        legend="Route to"
        description="Exactly one responder route. Used only if this is the first routing rule to match."
      >
        <ActionEditor
          action={route}
          phase="ROUTE"
          fields={fields}
          policies={policies}
          destinations={destinations}
          disabled={disabled}
          allowRemove={false}
          onChange={next => onChange([next, ...supplemental])}
          onRemove={() => undefined}
        />
        {route.type === 'NO_ESCALATION' && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-sm">
              No escalation stops personal paging only. Ordinary service and integration
              notifications still apply. Disable those separately if this rule should notify only
              its selected channels.
            </p>
          </div>
        )}
        {!policies.length && (
          <Hint>
            No escalation policies available.{' '}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              href="/policies"
            >
              Create escalation policy →
            </Link>
          </Hint>
        )}
      </AuthoringFieldset>
      <AuthoringFieldset
        legend="Also notify"
        aside={counter}
        description="Optional channels that receive a copy. They never change who is paged."
      >
        {rule.actions.map((a, i) => (a.type === 'NOTIFY_CHANNEL' ? editor(a, i) : null))}
        {!destinations.length && (
          <Hint>
            No Slack or Teams destinations configured.{' '}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              href="/settings"
            >
              Configure notification destinations →
            </Link>
          </Hint>
        )}
        {addButton}
      </AuthoringFieldset>
    </div>
  );
}
