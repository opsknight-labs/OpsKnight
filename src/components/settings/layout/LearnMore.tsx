import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Closed "Learn more" disclosure for the explanation behind a setting, so a section keeps a one-line
 * description. Native `<details>`: server-safe, keyboard and screen-reader friendly without script.
 */
export function LearnMore({
  children,
  label = 'Learn more',
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <details className={cn('group/learn-more text-sm', className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open/learn-more:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        {label}
      </summary>
      <div className="max-w-3xl space-y-2 pb-1 pl-5 pt-1 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
