import MobileLoginClient from './MobileLoginClient';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getOidcRuntimeCapability } from '@/lib/oidc-validation';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { getLocalAuthPolicy } from '@/lib/local-auth-policy';

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
  const ssoCapability = await getOidcRuntimeCapability();
  const ssoEnabled = ssoCapability.runtimeReady;
  const ssoError = ssoCapability.error;

  const awaitedSearchParams = await searchParams;
  const rawCallbackUrl =
    typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : null;
  const callbackUrl = safeInternalCallbackUrl(rawCallbackUrl, '/m');

  // If already authenticated with a valid user, redirect to mobile dashboard.
  // Invalidated or cleared sessions do not redirect, preventing redirect loops.
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

    // Redirect to mobile callback or mobile dashboard
    redirect(callbackUrl);
  }

  const errorCode =
    typeof awaitedSearchParams?.error === 'string' ? awaitedSearchParams.error : null;
  const passwordSet = awaitedSearchParams?.password === '1';

  const localAuthPolicy = getLocalAuthPolicy();
  const credentialEntryEnabled = localAuthPolicy.enabled;
  const breakGlassOnly =
    !localAuthPolicy.localLoginEnabled &&
    localAuthPolicy.breakGlassEnabled &&
    Boolean(localAuthPolicy.breakGlassEmail);

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <MobileLoginClient
        callbackUrl={callbackUrl}
        errorCode={errorCode}
        passwordSet={passwordSet}
        ssoError={ssoError}
        ssoEnabled={ssoEnabled}
        ssoProviderType={ssoCapability.providerType}
        ssoProviderLabel={ssoCapability.providerLabel}
        localAuthEnabled={credentialEntryEnabled}
        breakGlassOnly={breakGlassOnly}
      />
    </ThemeProvider>
  );
}
