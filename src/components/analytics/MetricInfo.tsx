'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { METRICS, type MetricId } from '@/lib/analytics/definitions';

/** Definition tooltip; the text comes from the metric registry, never inline copy. */
export default function MetricInfo({ metrics }: { metrics: MetricId[] }) {
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
  const definitions = metrics.map(id => METRICS[id]);
  const label =
    definitions.length === 1
      ? `How ${definitions[0].label} is calculated`
      : 'How these metrics are calculated';
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1.5 text-xs font-normal">
          {definitions.map(definition => (
            <p key={definition.label}>
              <span className="font-semibold">{definition.label}:</span> {definition.description}
            </p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
