'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';

/** Relative text is computed by the server so hydration output stays stable. */
export function RuleTimestamp({
  iso,
  relative,
  absolute,
  className,
}: {
  iso: string;
  relative: string;
  absolute: string;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={iso} title={absolute} tabIndex={0} className={className}>
            {relative}
          </time>
        </TooltipTrigger>
        <TooltipContent>{absolute}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
