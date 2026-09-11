import type { NextAuthOptions, User } from 'next-auth';
import OIDCProvider from '@/lib/oidc';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getOidcConfig } from '@/lib/oidc-config';
import { requiresOidcEmailVerifiedClaim } from '@/lib/oidc-provider';
import { resolveOidcIdentityForSignIn } from '@/lib/oidc-identity-resolution';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  SESSION_TOKEN_COOKIE_NAME,
  CALLBACK_URL_COOKIE_NAME,
  CSRF_TOKEN_COOKIE_NAME,
  PKCE_CODE_VERIFIER_COOKIE_NAME,
  STATE_COOKIE_NAME,
  NONCE_COOKIE_NAME,
  useSecureCookies,
} from '@/lib/auth-cookies';
import type { JWT } from 'next-auth/jwt';
import {
  getEnterpriseSessionPolicy,
  getLocalAuthPolicy,
  isLocalCredentialAllowed,
} from '@/lib/local-auth-policy';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';

function getJwtUserRefreshTtlMs() {
  const raw = process.env.JWT_USER_REFRESH_TTL_MS ?? '60000';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60000;
}

// Augmented types to avoid 'any' usage
type AugmentedJWT = JWT & {
  tokenVersion?: number;
  userFetchedAt?: number;
  error?: string;
  avatarUrl?: string | null;
  gender?: string | null;
  role?: string;
  /** True when user opted into "Remember Me" at login. Used to pick the JWT exp cap. */
  rememberMe?: boolean;
  /** Last authenticated request seen for an OIDC session, in epoch milliseconds. */
  lastActivityAt?: number;
  /** Time the IdP last authenticated this OIDC session, in epoch milliseconds. */
  oidcAuthenticatedAt?: number;
  /** Trust-version of the provider configuration that issued this session. */
  oidcConfigVersion?: number;
};

type AugmentedUser = User & {
  tokenVersion?: number;
  role?: string;
  rememberMe?: boolean;
};

type OidcProfileClaims = Record<string, unknown>;

function profileClaims(profile: unknown): OidcProfileClaims {
  return profile && typeof profile === 'object' ? (profile as OidcProfileClaims) : {};
}

