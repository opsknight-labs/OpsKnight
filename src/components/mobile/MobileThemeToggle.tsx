'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import MobileSettingCard from '@/components/mobile/MobileSettingCard';
import { cn } from '@/lib/utils';
import { haptics } from '@/lib/haptics';

const emptySubscribe = () => () => {};

const options = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export default function MobileThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const selected = mounted && (theme === 'light' || theme === 'dark') ? theme : 'system';
  const resolvedLabel = mounted ? (resolvedTheme === 'dark' ? 'Dark' : 'Light') : 'System';

  return (
    <MobileSettingCard
      icon={resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      title="Appearance"
      status={
        selected === 'system' ? `Following system · ${resolvedLabel}` : `${resolvedLabel} mode`
      }
    >
      <div
        className="mobile-segmented-control grid grid-cols-3 rounded-xl bg-muted p-1"
        role="radiogroup"
        aria-label="Appearance"
      >
        {options.map(option => {
          const Icon = option.icon;
          const active = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!mounted}
              onClick={() => {
                haptics.selection();
                setTheme(option.value);
              }}
              className={cn(
                'mobile-segmented-option inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">{option.label}</span>
            </button>
          );
        })}
      </div>
    </MobileSettingCard>
  );
}
