import React from 'react';
import SettingsTopNav from '@/components/settings/layout/SettingsTopNav';

type Props = {
  isAdmin?: boolean;
  isResponderOrAbove?: boolean;
  isAuditor?: boolean;
  children: React.ReactNode;
};

export default function SettingsShell({
  isAdmin = false,
  isResponderOrAbove = false,
  isAuditor = false,
  children,
}: Props) {
  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 min-h-[calc(100vh-4rem)]">
      <SettingsTopNav
        isAdmin={isAdmin}
        isAuditor={isAuditor}
        isResponderOrAbove={isResponderOrAbove}
      />
      <main className="w-full">{children}</main>
    </div>
  );
}
