'use client';

import React, { useSyncExternalStore } from 'react';
import { Search } from 'lucide-react';

const emptySubscribe = () => () => {};

export default function SettingsSearchTrigger() {
  const shortcutLabel = useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof navigator !== 'undefined' &&
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
        ? '⌘K'
        : 'Ctrl+K',
    () => '⌘K'
  );

  const handleClick = () => {
    const isMac =
      typeof navigator !== 'undefined' &&
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent);
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/70 bg-card hover:bg-accent/60 text-xs text-muted-foreground hover:text-foreground transition-all shadow-xs"
      title={`Search settings (${shortcutLabel})`}
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search Settings...</span>
      <kbd className="pointer-events-none ml-1 inline-flex h-4 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
        {shortcutLabel}
      </kbd>
    </button>
  );
}
