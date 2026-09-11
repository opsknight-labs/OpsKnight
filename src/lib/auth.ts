import type { NextAuthOptions, User } from 'next-auth';
import OIDCProvider from '@/lib/oidc';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { logger } from '@/lib/logger';
import { getOidcConfig } from '@/lib/oidc-config';
import {
  hasOidcEmailLinkAssurance,
  requiresOidcEmailVerifiedClaim,
} from '@/lib/oidc-provider';
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

/**
 * Security-sensitive user state (status, role and tokenVersion) is intentionally
 * refreshed on every server-side session evaluation. Credential resets and
 * administrative revocations must not inherit a stale one-minute cache window.
 */
function getJwtUserRefreshTtlMs() {
  return 0;
}

import type { JWT } from 'next-auth/jwt';

type AugmentedJWT = JWT & {
  tokenVersion?: number;
  userFetchedAt?: number;
  error?: string;
  avatarUrl?: string | null;
  gender?: string | null;
  role?: string;
  /** True when user opted into "Remember Me" at login. Used to pick the JWT exp cap. */
  rememberMe?: boolean;
};

type AugmentedUser = User & {
  tokenVersion?: number;
  role?: string;
  rememberMe?: boolean;
};

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
  if (authOptionsCache && authOptionsCache.expiresAt > now) {
    return authOptionsCache.value;
  }

  if (authOptionsInFlight) {
    return authOptionsInFlight;
  }

  authOptionsInFlight = (async () => {
    const oidcConfig = await getOidcConfig();
    const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
    const rememberMeMaxAgeSeconds = 60 * 60 * 24 * 365;
    const sessionUpdateAgeSeconds = 60 * 60;

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
        CredentialsProvider({
          name: 'Email & Password',
          credentials: {
            email: { label: 'Email', type: 'email' },
            password: { label: 'Password', type: 'password' },
            rememberMe: { label: 'Remember Me', type: 'text' },
          },
          async authorize(credentials, req) {
            const { checkLoginAttempt, recordFailedAttempt, resetLoginAttempts, isValidEmail } =
              await import('@/lib/login-security');
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

            logger.warn('[Auth-Debug] Authorize started', {
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
              logger.warn('[Auth-Debug] User not found or no password hash', {
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
              logger.warn('[Auth-Debug] Invalid Password', {
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

            logger.warn('[Auth-Debug] Authorize Success', {
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
      ],
      pages: {
        signIn: '/login',
        signOut: '/auth/signout',
      },
      callbacks: {
        async jwt({ token, user, account, trigger, session: _session }) {
          logger.warn('[Auth-Debug] JWT callback started', {
            component: 'auth:jwt',
            hasSub: !!token.sub,
            sub: token.sub,
            trigger: trigger || 'none',
          });

          if (user && account) {
            delete (token as AugmentedJWT).error;
            logger.warn('[Auth-Debug] Initial Sign In', {
              component: 'auth:jwt',
              userId: user.id,
              provider: account.provider,
            });
            if (account.provider === 'oidc' && user.email) {
              try {
                const activeConfig = await getOidcConfig();
                const issuer = activeConfig?.issuer ? normalizeIssuer(activeConfig.issuer) : null;
                const subject = account.providerAccountId || user.id || null;

                const identity =
                  issuer && subject
                    ? await prisma.oidcIdentity.findUnique({
                        where: { issuer_subject: { issuer, subject } },
                      })
                    : null;

                const dbUser = identity
                  ? await prisma.user.findUnique({ where: { id: identity.userId } })
                  : await prisma.user.findUnique({
                      where: { email: user.email.toLowerCase() },
                    });

                if (dbUser) {
                  token.sub = dbUser.id;
                  token.role = dbUser.role;
                  token.name = dbUser.name;
                  token.email = dbUser.email;
                  (token as AugmentedJWT).tokenVersion = dbUser.tokenVersion ?? 0;
                } else {
                  logger.error('[Auth] JWT callback - OIDC user not found in DB', {
                    component: 'auth:jwt',
                    email: user.email,
                  });
                }
              } catch (error) {
                logger.error('[Auth] JWT callback - DB lookup failed', {
                  component: 'auth:jwt',
                  error,
                });
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
            logger.warn('[Auth-Debug] Initial Sign In (Fallback)', {
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
            // Explicit updates also take the same authoritative DB path below.
          }

          if (token.sub && typeof token.sub === 'string') {
            const currentTokenVersion = (token as AugmentedJWT).tokenVersion;
            const lastFetchedAt = (token as AugmentedJWT).userFetchedAt;
            const ttlMs = getJwtUserRefreshTtlMs();

            if (trigger !== 'update' && lastFetchedAt && Date.now() - lastFetchedAt < ttlMs) {
              // ttlMs is intentionally zero: retained only to keep this branch
              // structurally explicit if a future cache is redesigned around
              // distributed revocation invalidation.
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
                  logger.warn('[Auth-Debug] User Check', {
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
                  logger.warn('[Auth-Debug] User NOT FOUND in DB', {
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
            logger.warn('[Auth-Debug] No token.sub found!', { component: 'auth:jwt', token });
          }

          return token;
        },
        async session({ session, token }) {
          logger.warn('[Auth-Debug] Session callback', {
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
          if (!user?.email) {
            logger.warn('[Auth] Sign-in rejected: missing email', {
              component: 'auth:signIn',
              provider: account?.provider ?? 'unknown',
            });
            return false;
          }

          const email = user.email.toLowerCase();
          const existing = await prisma.user.findUnique({
            where: { email },
          });

          if (existing?.status === 'DISABLED') {
            logger.warn('[Auth] Sign-in rejected: user disabled', {
              component: 'auth:signIn',
              provider: account?.provider,
              email,
            });
            return false;
          }

          if (account?.provider === 'oidc') {
            logger.info('[Auth] OIDC sign-in attempt', {
              component: 'auth:signIn',
              email,
              userExists: !!existing,
              userId: user.id,
            });

            const activeConfig = await getOidcConfig();
            if (!activeConfig) {
              logger.warn('[Auth] OIDC sign-in rejected: configuration missing or invalid', {
                component: 'auth:signIn',
                email,
              });
              return false;
            }

            const emailVerifiedClaim = coerceBooleanClaim((profile as any)?.email_verified); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (emailVerifiedClaim === false) {
              logger.warn('[Auth] OIDC sign-in rejected: email not verified by IdP', {
                component: 'auth:signIn',
                email,
              });
              return false;
            }
            if (
              requiresOidcEmailVerifiedClaim(
                activeConfig.providerType,
                isOidcEmailVerifiedStrict()
              ) && emailVerifiedClaim !== true
            ) {
              logger.warn('[Auth] OIDC sign-in rejected: email_verified missing (strict mode)', {
                component: 'auth:signIn',
                email,
                providerType: activeConfig.providerType,
              });
              return false;
            }
            if (emailVerifiedClaim === undefined) {
              logger.warn('[Auth] OIDC sign-in: email_verified claim missing; proceeding', {
                component: 'auth:signIn',
                email,
                providerType: activeConfig.providerType,
              });
            }

            if (activeConfig.allowedDomains.length > 0) {
              const domain = email.split('@').pop()?.toLowerCase().trim() || '';
              if (!domain || domain === email) {
                logger.warn('[Auth] OIDC sign-in rejected: invalid email domain', {
                  component: 'auth:signIn',
                  email,
                });
                return false;
              }
              const normalizedAllowed = activeConfig.allowedDomains.map(d =>
                d.toLowerCase().trim()
              );
              if (!normalizedAllowed.includes(domain)) {
                logger.warn('[Auth] OIDC sign-in rejected: domain not allowed', {
                  component: 'auth:signIn',
                  email,
                  domain,
                  allowedDomains: activeConfig.allowedDomains,
                });
                return false;
              }
              logger.debug('[Auth] OIDC domain validation passed', {
                component: 'auth:signIn',
                email,
                domain,
              });
            }

            if (!existing) {
              if (!activeConfig.autoProvision) {
                logger.warn('[Auth] OIDC sign-in rejected: auto-provision disabled', {
                  component: 'auth:signIn',
                  email,
                });
                return false;
              }

              try {
                const newUser = await prisma.user.create({
                  data: {
                    email,
                    name: user.name || email.split('@')[0],
                    role: 'USER',
                    status: 'ACTIVE',
                  },
                });

                logger.info('[Auth] Created new user via OIDC auto-provision', {
                  component: 'auth:signIn',
                  userId: newUser.id,
                  email,
                });

                user.id = newUser.id;
              } catch (error) {
                logger.error('[Auth] Failed to create OIDC user', {
                  component: 'auth:signIn',
                  error,
                });
                return false;
              }
            }

            const targetUser = existing || (await prisma.user.findUnique({ where: { email } }));

            if (!targetUser) {
              logger.error('[Auth] OIDC user not found after creation', {
                component: 'auth:signIn',
                email,
              });
              return false;
            }

            if (targetUser.status === 'DISABLED') {
              logger.warn('[Auth] OIDC sign-in rejected: user is disabled', {
                component: 'auth:signIn',
                userId: targetUser.id,
                email,
              });
              return false;
            }

            const issuer = normalizeIssuer(activeConfig.issuer);
            const subject =
              account?.providerAccountId ||
              (profile as any)?.sub || // eslint-disable-line @typescript-eslint/no-explicit-any
              null;

            if (!subject) {
              logger.warn('[Auth] OIDC sign-in rejected: stable subject claim missing', {
                component: 'auth:signIn',
                issuer,
                email,
              });
              return false;
            }

            let existingIdentity = await prisma.oidcIdentity.findUnique({
              where: { issuer_subject: { issuer, subject } },
            });

            if (!existingIdentity) {
              const isInvitedUser = targetUser.status === 'INVITED';
              try {
                existingIdentity = await runSerializableTransaction(async tx => {
                  const currentTarget = await tx.user.findUnique({
                    where: { id: targetUser.id },
                    select: { id: true, status: true },
                  });
                  if (!currentTarget || currentTarget.status === 'DISABLED') {
                    throw new Error('OIDC_TARGET_NOT_OPERATIONAL');
                  }

                  const linked = await tx.oidcIdentity.findUnique({
                    where: { issuer_subject: { issuer, subject } },
                  });
                  if (linked) {
                    if (linked.userId !== currentTarget.id) {
                      throw new Error('OIDC_IDENTITY_OWNED_BY_ANOTHER_USER');
                    }
                    return linked;
                  }

                  if (
                    existing &&
                    !hasOidcEmailLinkAssurance(activeConfig.providerType, emailVerifiedClaim)
                  ) {
                    throw new Error('OIDC_LINK_NOT_APPROVED');
                  }

                  const requiresLinkApproval =
                    Boolean(existing) &&
                    (currentTarget.status !== 'INVITED' || emailVerifiedClaim !== true);
                  if (requiresLinkApproval) {
                    const approval = await tx.oidcLinkingApproval.findFirst({
                      where: { userId: currentTarget.id, revokedAt: null },
                      select: { id: true },
                    });
                    if (!approval) throw new Error('OIDC_LINK_NOT_APPROVED');
                    const consumed = await tx.oidcLinkingApproval.updateMany({
                      where: { id: approval.id, revokedAt: null },
                      data: { revokedAt: new Date() },
                    });
                    if (consumed.count !== 1) throw new Error('OIDC_LINK_NOT_APPROVED');
                  }

                  return tx.oidcIdentity.create({
                    data: { issuer, subject, email, userId: currentTarget.id },
                  });
                });
              } catch (error) {
                if (
                  error instanceof Error &&
                  (error.message === 'OIDC_LINK_NOT_APPROVED' ||
                    error.message === 'OIDC_TARGET_NOT_OPERATIONAL' ||
                    error.message === 'OIDC_IDENTITY_OWNED_BY_ANOTHER_USER')
                ) {
                  logger.warn(
                    '[Auth] OIDC sign-in blocked: account linking authorization changed',
                    {
                      component: 'auth:signIn',
                      email,
                      issuer,
                      subject,
                      reason: error.message,
                    }
                  );
                  return false;
                }
                throw error;
              }
              logger.info('[Auth] Linked OIDC identity to user', {
                component: 'auth:signIn',
                issuer,
                subject,
                userId: targetUser.id,
                isInvitedUser,
                adminProvisioned: !!existing,
              });
            } else if (existingIdentity.userId !== targetUser.id) {
              logger.warn('[Auth] OIDC sign-in rejected: identity already linked to another user', {
                component: 'auth:signIn',
                issuer,
                subject,
                email,
              });
              return false;
            }

            const updateData: any = {};
            user.id = targetUser.id;

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
              (profile as any)
            ) {
              logger.debug('[Auth] Evaluating OIDC role mapping', {
                component: 'auth:signIn',
                ruleCount: activeConfig.roleMapping.length,
                currentRole: targetUser.role,
              });

              const mapping = activeConfig.roleMapping as Array<{
                claim: string;
                value: string;
                role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
              }>;
              for (const rule of mapping) {
                const claimValue = (profile as any)[rule.claim];
                let match = false;

                if (Array.isArray(claimValue)) {
                  match = claimValue.includes(rule.value);
                  logger.debug('[Auth] Checking array claim for role mapping', {
                    component: 'auth:signIn',
                    claim: rule.claim,
                    expectedValue: rule.value,
                    actualValues: claimValue,
                    matched: match,
                  });
                } else if (claimValue === rule.value) {
                  match = true;
                  logger.debug('[Auth] Checking scalar claim for role mapping', {
                    component: 'auth:signIn',
                    claim: rule.claim,
                    expectedValue: rule.value,
                    actualValue: claimValue,
                    matched: match,
                  });
                }

                if (match) {
                  if (targetUser.role !== rule.role) {
                    updateData.role = rule.role;
                    logger.info('[Auth] OIDC role mapping applied', {
                      component: 'auth:signIn',
                      userId: targetUser.id,
                      oldRole: targetUser.role,
                      newRole: rule.role,
                      matchedClaim: rule.claim,
                      matchedValue: rule.value,
                    });
                  }
                  break;
                }
              }

              if (!updateData.role) {
                logger.debug('[Auth] No role mapping matched', {
                  component: 'auth:signIn',
                  availableClaims: Object.keys(profile as any),
                });
              }
            }

            if (
              activeConfig.profileMapping &&
              typeof activeConfig.profileMapping === 'object' &&
              profile
            ) {
              logger.debug('[Auth] Evaluating OIDC profile sync', {
                component: 'auth:signIn',
                mappingKeys: Object.keys(activeConfig.profileMapping),
              });

              const mapping = activeConfig.profileMapping as Record<string, string>;
              const oidcProfile = profile as Record<string, unknown>;

              if (mapping.department && oidcProfile[mapping.department]) {
                const dept = String(oidcProfile[mapping.department]);
                if (dept && dept !== targetUser.department) {
                  updateData.department = dept;
                  logger.debug('[Auth] Syncing department from OIDC', {
                    component: 'auth:signIn',
                    claimName: mapping.department,
                    newValue: dept,
                    oldValue: targetUser.department,
                  });
                }
              }

              if (mapping.jobTitle && oidcProfile[mapping.jobTitle]) {
                const title = String(oidcProfile[mapping.jobTitle]);
                if (title && title !== targetUser.jobTitle) {
                  updateData.jobTitle = title;
                  logger.debug('[Auth] Syncing job title from OIDC', {
                    component: 'auth:signIn',
                    claimName: mapping.jobTitle,
                    newValue: title,
                    oldValue: targetUser.jobTitle,
                  });
                }
              }

              if (mapping.avatarUrl && oidcProfile[mapping.avatarUrl]) {
                const avatar = String(oidcProfile[mapping.avatarUrl]);
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
                  logger.debug('[Auth] Syncing avatar URL from OIDC', {
                    component: 'auth:signIn',
                    claimName: mapping.avatarUrl,
                    hasNewValue: !!avatar,
                  });
                }
              }
              if (updateData.department || updateData.jobTitle || updateData.avatarUrl) {
                updateData.lastOidcSync = new Date();
                logger.info('[Auth] OIDC profile sync completed', {
                  component: 'auth:signIn',
                  userId: targetUser.id,
                  syncedFields: Object.keys(updateData).filter(k =>
                    ['department', 'jobTitle', 'avatarUrl'].includes(k)
                  ),
                });
              }
            }

            if (updateData.role && updateData.role !== targetUser.role) {
              updateData.tokenVersion = { increment: 1 };
            }

            if (Object.keys(updateData).length > 0) {
              if (updateData.role && updateData.role !== targetUser.role) {
                const { updateUserSecurityState } = await import('@/lib/users/admin-invariants');
                const mappedRole = updateData.role;
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
              email,
              userId: user.id,
            });

            try {
              const { logLoginSuccess } = await import('@/lib/login-audit');
              const { headers } = await import('next/headers');
              const h = await headers();
              const ua = h.get('user-agent') || 'Unknown';
              const ip =
                h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'Unknown';
              await logLoginSuccess(email, targetUser.id, ip, ua, 'oidc');
            } catch {
              // Non-critical audit logging failure
            }
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

export function resetAuthOptionsCache() {
  authOptionsCache = undefined;
  authOptionsInFlight = undefined;
}
