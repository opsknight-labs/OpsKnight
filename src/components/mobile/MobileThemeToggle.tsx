'use client';

import { Moon, Sun } from 'lucide-react';
import MobileSettingCard from '@/components/mobile/MobileSettingCard';
import AppearanceControl from '@/components/theme/AppearanceControl';
import { useThemePreference } from '@/hooks/use-theme-preference';
import { haptics } from '@/lib/haptics';

export default function MobileThemeToggle() {
  const { choice, effective, mounted } = useThemePreference();
  const resolvedLabel = effective === 'dark' ? 'Dark' : 'Light';
  const status = !mounted
    ? 'System'
    : choice === 'system'
      ? `Following system · ${resolvedLabel}`
      : `${resolvedLabel} mode`;

  return (
    <MobileSettingCard
      icon={effective === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      title="Appearance"
      status={status}
    >
      <AppearanceControl
        className="mobile-segmented-control rounded-xl p-1"
        optionClassName="mobile-segmented-option min-h-11 rounded-lg"
        onChange={() => haptics.selection()}
      />
    </MobileSettingCard>
  );
}
