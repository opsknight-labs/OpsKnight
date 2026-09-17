import React from 'react';
import { CommandPalette } from '@/components/settings/layout/CommandPalette';
import SettingsSubpageNav from '@/components/settings/SettingsSubpageNav';

type Props = {
  isAdmin?: boolean;
  isResponderOrAbove?: boolean;
  isAuditor?: boolean;
  children: React.ReactNode;
};

export default function SettingsShell({ children }: Props) {
  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 min-h-[calc(100vh-4rem)]">
      <CommandPalette />
      <SettingsSubpageNav />
      <main className="w-full">{children}</main>
    </div>
  );
}
