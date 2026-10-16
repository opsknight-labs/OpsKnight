'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';

/** Wide side sheet for rule create/configure flows; body scrolls, header stays put. */
export function RuleSheet({
  title,
  description,
  trigger,
  children,
}: {
  title: string;
  description: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 border-b px-6 py-5 pr-16 text-left">
          <SheetTitle className="text-base font-semibold tracking-tight">{title}</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">{description}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** Sticky in-sheet section jumper; scrolls without touching the URL hash. */
export function SheetJumpNav({
  label,
  items,
}: {
  label: string;
  items: Array<{ id: string; label: string; tone?: 'danger' }>;
}) {
  return (
    <nav
      aria-label={label}
      className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 overflow-x-auto border-b bg-background/95 px-6 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <ul className="flex min-w-max gap-1">
        {items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                item.tone === 'danger' && 'hover:text-destructive'
              )}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Titled group inside a rule sheet; `id` makes it a jump target. */
export function SheetGroup({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-label={title} className={cn('scroll-mt-16', className)}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
