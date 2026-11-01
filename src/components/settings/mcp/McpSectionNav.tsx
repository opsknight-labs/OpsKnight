import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type McpNavItem = {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  count?: number;
  /** Draws attention to the count, e.g. pending approvals. */
  attention?: boolean;
};

/**
 * Section navigation for the MCP page. Plain links (one URL per section), so each section is
 * linkable, works without JavaScript and the server only loads what it shows.
 */
export default function McpSectionNav({
  items,
  current,
}: {
  items: McpNavItem[];
  current: string;
}) {
  return (
    <nav
      aria-label="MCP settings sections"
      className="relative -mx-1 overflow-x-auto px-1 pb-1 scrollbar-none"
    >
      <ul className="inline-flex min-w-max items-center gap-1 rounded-xl border border-border/80 bg-muted/60 p-1 shadow-2xs sm:gap-1.5 sm:p-1.5">
        {items.map(item => {
          const active = item.id === current;
          return (
            <li key={item.id} className="p-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:px-3',
                  active
                    ? 'border-primary/50 bg-background font-semibold text-foreground shadow-xs ring-2 ring-primary/15'
                    : 'border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5',
                    active ? 'text-primary' : 'group-hover:text-primary'
                  )}
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                {item.label}
                {item.count !== undefined && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                      item.attention && item.count > 0
                        ? 'border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/70 dark:text-amber-300'
                        : active
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted-foreground/10 text-muted-foreground'
                    )}
                  >
                    {item.attention && item.count > 0 && (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                    )}
                    {item.count}
                    {item.attention && item.count > 0 && <span className="sr-only"> pending</span>}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
