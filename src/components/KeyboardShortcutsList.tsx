'use client';

import { Fragment } from 'react';
import { Keyboard } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import {
  KEYBOARD_SHORTCUTS,
  type KeyboardShortcutCategory,
  type KeyboardShortcutDefinition,
} from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

/** Display order of categories in the sheet and on /shortcuts. */
export const SHORTCUT_CATEGORY_ORDER: readonly KeyboardShortcutCategory[] = [
  'Actions',
  'Navigation',
  'Incident Triage',
];

export const SHORTCUT_CATEGORY_COPY = new Map<KeyboardShortcutCategory, string>([
  ['Actions', 'Search, switch theme and start common actions from any page.'],
  ['Navigation', 'Press G, then a letter, to jump to a section.'],
  ['Incident Triage', 'Work the incident list without the mouse.'],
]);

export function filterShortcuts(query: string): KeyboardShortcutDefinition[] {
  const q = query.toLowerCase().trim();
  if (!q) return KEYBOARD_SHORTCUTS;
  return KEYBOARD_SHORTCUTS.filter(
    shortcut =>
      shortcut.description.toLowerCase().includes(q) ||
      shortcut.category.toLowerCase().includes(q) ||
      shortcut.keys.some(key => key.toLowerCase().includes(q))
  );
}
/**
 * G-prefixed shortcuts are sequences (press G, release, press the letter); the rest are
 * alternatives (J or ↓) or chords (⌘ K).
 */
function keyJoiner(shortcut: KeyboardShortcutDefinition): string | null {
  if (shortcut.category === 'Navigation') return 'then';
  if (shortcut.keys[0] === '⌘/Ctrl') return null;
  return 'or';
}

export function ShortcutKeys({ shortcut }: { shortcut: KeyboardShortcutDefinition }) {
  const joiner = keyJoiner(shortcut);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shortcut.keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && joiner && (
            <span className="text-2xs text-muted-foreground" aria-hidden="true">
              {joiner}
            </span>
          )}
          <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs font-semibold text-foreground">
            {key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutRows({
  shortcuts,
  className,
}: {
  shortcuts: readonly KeyboardShortcutDefinition[];
  className?: string;
}) {
  return (
    <ul className={cn('divide-y divide-border/60', className)}>
      {shortcuts.map(shortcut => (
        <li key={shortcut.id} className="flex items-center justify-between gap-4 py-2">
          <span className="min-w-0 text-sm text-foreground">
            {shortcut.description}
            {shortcut.scope === 'incidents' && shortcut.category !== 'Incident Triage' && (
              <span className="text-muted-foreground"> · Incidents pages</span>
            )}
          </span>
          <ShortcutKeys shortcut={shortcut} />
        </li>
      ))}
    </ul>
  );
}

export function ShortcutsEmpty({ query }: { query: string }) {
  return (
    <EmptyState
      variant="simple"
      size="sm"
      icon={<Keyboard />}
      title={`No shortcuts match “${query}”`}
      description="Try a key such as “G” or an action such as “resolve”."
    />
  );
}
