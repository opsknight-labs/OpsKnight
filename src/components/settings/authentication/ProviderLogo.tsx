import React from 'react';

export function ProviderLogo({
  providerType,
  className = 'h-5 w-5 shrink-0',
}: {
  providerType: string;
  className?: string;
}) {
  switch (providerType) {
    case 'azure':
      return (
        <svg className={className} viewBox="0 0 21 21" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#f25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
          <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
      );
    case 'google':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
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
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
      );
    case 'okta':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <circle cx="12" cy="12" r="10" fill="#007DC1" />
          <circle cx="12" cy="12" r="5" fill="white" />
        </svg>
      );
    case 'auth0':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="#EB5424">
          <path d="M21.98 7.348L19.347.8A1.332 1.332 0 0 0 17.69.043L12 2.378 6.31.043a1.332 1.332 0 0 0-1.657.757L2.02 7.348a1.332 1.332 0 0 0 .546 1.606l9.434 5.923-3.41 3.526a.666.666 0 0 0 .474 1.137h5.872a.666.666 0 0 0 .474-1.137l-3.41-3.526 9.433-5.923a1.332 1.332 0 0 0 .546-1.606z" />
        </svg>
      );
    case 'custom':
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-5.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"
            fill="#00B4B4"
          />
          <circle cx="12" cy="9" r="1.5" fill="white" />
        </svg>
      );
  }
}

export default ProviderLogo;
