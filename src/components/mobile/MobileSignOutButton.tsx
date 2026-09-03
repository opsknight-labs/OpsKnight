'use client';

import { signOut } from 'next-auth/react';
import { useState, type ReactNode } from 'react';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';

type Props = {
  icon: ReactNode;
  label: string;
  description: string;
  tone: 'red' | 'slate' | 'blue' | 'teal' | 'amber' | 'green';
};

export default function MobileSignOutButton({ icon, label, description, tone }: Props) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await purgeBrowserAuthCaches();
    await signOut({ callbackUrl: '/m/login' });
  };

  return (
    <div
      className="mobile-more-item danger"
      onClick={handleSignOut}
      style={{ cursor: 'pointer', opacity: isSigningOut ? 0.7 : 1 }}
    >
      <div className={`mobile-more-icon tone-${tone}`}>{icon}</div>
      <div className="mobile-more-item-body">
        <span className="mobile-more-item-label">{isSigningOut ? 'Signing out...' : label}</span>
        <span className="mobile-more-item-desc">{description}</span>
      </div>
      <svg className="mobile-more-item-chevron" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9 6l6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
