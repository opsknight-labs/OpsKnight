'use client';

import React from 'react';
import { Search } from 'lucide-react';

export default function SettingsSearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => {
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          metaKey: true,
          bubbles: true,
        });
        document.dispatchEvent(event);
      }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/70 bg-card hover:bg-accent/60 text-xs text-muted-foreground hover:text-foreground transition-all shadow-xs"
      title="Search settings (⌘K)"
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search Settings...</span>
      <kbd className="pointer-events-none ml-1 inline-flex h-4 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  );
}
