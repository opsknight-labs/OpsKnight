import React from 'react';
import { CommandPalette } from '@/components/settings/layout/CommandPalette';

type Props = {
  isAdmin?: boolean;
  isResponderOrAbove?: boolean;
  isAuditor?: boolean;
  children: React.ReactNode;
};

/** Page frame for every settings route; each page renders its own `SettingsPageHeader`. */
export default function SettingsShell({ children, isAdmin, isResponderOrAbove, isAuditor }: Props) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8">
      <CommandPalette
        isAdmin={isAdmin}
        isResponderOrAbove={isResponderOrAbove}
        isAuditor={isAuditor}
      />
      {children}
    </div>
  );
}
