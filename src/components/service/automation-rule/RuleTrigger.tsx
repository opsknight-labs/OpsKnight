import { Filter, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeCondition, eventLabel } from './rule-presentation';

export type RuleTriggerView = {
  id: string;
  event: string;
  enabled: boolean;
  conditionLogic: string;
  conditions: Array<{ id: string; field: string; operator: string; value: unknown }>;
};

const chip = 'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium';

export function RuleTrigger({ triggers }: { triggers: RuleTriggerView[] }) {
  if (triggers.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No event triggers configured. This rule runs only when started manually.
      </p>
    );
  return (
    <ul className="space-y-3">
      {triggers.map(trigger => (
        <li
          key={trigger.id}
          className={cn('space-y-3 rounded-lg border p-4', !trigger.enabled && 'opacity-70')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(chip, 'border-primary/30 bg-primary/5 text-primary')}>
              <Radio className="h-3 w-3" aria-hidden />
              {eventLabel(trigger.event)}
            </span>
            <span
              className={cn(
                chip,
                trigger.enabled
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-border bg-muted text-muted-foreground'
              )}
            >
              {trigger.enabled ? 'Enabled condition rule' : 'Disabled condition rule'}
            </span>
            {trigger.conditions.length > 0 && (
              <span className={cn(chip, 'border-border bg-muted/40 text-foreground')}>
                {trigger.conditionLogic === 'OR' ? 'Match any' : 'Match all'}
              </span>
            )}
          </div>
          {trigger.conditions.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
              No conditions. Matches every {eventLabel(trigger.event).toLowerCase()} event for this
              service.
            </p>
          ) : (
            <ul
              aria-label={`Conditions · ${trigger.conditionLogic === 'OR' ? 'Match any' : 'Match all'}`}
              className="flex flex-wrap items-center gap-2"
            >
              {trigger.conditions.map((condition, index) => (
                <li key={condition.id} className="flex items-center gap-2">
                  {index > 0 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {trigger.conditionLogic === 'OR' ? 'or' : 'and'}
                    </span>
                  )}
                  <span
                    className={cn(
                      chip,
                      'max-w-full break-all border-border bg-background font-mono font-normal text-foreground'
                    )}
                  >
                    {describeCondition(condition)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
