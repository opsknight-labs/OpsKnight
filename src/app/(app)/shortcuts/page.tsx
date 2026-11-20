'use client';

import { useMemo, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { cn } from '@/lib/utils';
import { KEYBOARD_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import {
  SHORTCUT_CATEGORY_COPY,
  SHORTCUT_CATEGORY_ORDER,
  ShortcutRows,
  ShortcutsEmpty,
  filterShortcuts,
} from '@/components/KeyboardShortcutsList';

const categories = [...new Set(KEYBOARD_SHORTCUTS.map(shortcut => shortcut.category))].sort(
  (a, b) => SHORTCUT_CATEGORY_ORDER.indexOf(a) - SHORTCUT_CATEGORY_ORDER.indexOf(b)
);

export default function ShortcutsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const filtered = useMemo(() => filterShortcuts(searchQuery), [searchQuery]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Operator Productivity"
        title="Keyboard Shortcuts"
        icon={Keyboard}
        description={
          <>
            Press{' '}
            <kbd className="rounded border border-zinc-600 px-1 font-mono text-xs text-zinc-100">
              ?
            </kbd>{' '}
            on any console page for the quick sheet. Shortcuts pause while you type in a field.
          </>
        }
        secondaryActions={
          <Button
            variant="outline"
            size="sm"
            className={cn('gap-2', pageHeaderActionClass)}
            onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Open quick sheet
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          aria-label="Filter shortcuts"
          placeholder="Filter by key or action"
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          className="h-9 sm:max-w-sm"
        />
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {filtered.length} of {KEYBOARD_SHORTCUTS.length} shortcuts
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          <ShortcutsEmpty query={searchQuery.trim()} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {categories.map(category => {
            const shortcuts = filtered.filter(shortcut => shortcut.category === category);
            if (shortcuts.length === 0) return null;
            return (
              <section
                key={category}
                aria-labelledby={`shortcut-group-${category}`}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <h2
                  id={`shortcut-group-${category}`}
                  className="text-base font-semibold text-foreground"
                >
                  {category}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {SHORTCUT_CATEGORY_COPY.get(category)}
                </p>
                <ShortcutRows shortcuts={shortcuts} className="mt-2" />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
