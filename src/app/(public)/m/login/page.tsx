import MobileLoginClient from './MobileLoginClient';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getOidcConfig, getOidcPublicConfig } from '@/lib/oidc-config';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

type SearchParams = {
  callbackUrl?: string;
  error?: string;
  password?: string;
};

export default async function MobileLoginPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  // Bootstrap check: If no users exist, redirect to setup
  let userCount = 0;
  try {
    userCount = await prisma.user.count();
  } catch (error) {
    if (!isNextRedirectError(error)) {
      logger.error('Failed to check user count', { component: 'mobile-login-page', error });
    }
  }

  if (userCount === 0) {
    redirect('/setup');
  }

  const session = await getServerSession(await getAuthOptions());
  const oidcConfig = await getOidcConfig();
  const ssoConfig = await getOidcPublicConfig();
  const ssoEnabled = Boolean(oidcConfig);
  const ssoError =
    ssoConfig?.enabled && !oidcConfig
      ? 'Single sign-on is enabled but not configured correctly. Contact your administrator.'
      : null;

  // If already authenticated, redirect to mobile dashboard
  if (session) {
    if (session?.user?.email) {
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        });
        if (!existingUser) {
          redirect('/api/auth/signout?callbackUrl=/m/login');
        }
      } catch (error) {
        if (!isNextRedirectError(error)) {
          logger.error('[Mobile Login] Failed to verify session user', {
            component: 'mobile-login-page',
            error,
          });
        }
      }
    }
    const awaitedSearchParams = await searchParams;
    let callbackUrl =
      typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : '/m';

    // Fix: Prevent redirect loop if callbackUrl is the login page itself
    if (callbackUrl.includes('/login') || callbackUrl === '/') {
      callbackUrl = '/m';
    }

    // Redirect to mobile callback or mobile dashboard
    const redirectUrl = callbackUrl.startsWith('/m') ? callbackUrl : '/m';
    redirect(redirectUrl);
  }

  const awaitedSearchParams = await searchParams;
  const callbackUrl =
    typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : '/m';
  const errorCode =
    typeof awaitedSearchParams?.error === 'string' ? awaitedSearchParams.error : null;
  const passwordSet = awaitedSearchParams?.password === '1';

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <MobileLoginClient
        callbackUrl={callbackUrl}
        errorCode={errorCode}
        passwordSet={passwordSet}
        ssoError={ssoError}
        ssoEnabled={ssoEnabled}
        ssoProviderType={ssoConfig?.providerType}
        ssoProviderLabel={ssoConfig?.providerLabel}
      />
    </ThemeProvider>
  );
}
