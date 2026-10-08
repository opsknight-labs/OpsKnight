'use client';
import Link from 'next/link';
import { ActionEditor } from './ActionEditor';
import { Button } from '@/components/ui/shadcn/button';
import type { Field, Rule, Action } from '@/lib/automation/contract';
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
  return (
    <div className="space-y-3">
      {rule.phase === 'ROUTE' ? (
        <>
          <h4 className="font-semibold text-sm">ROUTE TO · exactly one responder route</h4>
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
          {!policies.length && (
            <p className="text-sm text-muted-foreground">
              No escalation policies available.{' '}
              <Link className="underline" href="/policies">
                Create escalation policy →
              </Link>
            </p>
          )}
          <h4 className="font-semibold text-sm">ALSO NOTIFY · optional destinations</h4>
          {rule.actions.map((a, i) => (a.type === 'NOTIFY_CHANNEL' ? editor(a, i) : null))}
          {!destinations.length && (
            <p className="text-sm text-muted-foreground">
              No Slack or Teams destinations configured.{' '}
              <Link className="underline" href="/settings">
                Configure notification destinations →
              </Link>
            </p>
          )}
        </>
      ) : (
        <>
          <h4 className="font-semibold text-sm">THEN · enrich this incident</h4>
          {rule.actions.map(editor)}
        </>
      )}
      {!disabled && (
        <Button
          size="sm"
          variant="outline"
          disabled={rule.actions.length >= 8 || (rule.phase === 'ROUTE' && !destinations.length)}
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
          {rule.phase === 'ROUTE' ? 'Add notification' : 'Add enrichment'}
        </Button>
      )}
    </div>
  );
}
