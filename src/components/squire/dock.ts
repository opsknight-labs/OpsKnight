'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Docked display for the assistant on desktop.
 *
 * Floating (the default) lays the panel over the page. Docked pins it as a full-height column on the
 * right, below the app header, and the page reflows beside it: while docked and open the launcher sets
 * `--squire-dock-width` and the `squire-docked` class on `<html>`, and the app shell pads its content
 * row by that variable on `lg` screens. Nothing is set while the panel is closed, floating, full screen
 * (mobile) or the viewport is narrower than `lg`, so the shell falls back to no padding.
 *
 * The person's choice is stored next to `opsknight.squire.side`. Until they choose, the panel floats,
 * except when another part of an incident page opens it with that incident as context; then it docks
 * for as long as they stay on that incident.
 */
export const DISPLAY_KEY = 'opsknight.squire.display';
export const DOCK_WIDTH_VARIABLE = '--squire-dock-width';
export const DOCK_CLASS = 'squire-docked';
/** Wide enough for an answer, narrow enough to leave the incident's main column readable at 1024 px. */
export const DOCK_WIDTH = 'clamp(20rem, 26vw, 28rem)';
/** Tailwind's `lg` breakpoint; the shell padding uses the same one. */
export const DOCK_MEDIA = '(min-width: 1024px)';

/** The fixed wrapper and the panel while docked. The width repeats {@link DOCK_WIDTH}. */
export const DOCK_WRAPPER_CLASS = 'fixed bottom-0 right-0 top-14 z-40 print:hidden';
export const DOCK_PANEL_CLASS =
  'relative flex h-full w-[clamp(20rem,26vw,28rem)] min-w-0 flex-col overflow-hidden border-l border-border bg-card';

export type SquireDisplay = 'floating' | 'docked';

const DISPLAY_EVENT = 'squire:display';

export function readDisplayPreference(): SquireDisplay | null {
  try {
    const stored = window.localStorage.getItem(DISPLAY_KEY);
    return stored === 'docked' || stored === 'floating' ? stored : null;
  } catch {
    return null;
  }
}

export function writeDisplayPreference(display: SquireDisplay): void {
  try {
    window.localStorage.setItem(DISPLAY_KEY, display);
  } catch {
    // Storage can be disabled; the choice then lasts until the page is left.
  }
  window.dispatchEvent(new Event(DISPLAY_EVENT));
}

const subscribePreference = (onChange: () => void) => {
  window.addEventListener(DISPLAY_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DISPLAY_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
const serverPreference = (): SquireDisplay | null => null;

const desktopQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DOCK_MEDIA)
    : null;
const subscribeDesktop = (onChange: () => void) => {
  const query = desktopQuery();
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
};
const readDesktop = () => desktopQuery()?.matches ?? false;
const serverDesktop = () => false;

export interface SquireDock {
  /** Docking is possible here: a desktop-width viewport and not the full-screen mobile presentation. */
  available: boolean;
  /** The panel is to be rendered docked when open. */
  docked: boolean;
  /** Switch between docked and floating, and remember it. */
  toggle: () => void;
  /** Dock by default for this incident, unless the person has chosen a display mode. */
  suggestDock: (incidentId: string) => void;
}

export function useSquireDock({
  open,
  fullscreen = false,
  incidentId,
}: {
  open: boolean;
  fullscreen?: boolean;
  incidentId?: string;
}): SquireDock {
  const preference = useSyncExternalStore(
    subscribePreference,
    readDisplayPreference,
    serverPreference
  );
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, serverDesktop);
  // The incident a hand-off asked to dock for. Leaving that incident drops the suggestion.
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  // An explicit choice made while storage is unavailable still holds for this page view.
  const [chosen, setChosen] = useState<SquireDisplay | null>(null);

  const suggested = Boolean(incidentId) && suggestedFor === incidentId;
  const display: SquireDisplay = preference ?? chosen ?? (suggested ? 'docked' : 'floating');
  const available = desktop && !fullscreen;
  const docked = available && display === 'docked';

  useEffect(() => {
    if (!docked || !open) return;
    const root = document.documentElement;
    root.style.setProperty(DOCK_WIDTH_VARIABLE, DOCK_WIDTH);
    root.classList.add(DOCK_CLASS);
    return () => {
      root.style.removeProperty(DOCK_WIDTH_VARIABLE);
      root.classList.remove(DOCK_CLASS);
    };
  }, [docked, open]);

  const toggle = useCallback(() => {
    const next: SquireDisplay = display === 'docked' ? 'floating' : 'docked';
    setChosen(next);
    writeDisplayPreference(next);
  }, [display]);
  const suggestDock = useCallback((id: string) => setSuggestedFor(id), []);

  return { available, docked, toggle, suggestDock };
}
