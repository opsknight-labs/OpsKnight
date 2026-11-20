'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemePreference } from '@/hooks/use-theme-preference';
import { isThemeChoice, type ThemeChoice } from '@/lib/theme-preference';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * Compact appearance switch for the sidebar footer: one icon button showing the
 * current choice, opening System / Light / Dark. Same preference (account-saved,
 * synced across tabs) as the profile and top-bar appearance controls.
 */
export default function SidebarThemeMenu({
  className,
  side = 'top',
}: {
  className?: string;
  side?: 'top' | 'right';
}) {
  const { choice, systemTheme, mounted, locked, setChoice } = useThemePreference();
  const current = OPTIONS.find(option => option.value === choice) ?? OPTIONS[0];
  const Icon = current.icon;
  const label = `Appearance: ${current.label}${choice === 'system' && mounted ? ` (${systemTheme})` : ''}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!mounted || locked}
        aria-label={label}
        title={label}
        className={cn(
          'flex items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-white/10 hover:text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-50',
          className
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" className="min-w-[10rem]">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={value => {
            if (isThemeChoice(value)) setChoice(value);
          }}
        >
          {OPTIONS.map(({ value, label: optionLabel, icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2">
              <OptionIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {optionLabel}
              {value === 'system' && mounted && (
                <span className="ml-auto pl-3 text-2xs capitalize text-muted-foreground">
                  {systemTheme}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
