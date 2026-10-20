import { Filter, Radio, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeCondition, eventLabel } from './rule-presentation';

export type RuleTriggerView = {
  id: string;
  event: string;
  enabled: boolean;
  conditionLogic: string;
  conditions: Array<{ id: string; field: string; operator: string; value: unknown }>;
};

const chip =
  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-2xs';

export function RuleTrigger({ triggers }: { triggers: RuleTriggerView[] }) {
  if (triggers.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-center">
        <p className="text-xs text-muted-foreground">
          No event triggers configured. This rule runs only when started manually.
        </p>
      </div>
    );
  return (
    <ul className="space-y-3">
      {triggers.map(trigger => (
        <li
          key={trigger.id}
          className={cn(
            'space-y-3 rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs p-3.5 sm:p-4 shadow-2xs transition-colors',
            !trigger.enabled && 'opacity-65'
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(chip, 'border-primary/30 bg-primary/10 text-primary')}>
              <Radio className="h-3.5 w-3.5" aria-hidden />
              {eventLabel(trigger.event)}
            </span>
            <span
              className={cn(
                chip,
                trigger.enabled
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-border/80 bg-muted/60 text-muted-foreground'
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              {trigger.enabled ? 'Enabled Trigger' : 'Disabled Trigger'}
            </span>
            {trigger.conditions.length > 0 && (
              <span className={cn(chip, 'border-border/80 bg-muted/40 text-foreground font-mono')}>
                {trigger.conditionLogic === 'OR' ? 'Match Any Condition' : 'Match All Conditions'}
              </span>
            )}
          </div>
          {trigger.conditions.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/60">
              <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              No filter conditions applied. Automatically matches every{' '}
              <strong className="text-foreground">{eventLabel(trigger.event)}</strong> event for
              this service.
            </p>
          ) : (
            <ul
              aria-label={`Conditions · ${trigger.conditionLogic === 'OR' ? 'Match any' : 'Match all'}`}
              className="flex flex-wrap items-center gap-2 pt-1"
            >
              {trigger.conditions.map((condition, index) => (
                <li key={condition.id} className="flex items-center gap-2">
                  {index > 0 && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1 py-0.5 rounded bg-muted/60">
                      {trigger.conditionLogic === 'OR' ? 'or' : 'and'}
                    </span>
                  )}
                  <span
                    className={cn(
                      chip,
                      'max-w-full break-all border-border/80 bg-background/80 font-mono text-xs font-normal text-foreground'
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