function stringClaim(claims: OidcProfileClaims, key: string): string | null {
  // Own-property lookup prevents prototype traversal for attacker-controlled claim names.
  const value = Object.getOwnPropertyDescriptor(claims, key)?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isOidcEmailVerifiedStrict() {
  return (process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT ?? 'true').toLowerCase() === 'true';
}

const AUTH_OPTIONS_CACHE_TTL_MS = Number.parseInt(
  process.env.AUTH_OPTIONS_CACHE_TTL_MS ?? '5000',
  10
);

function safeTtlMs(value: number, fallback: number) {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

const AUTH_TTL_MS = safeTtlMs(AUTH_OPTIONS_CACHE_TTL_MS, 5000);

function normalizeIssuer(issuer: string) {
  return issuer.replace(/\/$/, '');
}

function coerceBooleanClaim(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function clearSessionToken(token: AugmentedJWT, reason: string) {
  token.error = reason;
  delete token.sub;
  delete token.role;
  delete token.email;
  delete token.name;
  delete token.lastActivityAt;
  delete token.oidcAuthenticatedAt;
  delete token.oidcConfigVersion;
  return token;
}

let authOptionsCache:
  | {
      value: NextAuthOptions;
      expiresAt: number;
    }
  | undefined;
let authOptionsInFlight: Promise<NextAuthOptions> | undefined;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const now = Date.now();
  // Module-level cache to avoid repeatedly constructing options (and reloading OIDC config)
  // across multiple server component renders / API calls within a short window.
  if (authOptionsCache && authOptionsCache.expiresAt > now) {
    return authOptionsCache.value;
  }

  if (authOptionsInFlight) {
    return authOptionsInFlight;
  }

  authOptionsInFlight = (async () => {
    const oidcConfig = await getOidcConfig();
    // Enterprise OIDC sessions have independent absolute, idle, reauthentication,
    // and server-side revocation boundaries. Credentials retain remember-me
    // behavior, while OIDC never extends the original IdP authentication time.
    const enterpriseSession = getEnterpriseSessionPolicy();
    const sessionMaxAgeSeconds = enterpriseSession.maximumAgeSeconds;
    const rememberMeMaxAgeSeconds = enterpriseSession.maximumAgeSeconds;
    const sessionUpdateAgeSeconds = enterpriseSession.updateAgeSeconds;
    const sessionIdleTimeoutMs = enterpriseSession.idleTimeoutSeconds * 1000;
    const oidcReauthenticateAfterMs = enterpriseSession.reauthenticateAfterSeconds * 1000;
    const localAuthPolicy = getLocalAuthPolicy();

    if (oidcConfig) {
      logger.info('[Auth] OIDC provider will be enabled', {
        component: 'auth',
        issuer: oidcConfig.issuer,
        clientId: oidcConfig.clientId,
      });
    } else {
      logger.debug('[Auth] OIDC provider not available, using credentials only', {
        component: 'auth',
      });
    }

    return {
      session: {
        strategy: 'jwt',
        maxAge: rememberMeMaxAgeSeconds,
        updateAge: sessionUpdateAgeSeconds,
      },
      jwt: { maxAge: rememberMeMaxAgeSeconds },
      useSecureCookies,
      cookies: {
        sessionToken: {
          name: SESSION_TOKEN_COOKIE_NAME,
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: useSecureCookies,
          },
        },
        callbackUrl: {
          name: CALLBACK_URL_COOKIE_NAME,
          options: {
            sameSite: 'lax',
            path: '/',
            secure: useSecureCookies,
          },
        },
        csrfToken: {
          name: CSRF_TOKEN_COOKIE_NAME,
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: useSecureCookies,
          },
        },
        pkceCodeVerifier: {
          name: PKCE_CODE_VERIFIER_COOKIE_NAME,
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: useSecureCookies,
            maxAge: 900,
          },
        },
        state: {
          name: STATE_COOKIE_NAME,
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: useSecureCookies,
            maxAge: 900,
          },
        },
        nonce: {
          name: NONCE_COOKIE_NAME,
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: useSecureCookies,
            maxAge: 900,
          },
        },
      },
      // Host headers affect OAuth callback construction. Trust them only when an
      // operator explicitly opts in for a correctly configured reverse proxy.
      trustHost: process.env.AUTH_TRUST_HOST?.toLowerCase() === 'true',
      providers: [
        ...(oidcConfig
          ? [
              OIDCProvider({
                clientId: oidcConfig.clientId,
                clientSecret: oidcConfig.clientSecret,
                issuer: oidcConfig.issuer,
                customScopes: oidcConfig.customScopes ?? null,
              }),
            ]
          : []),
        ...(localAuthPolicy.enabled
          ? [
              CredentialsProvider({
                name: 'Email & Password',
                credentials: {
                  email: { label: 'Email', type: 'email' },
                  password: { label: 'Password', type: 'password' },
                  rememberMe: { label: 'Remember Me', type: 'text' },
                },
                async authorize(credentials, req) {
                  const {
                    checkLoginAttempt,
                    recordFailedAttempt,
                    resetLoginAttempts,
                    isValidEmail,
                  } = await import('@/lib/login-security');
                  const { logLoginSuccess, logLoginFailed, logLoginBlocked } =
                    await import('@/lib/login-audit');

                  const email = credentials?.email?.toLowerCase().trim() || '';
                  const password = credentials?.password || '';
                  const userAgentHeader = (req?.headers?.['user-agent'] as string) || '';
                  const isMobileClient =
                    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(
                      userAgentHeader
                    );
                  const rememberMe = credentials?.rememberMe === 'true' || isMobileClient;
                  const { getClientIp } = await import('@/lib/client-ip');
                  const ip = getClientIp(req?.headers);
                  const userAgent = userAgentHeader || 'Unknown';

                  if (!isLocalCredentialAllowed(email)) {
                    await logLoginBlocked(email || 'unknown', ip, userAgent, 'LOCAL_AUTH_DISABLED');
                    return null;
                  }

                  logger.debug('[Auth-Debug] Authorize started', {
                    component: 'auth:credentials',
                    email,
                    ip,
                  });

                  if (!email || !isValidEmail(email)) {
                    await logLoginFailed(email || 'unknown', ip, userAgent, 'INVALID_EMAIL_FORMAT');
                    return null;
                  }

                  if (!password) {
                    await logLoginFailed(email, ip, userAgent, 'INVALID_CREDENTIALS');
                    return null;
                  }

                  const { checkRateLimit } = await import('@/lib/rate-limit');
                  const distributedAttempt = await checkRateLimit(
                    `auth:credentials:${email}:${ip}`,
                    20,
                    15 * 60 * 1000
                  );
                  const accountAttempt = await checkRateLimit(
                    `auth:credentials:account:${email}`,
                    10,
                    15 * 60 * 1000
                  );
                  if (!distributedAttempt.allowed || !accountAttempt.allowed) {
                    await logLoginBlocked(
                      email,
                      ip,
                      userAgent,
                      'RATE_LIMITED',
                      Math.max(
                        0,
                        Math.max(distributedAttempt.resetAt, accountAttempt.resetAt) - Date.now()
                      )
                    );
                    return null;
                  }

                  const attemptCheck = checkLoginAttempt(email, ip);
                  if (!attemptCheck.allowed) {
                    await logLoginBlocked(
                      email,
                      ip,
                      userAgent,
                      'ACCOUNT_LOCKED',
                      attemptCheck.lockoutDurationMs || undefined
                    );
                    console.warn('[Auth] Login blocked - account locked', {
                      email,
                      ip,
                      lockedUntil: attemptCheck.lockedUntil?.toISOString(),
                    });
                    return null;
                  }

                  const user = await prisma.user.findUnique({ where: { email } });
                  if (!user || !user.passwordHash) {
                    recordFailedAttempt(email, ip);
                    await logLoginFailed(email, ip, userAgent, 'USER_NOT_FOUND');
                    logger.debug('[Auth-Debug] User not found or no password hash', {
                      component: 'auth:credentials',
                      email,
                    });
                    return null;
                  }

                  if (user.status === 'DISABLED') {
                    await logLoginFailed(email, ip, userAgent, 'USER_DISABLED');
                    return null;
                  }

                  const isValid = await bcrypt.compare(password, user.passwordHash);
                  if (!isValid) {
                    const result = recordFailedAttempt(email, ip);
                    await logLoginFailed(
                      email,
                      ip,
                      userAgent,
                      'INVALID_CREDENTIALS',
                      result.attemptCount
                    );

                    if (result.locked) {
                      console.warn('[Auth] Account locked after failed attempts', {
                        email,
                        attemptCount: result.attemptCount,
                        lockoutDurationMs: result.lockoutDurationMs,
                      });
                    }
                    logger.debug('[Auth-Debug] Invalid Password', {
                      component: 'auth:credentials',
                      email,
                    });
                    return null;
                  }

                  resetLoginAttempts(email, ip);
                  await logLoginSuccess(email, user.id, ip, userAgent, 'credentials');

                  if (rememberMe) {
                    logger.debug('[Auth] User requested "Remember Me"', { email });
                  }

                  if (user.status !== 'ACTIVE') {
                    await prisma.user.update({
                      where: { email: user.email },
                      data: {
                        status: 'ACTIVE',
                        invitedAt: null,
                        deactivatedAt: null,
                      },
                    });
                  }

                  logger.debug('[Auth-Debug] Authorize Success', {
                    component: 'auth:credentials',
                    id: user.id,
                    tokenVersion: user.tokenVersion,
                  });

                  return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    tokenVersion: user.tokenVersion,
                    rememberMe,
                  } as User & { rememberMe: boolean };
                },
              }),
            ]
          : []),
      ],
      pages: {
        signIn: '/login',
        signOut: '/auth/signout',
      },
      callbacks: {
        async jwt({ token, user, account, trigger, session: _session }) {
          logger.debug('[Auth-Debug] JWT callback started', {
            component: 'auth:jwt',
            hasSub: !!token.sub,
            sub: token.sub,
            trigger: trigger || 'none',
          });

          if (user && account) {
            delete (token as AugmentedJWT).error;
            logger.debug('[Auth-Debug] Initial Sign In', {
              component: 'auth:jwt',
              userId: user.id,
              provider: account.provider,
            });

            if (account.provider === 'oidc') {
              try {
                const activeConfig = await getOidcConfig();
                if (!activeConfig) {
                  return clearSessionToken(token as AugmentedJWT, 'OIDC_CONFIGURATION_UNAVAILABLE');
                }
                const issuer = activeConfig?.issuer ? normalizeIssuer(activeConfig.issuer) : null;
                const subject = account.providerAccountId || null;
                const identity =
                  issuer && subject
                    ? await prisma.oidcIdentity.findUnique({
                        where: { issuer_subject: { issuer, subject } },
                        select: { userId: true },
                      })
                    : null;

                const dbUser = identity
                  ? await prisma.user.findUnique({ where: { id: identity.userId } })
                  : null;

                if (!dbUser || dbUser.status === 'DISABLED') {
                  logger.error('[Auth] JWT callback - stable OIDC identity not resolvable', {
                    component: 'auth:jwt',
                    issuer,
                    hasSubject: Boolean(subject),
                    linkedUserId: identity?.userId ?? null,
                  });
                  return clearSessionToken(token as AugmentedJWT, 'OIDC_IDENTITY_NOT_RESOLVABLE');
                }

                token.sub = dbUser.id;
                token.role = dbUser.role;
                token.name = dbUser.name;
                token.email = dbUser.email;
                (token as AugmentedJWT).tokenVersion = dbUser.tokenVersion ?? 0;
                (token as AugmentedJWT).lastActivityAt = Date.now();
                (token as AugmentedJWT).oidcAuthenticatedAt = Date.now();
                (token as AugmentedJWT).oidcConfigVersion = activeConfig.configVersion;
              } catch (error) {
                logger.error('[Auth] JWT callback - OIDC identity lookup failed', {
                  component: 'auth:jwt',
                  error,
                });
                return clearSessionToken(token as AugmentedJWT, 'OIDC_IDENTITY_LOOKUP_FAILED');
              }
            } else {
              delete (token as AugmentedJWT).error;
              token.role = (user as AugmentedUser).role;
              token.sub = user.id;
              token.name = user.name;
              token.email = user.email;
              (token as AugmentedJWT).tokenVersion = (user as AugmentedUser).tokenVersion ?? 0;
              (token as AugmentedJWT).rememberMe = (user as AugmentedUser).rememberMe === true;
            }

            const remember = (token as AugmentedJWT).rememberMe === true;
            const ttlSeconds = remember ? rememberMeMaxAgeSeconds : sessionMaxAgeSeconds;
            token.exp = Math.floor(Date.now() / 1000) + ttlSeconds;
          } else if (user) {
            delete (token as AugmentedJWT).error;
            logger.debug('[Auth-Debug] Initial Sign In (Fallback)', {
              component: 'auth:jwt',
              userId: user.id || (user as AugmentedUser).id,
            });
            token.role = (user as AugmentedUser).role;
            token.sub = user.id ?? (user as AugmentedUser).id ?? token.sub;
            token.name = user.name;
            token.email = user.email;
            (token as AugmentedJWT).tokenVersion = (user as AugmentedUser).tokenVersion ?? 0;
          }

          if (trigger === 'update') {
            // Force the user refresh below by bypassing the cache check.
          }

          const augmentedToken = token as AugmentedJWT;
          if (!user && augmentedToken.oidcAuthenticatedAt) {
            const currentTime = Date.now();
            const currentConfig = await getOidcConfig();
            if (
              !currentConfig ||
              augmentedToken.oidcConfigVersion !== currentConfig.configVersion
            ) {
              return clearSessionToken(augmentedToken, 'OIDC_CONFIGURATION_CHANGED');
            }
            if (currentTime - augmentedToken.oidcAuthenticatedAt >= oidcReauthenticateAfterMs) {
              return clearSessionToken(augmentedToken, 'OIDC_REAUTHENTICATION_REQUIRED');
            }
            if (
              augmentedToken.lastActivityAt &&
              currentTime - augmentedToken.lastActivityAt >= sessionIdleTimeoutMs
            ) {
              return clearSessionToken(augmentedToken, 'OIDC_SESSION_IDLE_TIMEOUT');
            }
            augmentedToken.lastActivityAt = currentTime;
          }

          if (token.sub && typeof token.sub === 'string') {
            const currentTokenVersion = (token as AugmentedJWT).tokenVersion;
            const lastFetchedAt = (token as AugmentedJWT).userFetchedAt;
            const ttlMs = getJwtUserRefreshTtlMs();

            if (trigger !== 'update' && lastFetchedAt && Date.now() - lastFetchedAt < ttlMs) {
              // Cached.
            } else {
              try {
                const dbUser = await prisma.user.findUnique({
                  where: { id: token.sub },
                  select: {
                    name: true,
                    email: true,
                    role: true,
                    tokenVersion: true,
                    status: true,
                    avatarUrl: true,
                    gender: true,
                  },
                });

                if (dbUser) {
                  const dbTokenVersion =
                    typeof dbUser.tokenVersion === 'number' ? dbUser.tokenVersion : 0;
                  logger.debug('[Auth-Debug] User Check', {
                    component: 'auth:jwt',
                    dbId: token.sub,
                    dbVer: dbTokenVersion,
                    tokenVer: currentTokenVersion,
                  });

                  if (dbUser.status === 'DISABLED') {
                    return clearSessionToken(token as AugmentedJWT, 'USER_DISABLED');
                  }

                  if (
                    typeof currentTokenVersion === 'number' &&
                    dbTokenVersion !== currentTokenVersion
                  ) {
                    logger.warn('[Auth-Debug] REVOKING SESSION: Version Mismatch', {
                      component: 'auth:jwt',
                      db: dbTokenVersion,
                      token: currentTokenVersion,
                    });
                    return clearSessionToken(token as AugmentedJWT, 'SESSION_REVOKED');
                  }

                  token.name = dbUser.name;
                  token.email = dbUser.email;
                  token.role = dbUser.role;
                  token.avatarUrl = dbUser.avatarUrl;
                  token.gender = dbUser.gender;
                  (token as AugmentedJWT).tokenVersion = dbTokenVersion;
                } else {
                  logger.debug('[Auth-Debug] User NOT FOUND in DB', {
                    component: 'auth:jwt',
                    id: token.sub,
                  });
                }
              } catch (error) {
                console.error('[Auth-Debug] DB Fetch Error', error);
              }
              (token as AugmentedJWT).userFetchedAt = Date.now();
            }
          } else {
            logger.debug('[Auth-Debug] No token.sub found!', { component: 'auth:jwt', token });
          }

          return token;
        },
        async session({ session, token }) {
          logger.debug('[Auth-Debug] Session callback', {
            component: 'auth:session',
            hasToken: !!token,
            sub: token?.sub,
            error: (token as AugmentedJWT)?.error,
          });

          if ((token as AugmentedJWT)?.error || !token.sub) {
            (session as unknown as { user: unknown }).user = undefined;
            logger.warn('[Auth-Debug] Session CLEARED due to error/missing sub', {
              component: 'auth:session',
            });
            return session;
          }

          if (session.user) {
            (session.user as AugmentedUser).role = token.role;
            (session.user as AugmentedUser).id = token.sub;
            (session.user as AugmentedUser).tokenVersion =
              (token as AugmentedJWT).tokenVersion ?? 0;
            session.user.name = (token.name as string) || session.user.name;
            session.user.email = (token.email as string) || session.user.email;
            session.user.avatarUrl = token.avatarUrl;
            session.user.gender = token.gender;
            session.user.image = token.avatarUrl || getDefaultAvatar(token.gender, token.sub);
          }

          return session;
        },
        async signIn({ user, account, profile }) {
          if (account?.provider !== 'oidc') {
            if (!user?.email) {
              logger.warn('[Auth] Sign-in rejected: missing email', {
                component: 'auth:signIn',
                provider: account?.provider ?? 'unknown',
              });
              return false;
            }
            return true;
          }

          const activeConfig = await getOidcConfig();
          if (!activeConfig) {
            logger.warn('[Auth] OIDC sign-in rejected: configuration missing or invalid', {
              component: 'auth:signIn',
            });
            return false;
          }

          const claims = profileClaims(profile);
          const email =
            typeof user.email === 'string' && user.email.trim()
              ? user.email.trim().toLowerCase()
              : null;
          const emailVerifiedClaim = coerceBooleanClaim(claims.email_verified);

          // An explicit negative verification assertion is always a hard fail.
          // Missing claims are handled by provider policy only when creating a
          // new binding; established issuer+subject identities remain usable.
          if (emailVerifiedClaim === false) {
            logger.warn('[Auth] OIDC sign-in rejected: IdP explicitly reports unverified email', {
              component: 'auth:signIn',
              providerType: activeConfig.providerType,
            });
            return false;
          }

          const issuer = normalizeIssuer(activeConfig.issuer);
          const subject = account.providerAccountId || stringClaim(claims, 'sub');
          if (!subject) {
            logger.warn('[Auth] OIDC sign-in rejected: stable subject claim missing', {
              component: 'auth:signIn',
              issuer,
            });
            return false;
          }

          const roleEvaluation = evaluateOidcRoleClaims(claims, activeConfig.roleMapping ?? []);
          if (!roleEvaluation.ok) {
            logger.warn('[Auth] OIDC role claims rejected', {
              component: 'auth:signIn',
              reasonCode: roleEvaluation.reason,
              providerType: activeConfig.providerType,
            });
            return false;
          }

          let resolution;
          try {
            resolution = await resolveOidcIdentityForSignIn({
              issuer,
              subject,
              email,
              displayName: user.name ?? null,
              providerType: activeConfig.providerType,
              emailVerifiedClaim,
              requireEmailVerifiedClaim: requiresOidcEmailVerifiedClaim(
                activeConfig.providerType,
                isOidcEmailVerifiedStrict()
              ),
              autoProvision: activeConfig.autoProvision,
              allowedDomains: activeConfig.allowedDomains,
              claims,
              providerConfigId: 'default',
              clientId: activeConfig.clientId,
              configVersion: activeConfig.configVersion,
              organizationId: activeConfig.organizationId,
            });
          } catch (error) {
            logger.error('[Auth] OIDC identity transaction failed', {
              component: 'auth:signIn',
              issuer,
              subject,
              error,
            });
            return false;
          }

          if (!resolution.ok) {
            logger.warn('[Auth] OIDC sign-in rejected by identity policy', {
              component: 'auth:signIn',
              issuer,
              subject,
              reasonCode: resolution.reason,
              providerType: activeConfig.providerType,
            });
            return false;
          }

          const targetUser = resolution.user;
          user.id = targetUser.id;
          user.email = targetUser.email;
          user.name = targetUser.name ?? user.name;

          if (resolution.userCreated) {
            logger.info('[Auth] OIDC user provisioned atomically with identity', {
              component: 'auth:signIn',
              issuer,
              subject,
              userId: targetUser.id,
              event: 'OIDC_USER_PROVISIONED',
            });
          } else if (resolution.identityCreated) {
            logger.info('[Auth] OIDC identity linked to existing user', {
              component: 'auth:signIn',
              issuer,
              subject,
              userId: targetUser.id,
              approvalConsumed: resolution.approvalConsumed,
              event: 'OIDC_IDENTITY_LINKED',
            });
          }

          const updateData: Record<string, unknown> = {};

          if (targetUser.status === 'INVITED') {
            updateData.status = 'ACTIVE';
            updateData.invitedAt = null;
            updateData.deactivatedAt = null;
            logger.info('[Auth] Activating invited user via OIDC', {
              component: 'auth:signIn',
              userId: targetUser.id,
              previousStatus: targetUser.status,
            });
          }

          if (
            activeConfig.roleMapping &&
            Array.isArray(activeConfig.roleMapping) &&
            activeConfig.roleMapping.length > 0
          ) {
            const desiredRole = roleEvaluation.role;
            if (targetUser.roleSource === 'OIDC' && targetUser.role !== desiredRole) {
              updateData.role = desiredRole;
              logger.info('[Auth] OIDC role changed from mapping evaluation', {
                component: 'auth:signIn',
                userId: targetUser.id,
                previousRole: targetUser.role,
                newRole: desiredRole,
                event: 'OIDC_ROLE_CHANGED',
              });
            }
          }

          if (activeConfig.profileMapping) {
            const mapping = activeConfig.profileMapping;

            if (mapping.department && typeof claims[mapping.department] === 'string') {
              const department = (claims[mapping.department] as string).trim().slice(0, 128);
              if (department && department !== targetUser.department) {
                updateData.department = department;
              }
            }

            if (mapping.jobTitle && typeof claims[mapping.jobTitle] === 'string') {
              const jobTitle = (claims[mapping.jobTitle] as string).trim().slice(0, 256);
              if (jobTitle && jobTitle !== targetUser.jobTitle) {
                updateData.jobTitle = jobTitle;
              }
            }

            if (mapping.avatarUrl && typeof claims[mapping.avatarUrl] === 'string') {
              const avatar = claims[mapping.avatarUrl] as string;
              let safeAvatar: string | null = null;
              try {
                const parsedAvatar = new URL(avatar);
                if (parsedAvatar.protocol === 'https:' && avatar.length <= 2048) {
                  safeAvatar = parsedAvatar.toString();
                }
              } catch {
                safeAvatar = null;
              }
              const isLocalUpload =
                targetUser.avatarUrl?.startsWith('/api/users/') ||
                targetUser.avatarUrl?.startsWith('/uploads/');

              if (safeAvatar && safeAvatar !== targetUser.avatarUrl && !isLocalUpload) {
                updateData.avatarUrl = safeAvatar;
              }
            }

            if (updateData.department || updateData.jobTitle || updateData.avatarUrl) {
              updateData.lastOidcSync = new Date();
            }
          }

          if (updateData.role && updateData.role !== targetUser.role) {
            updateData.tokenVersion = { increment: 1 };
          }

          if (Object.keys(updateData).length > 0) {
            if (updateData.role && updateData.role !== targetUser.role) {
              const { updateUserSecurityState } = await import('@/lib/users/admin-invariants');
              const mappedRole = updateData.role as 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
              delete updateData.role;
              await updateUserSecurityState(targetUser.id, { role: mappedRole }, updateData);
            } else {
              await prisma.user.update({
                where: { id: targetUser.id },
                data: updateData,
              });
            }
            logger.info('[Auth] Updated user from OIDC data', {
              component: 'auth:signIn',
              userId: targetUser.id,
              updatedFields: Object.keys(updateData),
            });
          }

          logger.info('[Auth] OIDC sign-in successful', {
            component: 'auth:signIn',
            issuer,
            subject,
            userId: targetUser.id,
            event: 'OIDC_LOGIN_SUCCESS',
          });

          try {
            const { logLoginSuccess } = await import('@/lib/login-audit');
            const { headers } = await import('next/headers');
            const h = await headers();
            const ua = h.get('user-agent') || 'Unknown';
            const ip =
              h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'Unknown';
            await logLoginSuccess(targetUser.email, targetUser.id, ip, ua, 'oidc');
          } catch {
            // Non-critical audit logging failure.
          }

          return true;
        },
      },
    };
  })();
  try {
    const value = await authOptionsInFlight;
    authOptionsCache = {
      value,
      expiresAt: Date.now() + AUTH_TTL_MS,
    };
    return value;
  } finally {
    authOptionsInFlight = undefined;
  }
}

export async function revokeUserSessions(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

/** Internal helper to reset the auth options cache. Intended for tests only. */
export function resetAuthOptionsCache() {
  authOptionsCache = undefined;
  authOptionsInFlight = undefined;
}
