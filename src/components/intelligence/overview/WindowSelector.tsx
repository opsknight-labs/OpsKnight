import Link from 'next/link';
import { OVERVIEW_WINDOW_LIST, type OverviewWindowKey } from '@/lib/intelligence/overview/window';
import { cn } from '@/lib/utils';

/**
 * Plain links, so the window works without client JavaScript and is shareable as a URL. Styled as the
 * Analytics range chips (FilterChip), with 44px targets on phones.
 */
export default function WindowSelector({
  current,
  basePath = '/intelligence',
}: {
  current: OverviewWindowKey;
  basePath?: string;
}) {
  return (
    <nav aria-label="Time window">
      <ul className="flex flex-wrap gap-1.5">
        {OVERVIEW_WINDOW_LIST.map(spec => {
          const active = spec.key === current;
          return (
            <li key={spec.key}>
              <Link
                href={`${basePath}?window=${spec.key}`}
                aria-current={active ? 'page' : undefined}
                title={spec.label}
                className={cn(
                  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-7 sm:min-h-0 sm:px-2.5',
                  active
                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {spec.label.replace('Last ', '')}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
