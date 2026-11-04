'use client';

import Spinner from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

export type ProviderType = 'google' | 'okta' | 'azure' | 'auth0' | 'custom' | null | undefined;

type Props = {
  providerType?: ProviderType;
  providerLabel?: string | null;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
};

// Map provider types to Tailwind class strings and icons
const providerConfig: Record<
  string,
  { classes: string; icon: React.ReactNode; defaultLabel: string }
> = {
  google: {
    classes:
      'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs hover:shadow-sm',
    defaultLabel: 'Google',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    ),
  },
  okta: {
    classes: 'bg-[#00297A] hover:bg-[#001d5c] text-white border-transparent',
    defaultLabel: 'Okta',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
        <path d="M12 0C5.389 0 0 5.35 0 12s5.35 12 12 12 12-5.35 12-12S18.611 0 12 0zm0 18c-3.315 0-6-2.685-6-6s2.685-6 6-6 6 2.685 6 6-2.685 6-6 6z" />
      </svg>
    ),
  },
  azure: {
    classes: 'bg-[#0078D4] hover:bg-[#005a9e] text-white border-transparent',
    defaultLabel: 'Microsoft',
    icon: (
      <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
    ),
  },
  auth0: {
    classes: 'bg-[#EB5424] hover:bg-[#c44118] text-white border-transparent',
    defaultLabel: 'Auth0',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
        <path d="M21.98 7.448L19.62 0H4.347L2.02 7.448c-1.352 4.312.03 9.206 3.815 12.015L12.007 24l6.157-4.552c3.755-2.81 5.182-7.688 3.815-12.015l-6.16 4.58 2.343 7.45-6.157-4.597-6.158 4.58 2.358-7.433-6.188-4.55 7.63-.045L12.008 0l2.356 7.404 7.615.044z" />
      </svg>
    ),
  },
  custom: {
    classes:
      'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs hover:shadow-sm',
    defaultLabel: 'SSO',
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
};

export default function SsoButton({
  providerType,
  providerLabel,
  onClick,
  loading,
  disabled,
}: Props) {
  const providerKey = providerType && providerConfig[providerType] ? providerType : 'custom';
  const config = providerConfig[providerKey];
  const label = providerLabel || config.defaultLabel;
  const isGoogle = providerKey === 'google';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      aria-label={`Continue with ${label}`}
      className={cn(
        'group relative w-full h-11 2xl:h-12 flex items-center justify-center gap-2.5 px-4',
        'rounded-lg text-sm font-medium border select-none cursor-pointer',
        'transition-all duration-150 transform',
        'active:scale-[0.995] disabled:opacity-50 disabled:cursor-not-allowed',
        config.classes
      )}
    >
      {loading ? (
        <>
          <Spinner size="sm" variant={isGoogle ? 'default' : 'white'} />
          <span>Connecting...</span>
        </>
      ) : (
        <>
          {config.icon}
          <span>Continue with {label}</span>
        </>
      )}
    </button>
  );
}
