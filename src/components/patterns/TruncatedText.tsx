'use client';

import { useRef, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { cn } from '@/lib/utils';

type TruncatedTextProps = {
  text: string;
  className?: string;
};

/**
 * One-line text that ellipsises; when (and only when) it is actually cut off, hovering or
 * focusing it shows the full text in a tooltip.
 */
export default function TruncatedText({ text, className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const isClipped = () => {
    const el = ref.current;
    return Boolean(el && el.scrollWidth > el.clientWidth);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={next => setOpen(next && isClipped())}>
        <TooltipTrigger asChild>
          <span ref={ref} className={cn('block min-w-0 truncate', className)}>
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs break-words">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
