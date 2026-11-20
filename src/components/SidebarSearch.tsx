'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { Search as SearchIcon } from 'lucide-react';

// The palette (cmdk, dialog, command list) loads on first hover, focus or ⌘K, not with the shell.
const loadPalette = () => import('@/components/command-palette/CommandPalette');
const CommandPalette = dynamic(loadPalette, { ssr: false });

const emptySubscribe = () => () => {};

/** Topbar trigger for the ⌘K command palette. Owns the global ⌘K / Ctrl+K shortcut. */
export default function SidebarSearch() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const modKey = useSyncExternalStore(
    emptySubscribe,
    () =>
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl',
    () => '⌘'
  );

  const show = (next: boolean) => {
    if (next) setMounted(true);
    setOpen(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMounted(true);
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => show(true)}
        onPointerEnter={() => void loadPalette()}
        onFocus={() => void loadPalette()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-9 w-full max-w-md cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-input hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SearchIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="hidden h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-2xs font-medium text-muted-foreground sm:inline-flex">
          {modKey}K
        </kbd>
      </button>
      {mounted && (
        <CommandPalette
          open={open}
          onOpenChange={show}
          returnFocusTo={triggerRef}
          modKey={modKey}
        />
      )}
    </>
  );
}
