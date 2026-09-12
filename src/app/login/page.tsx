import LoginClient from './LoginClient';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getOidcRuntimeCapability } from '@/lib/oidc-validation';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { redirect } from 'next/navigation';
import { getLocalAuthPolicy } from '@/lib/local-auth-policy';
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
  const ssoCapability = await getOidcRuntimeCapability();
  const ssoEnabled = ssoCapability.runtimeReady;
  const ssoError = ssoCapability.error;

  const awaitedSearchParams = await searchParams;
  const rawCallbackUrl =
    typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : null;
  // One callback policy for middleware, server-rendered login, credentials login,
  // and SSO initiation. This rejects protocol-relative URLs, backslash tricks,
  // auth loops, control characters, and external origins before the value ever
  // reaches a client-side navigation API.
  const callbackUrl = safeInternalCallbackUrl(rawCallbackUrl, '/');

  // Server-side check: If user is already authenticated with a valid user, redirect them away.
  // Invalidated or cleared sessions (e.g. tokenVersion mismatch or timeout) do not redirect,
  // preventing infinite redirect loops between protected pages and login.
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
    <LoginClient
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
  );
}
