'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import MobileCard from '@/components/mobile/MobileCard';
import { cn } from '@/lib/utils';
import { haptics } from '@/lib/haptics';

const options = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export default function MobileThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const selected = mounted && (theme === 'light' || theme === 'dark') ? theme : 'system';
  const resolvedLabel = mounted ? (resolvedTheme === 'dark' ? 'Dark' : 'Light') : 'System';

  return (
    <MobileCard variant="default" padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Appearance</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selected === 'system' ? `Following system · ${resolvedLabel}` : `${resolvedLabel} mode`}
          </p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </span>
      </div>

      <div className="grid grid-cols-3 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Appearance">
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
                'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </MobileCard>
  );
}
