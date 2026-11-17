'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  isInsightsSection,
  type InsightsSectionId,
} from '@/lib/intelligence/incident-ux/strip-contract';
import { SQUIRE_OPEN_EVENT } from '@/components/squire/squire-bus';

// The inspector (sheet, resize handle, section navigation) is fetched the first time it is opened, so the
// incident route's first-load JavaScript carries only this small host.
const IncidentInsightsInspector = dynamic(() => import('./IncidentInsightsInspector'), {
  ssr: false,
});

export type InsightsTarget = {
  section: InsightsSectionId | null;
  /** An element id inside the inspector to scroll to instead of a section (`finding-<id>`). */
  anchor: string | null;
  /** Changes on every request, so asking for the same section twice scrolls again. */
  nonce: number;
};

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range']);

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return (
    // A checkbox, radio or button input takes no typing, so the shortcut still works after clicking one.
    (element.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((element as HTMLInputElement).type)) ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  );
};

function writeInsightsParam(section: InsightsSectionId | null | false) {
  const url = new URL(window.location.href);
  if (section === false) url.searchParams.delete('insights');
  else url.searchParams.set('insights', section ?? 'open');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Opens the insights inspector from wherever a responder is looking, without the openers importing it:
 *
 * - any link marked `data-insights-open="<section>"` (the strip's chips, the hero's group line, timeline rows);
 * - the keyboard shortcut `I` (registered in `src/lib/keyboard-shortcuts.ts`);
 * - `?insights=<section>` on load, for shareable links, and `#finding-<id>` for links to one item.
 *
 * `children` is the server-rendered inspector content; it is passed through untouched.
 */
export default function InsightsInspectorHost({
  sections,
  presentation = 'desktop',
  children,
}: {
  /** Sections that have content, in display order. */
  sections: InsightsSectionId[];
  presentation?: 'desktop' | 'mobile';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<InsightsTarget>({ section: null, anchor: null, nonce: 0 });
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const show = useCallback((section: InsightsSectionId | null, anchor: string | null = null) => {
    setLoaded(true);
    setOpen(true);
    setTarget(previous => ({ section, anchor, nonce: previous.nonce + 1 }));
    if (!anchor) writeInsightsParam(section);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    writeInsightsParam(false);
  }, []);

  useEffect(() => {
    const fromLocation = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (hash.startsWith('finding-')) {
        show(null, hash);
        return true;
      }
      // A jump into a core tab (Timeline, Runbooks) must not stay hidden behind the inspector.
      if (hash.startsWith('timeline-') || hash.startsWith('runbook-')) {
        if (openRef.current) hide();
        return true;
      }
      return false;
    };
    const requested = new URLSearchParams(window.location.search).get('insights');
    if (!fromLocation() && requested !== null)
      show(isInsightsSection(requested) ? requested : null);

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[data-insights-open]');
      if (!link) return;
      event.preventDefault();
      const section = link.getAttribute('data-insights-open');
      show(isInsightsSection(section) ? section : null);
    };

    // `G` then `I` is the global "go to incidents" chord: a lone `I` must not fire inside it.
    let chordStartedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'g') {
        chordStartedAt = Date.now();
        return;
      }
      const inChord = Date.now() - chordStartedAt < 1_000;
      chordStartedAt = 0;
      if (key !== 'i' || inChord) return;
      event.preventDefault();
      if (openRef.current) hide();
      else show(null);
    };

    // As a bottom sheet the inspector is modal and would sit on top of the assistant it just opened.
    // On desktop it stays: it is not modal and is layered below the assistant.
    const onSquireOpen = () => {
      const bottomSheet =
        presentation === 'mobile' || Boolean(window.matchMedia?.('(max-width: 639px)').matches);
      if (openRef.current && bottomSheet) hide();
    };

    const onHashChange = () => void fromLocation();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener(SQUIRE_OPEN_EVENT, onSquireOpen);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener(SQUIRE_OPEN_EVENT, onSquireOpen);
    };
  }, [show, hide, presentation]);

  if (!loaded) return null;
  return (
    <IncidentInsightsInspector
      open={open}
      onOpenChange={next => (next ? show(null) : hide())}
      target={target}
      sections={sections}
      forceBottomSheet={presentation === 'mobile'}
    >
      {children}
    </IncidentInsightsInspector>
  );
}
