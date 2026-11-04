'use client';

import type { ReactNode } from 'react';
import { Info, ExternalLink } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';

/**
 * A small "what is this?" explanation next to a setting. A popover rather than a hover tooltip,
 * so it works with touch and the keyboard, and can hold a link to the full guide.
 */
export default function HelpHint({
  label,
  children,
  href,
}: {
  /** What the hint explains, for screen readers: "About allowed domains". */
  label: string;
  children: ReactNode;
  href?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        // Opts out of the page-wide compact button padding that would squash the icon.
        data-icon-button
        aria-label={label}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-xs leading-relaxed">
        <div className="text-foreground">{children}</div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            Read the guide
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
