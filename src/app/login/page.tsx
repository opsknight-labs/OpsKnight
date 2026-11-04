import LoginClient from './LoginClient';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getOidcRuntimeCapability } from '@/lib/oidc-validation';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { forcedSignOutUrl } from '@/lib/app-routes';
import { redirect } from 'next/navigation';
import { getDatabaseLocalAuthPolicy } from '@/lib/authentication-policy';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { SIGN_IN_REFERENCE_PATTERN } from '@/lib/auth-control/messages';

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
  sessionRevoked?: string;
  reason?: string;
  ref?: string;
  notified?: string;
};

export default async function LoginPage({
  searchParams,
  defaultCallbackUrl = '/',
}: {
  searchParams?: Promise<SearchParams>;
  defaultCallbackUrl?: string;
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
  const localAuthPolicy = await getDatabaseLocalAuthPolicy();
  const ssoEnabled = ssoCapability.runtimeReady && localAuthPolicy.oidcLoginEnabled;
  // Provider validation detail is for administrators (logged and shown in the console);
  // people signing in only need to know single sign-on is unavailable.
  if (localAuthPolicy.oidcLoginEnabled && ssoCapability.error) {
    logger.warn('[Login Page] SSO unavailable', {
      component: 'login-page',
      detail: ssoCapability.error,
    });
  }
  const ssoError =
    localAuthPolicy.oidcLoginEnabled && ssoCapability.error ? 'SSO_NOT_AVAILABLE' : null;

  const awaitedSearchParams = await searchParams;
  const rawCallbackUrl =
    typeof awaitedSearchParams?.callbackUrl === 'string' ? awaitedSearchParams.callbackUrl : null;
  // One callback policy for middleware, server-rendered login, credentials login,
  // and SSO initiation. This rejects protocol-relative URLs, backslash tricks,
  // auth loops, control characters, and external origins before the value ever
  // reaches a client-side navigation API.
  const fallback = defaultCallbackUrl || '/';
  const callbackUrl = safeInternalCallbackUrl(rawCallbackUrl, fallback);

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
        redirect(forcedSignOutUrl(defaultCallbackUrl.startsWith('/m') ? 'mobile' : 'desktop'));
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
  const endedReason =
    typeof awaitedSearchParams?.reason === 'string' ? awaitedSearchParams.reason : null;
  const reference =
    typeof awaitedSearchParams?.ref === 'string' &&
    SIGN_IN_REFERENCE_PATTERN.test(awaitedSearchParams.ref)
      ? awaitedSearchParams.ref
      : null;

  const credentialEntryEnabled = localAuthPolicy.enabled;
  const breakGlassOnly =
    !localAuthPolicy.localLoginEnabled &&
    localAuthPolicy.breakGlassEnabled &&
    Boolean(localAuthPolicy.breakGlassEmail);

  return (
    <LoginClient
      callbackUrl={callbackUrl}
      defaultCallbackUrl={fallback}
      errorCode={errorCode}
      errorReference={reference}
      administratorsNotified={awaitedSearchParams?.notified === '1'}
      endedReason={endedReason}
      passwordSet={passwordSet}
      sessionRevoked={awaitedSearchParams?.sessionRevoked === '1'}
      ssoError={ssoError}
      ssoEnabled={ssoEnabled}
      ssoProviderType={ssoCapability.providerType}
      ssoProviderLabel={ssoCapability.providerLabel}
      localAuthEnabled={credentialEntryEnabled}
      breakGlassOnly={breakGlassOnly}
    />
  );
}
