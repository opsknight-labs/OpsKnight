'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { cn } from '@/lib/utils';

export type LinkTabItem = { href: string; label: string; icon?: ReactNode };

const iconSlot = 'flex shrink-0 items-center [&_svg]:h-4 [&_svg]:w-4';

/**
 * Navigation that looks and behaves like `DetailTabs` but moves between URLs (pages or `#section`
 * anchors): one scrolling row from `md` up, a "Section" picker on phones. Links stay real links, so
 * they work without JavaScript and keep `aria-current`.
 */
export function LinkTabs({
  items,
  activeHref,
  label,
  className,
}: {
  items: readonly LinkTabItem[];
  activeHref: string | null;
  /** Names the landmark and the phone picker ("On this page: Policy"). */
  label: string;
  className?: string;
}) {
  const current = items.find(item => item.href === activeHref) ?? items[0];
  if (!current) return null;
  const currentValue = (href: string) =>
    href !== activeHref ? undefined : href.startsWith('#') ? 'location' : 'page';
  return (
    <nav aria-label={label} className={cn('min-w-0', className)}>
      <div className="hidden overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] md:block [&::-webkit-scrollbar]:hidden">
        <ul className="flex w-max min-w-full items-center gap-1">
          {items.map(item => {
            const active = item.href === activeHref;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={currentValue(item.href)}
                  className={cn(
                    'group inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:min-h-9',
                    active
                      ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {item.icon && (
                    <span className={cn(iconSlot, active && 'text-primary')} aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label}: ${current.label}`}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {current.icon && (
                <span className={cn(iconSlot, 'text-muted-foreground')} aria-hidden="true">
                  {current.icon}
                </span>
              )}
              <span className="min-w-0 truncate">{current.label}</span>
              <ChevronsUpDown
                aria-hidden="true"
                className="ml-auto h-4 w-4 shrink-0 text-muted-foreground"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-2rem)]"
          >
            {items.map(item => (
              <DropdownMenuItem key={item.href} asChild className="min-h-11 gap-2">
                <Link href={item.href} aria-current={currentValue(item.href)}>
                  {item.icon && (
                    <span className={cn(iconSlot, 'text-muted-foreground')} aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

/**
 * Sticky "On this page" bar for a page of anchored sections. The active link follows the section in
 * view; without IntersectionObserver (or before anything scrolls) the first section is active.
 */
export function SectionLinkTabs({
  sections,
}: {
  sections: readonly { id: string; label: string }[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ids = sections.map(section => section.id).join(' ');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = ids
      .split(' ')
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    // A section counts as current while it crosses the band just under the sticky bar.
    const observer = new IntersectionObserver(
      entries => {
        const hit = entries.find(entry => entry.isIntersecting);
        if (hit) setActiveId(hit.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    targets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, [ids]);

  return (
    <div className="sticky top-0 z-20 -mx-1 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <LinkTabs
        label="On this page"
        items={sections.map(section => ({ href: `#${section.id}`, label: section.label }))}
        activeHref={`#${activeId ?? sections[0]?.id ?? ''}`}
      />
    </div>
  );
}
