'use client';

import type { MouseEvent } from 'react';
import { cn } from '@/lib/utils';

const SKIP_LINK_CLASS =
  'sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:inline-flex focus:h-10 focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:no-underline focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background';

/** Move focus (not only scroll) to the target so the next Tab continues from there. */
function focusTarget(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
  target.scrollIntoView({ block: 'start' });
}

export default function SkipLinks() {
  return (
    <>
      <a
        href="#main-content"
        className={SKIP_LINK_CLASS}
        onClick={event => focusTarget(event, 'main-content')}
      >
        Skip to main content
      </a>
      <a
        href="#navigation"
        // Off-canvas (and inert) on phones, so there is nothing to skip to there.
        className={cn(SKIP_LINK_CLASS, 'focus:left-48 max-[768px]:hidden')}
        onClick={event => focusTarget(event, 'navigation')}
      >
        Skip to navigation
      </a>
    </>
  );
}
