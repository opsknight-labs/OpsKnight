'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Input } from '@/components/ui/shadcn/input';
import { KEYBOARD_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import {
  ShortcutRows,
  ShortcutsEmpty,
  filterShortcuts,
  groupShortcuts,
} from '@/components/KeyboardShortcutsList';

export default function KeyboardShortcuts({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const grouped = useMemo(() => groupShortcuts(filterShortcuts(searchQuery)), [searchQuery]);

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        data-shortcuts-sheet=""
        className="flex flex-col gap-0 p-0 sm:max-w-2xl sm:p-0 sm:pb-0"
      >
        <DialogHeader className="border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press{' '}
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-xs">?</kbd> on
            any console page to open this. Shortcuts pause while you type in a field.
          </DialogDescription>
          <div className="pt-2">
            <Input
              type="search"
              aria-label="Filter shortcuts"
              placeholder="Filter by key or action"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="h-9"
            />
          </div>
        </DialogHeader>

        <div
          // Focusable so keyboard users can scroll the list without a pointer.
          tabIndex={0}
          role="region"
          aria-label="Shortcut list"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
        >
          {grouped.length === 0 ? (
            <ShortcutsEmpty query={searchQuery.trim()} />
          ) : (
            grouped.map(([category, items]) => (
              <section key={category} aria-labelledby={`shortcuts-${category}`} className="py-2">
                <h3
                  id={`shortcuts-${category}`}
                  className="text-xs font-semibold text-muted-foreground"
                >
                  {category}
                </h3>
                <ShortcutRows shortcuts={items} />
              </section>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
          <span className="tabular-nums">{KEYBOARD_SHORTCUTS.length} shortcuts</span>
          <Link
            href="/shortcuts"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the full guide
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
