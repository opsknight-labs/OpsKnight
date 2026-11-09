import Link from 'next/link';
import { OVERVIEW_WINDOW_LIST, type OverviewWindowKey } from '@/lib/intelligence/overview/window';
import { cn } from '@/lib/utils';

/** Plain links, so the window works without client JavaScript and is shareable as a URL. */
export default function WindowSelector({
  current,
  basePath = '/intelligence',
}: {
  current: OverviewWindowKey;
  basePath?: string;
}) {
  return (
    <nav
      aria-label="Time window"
      className="inline-flex rounded-lg border border-border bg-card p-1"
    >
      <ul className="flex gap-1">
        {OVERVIEW_WINDOW_LIST.map(spec => {
          const active = spec.key === current;
          return (
            <li key={spec.key}>
              <Link
                href={`${basePath}?window=${spec.key}`}
                aria-current={active ? 'page' : undefined}
                title={spec.label}
                className={cn(
                  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {spec.short} <span className="sr-only">({spec.label.toLowerCase()})</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
