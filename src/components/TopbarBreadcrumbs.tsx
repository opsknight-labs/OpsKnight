'use client';

import { Fragment, useEffect, useMemo, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
  BreadcrumbEllipsis,
} from '@/components/ui/shadcn/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import ListReturnLink from '@/components/layout/ListReturnLink';
import { buildBreadcrumbs, currentEntityHref, type Crumb } from '@/lib/navigation/breadcrumbs';
import {
  getBreadcrumbLabels,
  setBreadcrumbLabel,
  subscribeBreadcrumbLabels,
} from '@/lib/navigation/breadcrumb-labels';
import { cn } from '@/lib/utils';

const NO_LABELS: ReadonlyMap<string, string> = new Map();
const getServerLabels = () => NO_LABELS;

/** Publish the current entity page's heading as its breadcrumb name. */
function usePageHeadingLabel(pathname: string) {
  useEffect(() => {
    const entityHref = currentEntityHref(pathname);
    const main = document.getElementById('main-content');
    if (!entityHref || !main) return;

    let frame = 0;
    const read = () => {
      frame = 0;
      const heading = main.querySelector('h1');
      const text = heading?.textContent?.trim();
      if (text) setBreadcrumbLabel(entityHref, text);
    };
    read();
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(read);
    });
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);
}

const linkClass =
  'block truncate rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function CrumbContent({ crumb }: { crumb: Crumb }) {
  const title =
    crumb.isEntity && crumb.label !== crumb.segment
      ? `${crumb.label} (${crumb.segment})`
      : crumb.label;

  if (crumb.isCurrent) {
    return (
      <BreadcrumbPage
        className={cn(
          'block max-w-[14rem] truncate font-medium text-foreground xl:max-w-[18rem]',
          crumb.isEntity && 'tabular-nums'
        )}
        title={title}
      >
        {crumb.label}
      </BreadcrumbPage>
    );
  }

  if (!crumb.isLink) {
    return (
      <span className="block max-w-[9rem] truncate text-muted-foreground" title={title}>
        {crumb.label}
      </span>
    );
  }

  return (
    <BreadcrumbLink asChild className={cn(linkClass, 'max-w-[9rem] xl:max-w-[12rem]')}>
      <ListReturnLink href={crumb.href} title={title}>
        {crumb.label}
      </ListReturnLink>
    </BreadcrumbLink>
  );
}

export default function TopbarBreadcrumbs() {
  const pathname = usePathname() || '/';
  const labels = useSyncExternalStore(
    subscribeBreadcrumbLabels,
    getBreadcrumbLabels,
    getServerLabels
  );
  usePageHeadingLabel(pathname);

  const crumbs = useMemo(() => buildBreadcrumbs(pathname, labels), [pathname, labels]);
  if (crumbs.length === 0) return null;

  // Long trails keep the section and the last two crumbs; the middle folds into a menu.
  const collapsed = crumbs.length > 3;
  const head = collapsed ? crumbs.slice(0, 1) : crumbs;
  const middle = collapsed ? crumbs.slice(1, -2) : [];
  const tail = collapsed ? crumbs.slice(-2) : [];

  return (
    <Breadcrumb aria-label="Breadcrumb" className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1.5 whitespace-nowrap text-xs sm:gap-1.5">
        {head.map((crumb, index) => (
          <Fragment key={crumb.href}>
            {index > 0 && (
              <BreadcrumbSeparator className="text-muted-foreground/60 [&>svg]:size-3" />
            )}
            <BreadcrumbItem
              className={cn('min-w-0', !crumb.isCurrent && 'min-w-[3.5rem] shrink-[4]')}
            >
              <CrumbContent crumb={crumb} />
            </BreadcrumbItem>
          </Fragment>
        ))}
        {collapsed && (
          <>
            <BreadcrumbSeparator className="text-muted-foreground/60 [&>svg]:size-3" />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Show ${middle.length} more ${middle.length === 1 ? 'level' : 'levels'}`}
                >
                  <BreadcrumbEllipsis className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[10rem] max-w-[20rem]">
                  {middle.map(crumb =>
                    crumb.isLink ? (
                      <DropdownMenuItem key={crumb.href} asChild className="text-xs">
                        <ListReturnLink href={crumb.href} title={crumb.label}>
                          <span className="truncate">{crumb.label}</span>
                        </ListReturnLink>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        key={crumb.href}
                        disabled
                        className="text-xs"
                        title={crumb.label}
                      >
                        <span className="truncate">{crumb.label}</span>
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            {tail.map(crumb => (
              <Fragment key={crumb.href}>
                <BreadcrumbSeparator className="text-muted-foreground/60 [&>svg]:size-3" />
                <BreadcrumbItem
                  className={cn('min-w-0', !crumb.isCurrent && 'min-w-[3.5rem] shrink-[4]')}
                >
                  <CrumbContent crumb={crumb} />
                </BreadcrumbItem>
              </Fragment>
            ))}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
