import LoginClient from './LoginClient';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getOidcConfig, getOidcPublicConfig } from '@/lib/oidc-config';
import { redirect } from 'next/navigation';

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

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  // Bootstrap check: If no users exist, redirect to setup
  let userCount = 0;
  try {
    userCount = await prisma.user.count();
  } catch (error) {
    // If DB is not ready, we might want to let the login page load or show error
    // But for now, let's just log it and proceed to login
    if (!isNextRedirectError(error)) {
      logger.error('Failed to check user count', { component: 'login-page', error });
    }
  }

  // Redirect outside try-catch so Next.js redirect error can bubble up
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

  // Server-side check: If user is already authenticated, redirect them away
  const awaitedSearchParams = await searchParams;
  if (session) {
    if (session?.user?.email) {
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        });
        if (!existingUser) {
          redirect('/api/auth/signout?callbackUrl=/login');
        }
      } catch (error) {
        if (!isNextRedirectError(error)) {
          logger.error('[Login Page] Failed to verify session user', {
            component: 'login-page',
            error,
          });
        }
      }
    }
    const callbackUrl =
      typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : '/';
    // Only redirect to callbackUrl if it's a valid internal path (not login or signout)
    const isValidCallback =
      callbackUrl.startsWith('/') &&
      !callbackUrl.startsWith('/login') &&
      !callbackUrl.includes('/signout') &&
      !callbackUrl.includes('/auth/signout');
    const redirectUrl = isValidCallback ? callbackUrl : '/'; // Default to dashboard
    redirect(redirectUrl);
  }

  const callbackUrl =
    typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : '/';
  const errorCode =
    typeof awaitedSearchParams?.error === 'string' ? awaitedSearchParams.error : null;
  const passwordSet = awaitedSearchParams?.password === '1';

  return (
    <LoginClient
      callbackUrl={callbackUrl}
      errorCode={errorCode}
      passwordSet={passwordSet}
      ssoError={ssoError}
      ssoEnabled={ssoEnabled}
      ssoProviderType={ssoConfig?.providerType}
      ssoProviderLabel={ssoConfig?.providerLabel}
    />
  );
}
