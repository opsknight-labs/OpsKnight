import { AlertTriangle, Filter, Radio, ShieldCheck } from 'lucide-react';
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
            {trigger.conditions.length === 0 ? (
              <span
                className={cn(
                  chip,
                  'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-mono text-[11px]'
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                Wildcard (All Incidents)
              </span>
            ) : (
              <span className={cn(chip, 'border-border/80 bg-muted/40 text-foreground font-mono')}>
                {trigger.conditionLogic === 'OR' ? 'Match any' : 'Match all'}
              </span>
            )}
          </div>
          {trigger.conditions.length === 0 ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs text-muted-foreground shadow-2xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" aria-hidden />
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Wildcard Trigger · Automatically Matches All Incidents
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  No attribute filter conditions applied. This automated runbook will dispatch on
                  every <strong className="text-foreground">{eventLabel(trigger.event)}</strong>{' '}
                  event declared for this service.
                </p>
              </div>
            </div>
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
