'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { useThemePreference } from '@/hooks/use-theme-preference';
import { THEME_CHOICES, type ThemeChoice } from '@/lib/theme-preference';
import { cn } from '@/lib/utils';

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

type Props = {
  /** `xs`: icon-only compact switch (labels stay as accessible names and tooltips). */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  optionClassName?: string;
  onChange?: (choice: ThemeChoice) => void;
};

/**
 * System / Light / Dark radio group (WAI-ARIA radio pattern: one tab stop,
 * arrow keys move and select). "System" announces what it currently resolves
 * to so the choice is never ambiguous.
 */
export default function AppearanceControl({
  size = 'md',
  className,
  optionClassName,
  onChange,
}: Props) {
  const hintId = useId();
  const { choice, systemTheme, mounted, locked, setChoice } = useThemePreference();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (next: ThemeChoice) => {
    if (next === choice) return;
    setChoice(next);
    onChange?.(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    // Keep arrow keys inside the group when it lives in a menu.
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const index = THEME_CHOICES.indexOf(choice);
    const nextIndex = (index + delta + THEME_CHOICES.length) % THEME_CHOICES.length;
    const next = THEME_CHOICES.at(nextIndex) ?? choice;
    select(next);
    refs.current.at(nextIndex)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      onKeyDown={onKeyDown}
      className={cn(
        'grid grid-cols-3 gap-0.5 border border-border bg-muted p-0.5',
        size === 'xs' ? 'rounded-md' : 'rounded-lg',
        className
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }, index) => {
        const active = choice === value;
        return (
          <button
            key={value}
            ref={node => {
              refs.current.splice(index, 1, node);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-describedby={value === 'system' ? hintId : undefined}
            tabIndex={active ? 0 : -1}
            disabled={!mounted || locked}
            onClick={() => select(value)}
            title={size === 'xs' ? label : undefined}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-60',
              size === 'xs'
                ? 'h-6 w-7'
                : size === 'sm'
                  ? 'min-h-8 px-2 text-xs'
                  : 'min-h-9 px-3 text-sm',
              active
                ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
              optionClassName
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className={size === 'xs' ? 'sr-only' : 'whitespace-nowrap'}>{label}</span>
          </button>
        );
      })}
      <span id={hintId} className="sr-only">
        {mounted
          ? `Follows your device setting, currently ${systemTheme}`
          : 'Follows your device setting'}
      </span>
    </div>
  );
}
