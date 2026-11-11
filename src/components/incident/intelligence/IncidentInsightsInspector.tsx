'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/shadcn/sheet';
import {
  INSIGHTS_SECTION_LABEL,
  INSIGHTS_WIDTH,
  INSIGHTS_WIDTH_KEY,
  type InsightsSectionId,
} from '@/lib/intelligence/incident-ux/strip-contract';
import type { InsightsTarget } from './InsightsInspectorHost';

const NARROW_QUERY = '(max-width: 639px)';

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia?.(NARROW_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
const isNarrow = () => Boolean(window.matchMedia?.(NARROW_QUERY).matches);

const clampWidth = (width: number) =>
  Math.round(
    Math.min(
      Math.max(width, INSIGHTS_WIDTH.min),
      Math.min(INSIGHTS_WIDTH.max, window.innerWidth - 48)
    )
  );

function readStoredWidth(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(INSIGHTS_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= INSIGHTS_WIDTH.min ? clampWidth(stored) : null;
  } catch {
    return null;
  }
}

function storeWidth(width: number) {
  try {
    window.localStorage.setItem(INSIGHTS_WIDTH_KEY, String(width));
  } catch {
    // Storage can be unavailable (private mode, policy); the width then lasts for this page only.
  }
}

/**
 * The insights inspector: every intelligence section for one incident, one click from the strip.
 *
 * On desktop it is a right-side sheet that is NOT modal: the incident behind it stays scrollable and usable,
 * clicking the page does not close it, and its width can be dragged (or changed with the arrow keys on the
 * handle) and is remembered in localStorage. Below 640 px, and always on the mobile route, it is a modal
 * bottom sheet. Escape or the close button closes it; focus returns to where it was.
 */
export default function IncidentInsightsInspector({
  open,
  onOpenChange,
  target,
  sections,
  forceBottomSheet = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: InsightsTarget;
  sections: InsightsSectionId[];
  forceBottomSheet?: boolean;
  children: ReactNode;
}) {
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const bottom = forceBottomSheet || narrow;
  const [width, setWidth] = useState<number | null>(readStoredWidth);
  const body = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const reveal = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (!element || !body.current?.contains(element)) return false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    if (element.hasAttribute('tabindex')) element.focus({ preventScroll: true });
    return true;
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = target.anchor ?? (target.section ? `insights-${target.section}` : null);
    if (!id) return;
    // The sheet's content mounts with the open transition; wait for it before scrolling.
    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      if (!reveal(id) && attempts < 30) frame = window.requestAnimationFrame(attempt);
    };
    frame = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(frame);
  }, [open, target, reveal]);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onHandlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setWidth(clampWidth(window.innerWidth - event.clientX));
  };
  const onHandlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const next = clampWidth(window.innerWidth - event.clientX);
    setWidth(next);
    storeWidth(next);
  };
  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? 32 : event.key === 'ArrowRight' ? -32 : 0;
    if (!step) return;
    event.preventDefault();
    const next = clampWidth((width ?? INSIGHTS_WIDTH.default) + step);
    setWidth(next);
    storeWidth(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={bottom}>
      <SheetContent
        side={bottom ? 'bottom' : 'right'}
        data-testid="insights-inspector"
        data-layout={bottom ? 'bottom-sheet' : 'side-panel'}
        // Non-modal on desktop: working on the incident behind the panel must not dismiss it.
        onInteractOutside={event => {
          if (!bottom) event.preventDefault();
        }}
        style={
          !bottom && width
            ? { width: `${width}px`, maxWidth: 'calc(100vw - var(--squire-dock-width, 0px))' }
            : undefined
        }
        className={
          bottom
            ? // The sheet primitive's close button is 34 px; as a bottom sheet it is a touch target.
              'flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0 motion-reduce:!animate-none motion-reduce:!transition-none [&>button]:h-11 [&>button]:w-11'
            : // Above the page chrome (sidebar 30), below the assistant (40), which it must never cover.
              // A docked assistant owns the right edge (--squire-dock-width); the panel sits beside it.
              'z-[35] flex w-full flex-col gap-0 p-0 sm:max-w-xl lg:right-[var(--squire-dock-width,0px)] motion-reduce:!animate-none motion-reduce:!transition-none'
        }
      >
        {!bottom && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize insights panel"
            aria-valuemin={INSIGHTS_WIDTH.min}
            aria-valuemax={INSIGHTS_WIDTH.max}
            aria-valuenow={width ?? INSIGHTS_WIDTH.default}
            tabIndex={0}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            onKeyDown={onHandleKeyDown}
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none bg-transparent hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none"
          />
        )}
        <SheetHeader className="space-y-1 border-b border-border px-4 py-3 pr-14 text-left">
          <SheetTitle className="text-base">Insights</SheetTitle>
          <SheetDescription className="text-xs">
            What intelligence found for this incident. Nothing here changes the incident on its own.
          </SheetDescription>
          {sections.length > 1 && (
            <nav aria-label="Insight sections" className="-mx-1 overflow-x-auto scrollbar-none">
              <ul className="flex items-center gap-1 px-1 pt-1">
                {sections.map(section => (
                  <li key={section} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => reveal(`insights-${section}`)}
                      className={`inline-flex min-h-11 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        bottom ? '' : 'sm:min-h-8'
                      }`}
                    >
                      {INSIGHTS_SECTION_LABEL.get(section)}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </SheetHeader>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
