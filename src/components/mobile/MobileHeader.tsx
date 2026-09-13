'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import MobileQuickSwitcher from '@/components/mobile/MobileQuickSwitcher';

type MobileHeaderProps = {
  systemStatus?: 'ok' | 'warning' | 'danger';
};

export default function MobileHeader({ systemStatus = 'ok' }: MobileHeaderProps) {
  const status = (() => {
    switch (systemStatus) {
      case 'ok':
        return { label: 'Operational', icon: CheckCircle2 };
      case 'warning':
        return { label: 'Degraded', icon: AlertTriangle };
      case 'danger':
        return { label: 'Critical issues', icon: ShieldAlert };
    }
  })();
  const StatusIcon = status.icon;

  return (
    <header className="mobile-header">
      <Link href="/m" className="mobile-header-logo" aria-label="OpsKnight home">
        <img src="/logo.svg" alt="" width={30} height={30} aria-hidden="true" />
        <span className="mobile-header-title">OpsKnight</span>
      </Link>

      <div className="mobile-header-actions">
        <MobileQuickSwitcher />
        <div
          className="mobile-header-status"
          data-status={systemStatus}
          role="status"
          aria-label={`System status: ${status.label}`}
        >
          <span className="mobile-status-icon" aria-hidden="true">
            <StatusIcon />
          </span>
          <span className="mobile-status-text">{status.label}</span>
        </div>
      </div>
    </header>
  );
}
