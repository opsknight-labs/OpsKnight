'use client';

import Link from 'next/link';
import MobileQuickSwitcher from '@/components/mobile/MobileQuickSwitcher';

type MobileHeaderProps = {
  systemStatus?: 'ok' | 'warning' | 'danger';
};

export default function MobileHeader({ systemStatus = 'ok' }: MobileHeaderProps) {
  const status = (() => {
    switch (systemStatus) {
      case 'ok':
        return 'All Systems Operational';
      case 'warning':
        return 'Degraded Performance';
      case 'danger':
        return 'Critical Issues';
    }
  })();

  return (
    <header className="mobile-header">
      <Link href="/m" className="mobile-header-logo">
        {/* Using img instead of Next.js Image for SVG - no optimization benefit for vectors */}
        <img src="/logo.svg" alt="OpsKnight" width={28} height={28} />
        <span className="mobile-header-title">OpsKnight</span>
      </Link>

      <div className="mobile-header-actions">
        <MobileQuickSwitcher />
        <div className="mobile-header-status" data-status={systemStatus}>
          <span className="mobile-status-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M8.5 12.5h7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="mobile-status-text">{status}</span>
        </div>
      </div>
    </header>
  );
}
