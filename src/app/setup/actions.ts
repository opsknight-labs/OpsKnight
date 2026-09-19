'use server';

import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';
import { consumeAuthRateLimit, authPrivacyDigest } from '@/lib/auth-abuse';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS, validatePasswordStrength } from '@/lib/passwords';
import {
  BOOTSTRAP_CONFIG_KEY,
  hashBootstrapCode,
  parseBootstrapState,
} from '@/lib/bootstrap-security';
import { normalizeHostname } from '@/lib/request-host';

const BOOTSTRAP_TRANSACTION_ATTEMPTS = 3;
const BOOTSTRAP_RATE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Resolve the canonical application URL for seeding SystemSettings.appUrl
 * during bootstrap. Uses the same trust model as the middleware:
 *   - When TRUST_PROXY_HEADERS=true, prefer X-Forwarded-Host + X-Forwarded-Proto.
 *   - Otherwise, use the raw Host header.
 *
 * This must stay in sync with getAuthoritativeRequestHost() from @/lib/request-host.
 */
function resolveBootstrapAppUrl(headerStore: Headers): string | null {
  let hostname: string | undefined;

  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwarded = headerStore.get('x-forwarded-host');
    if (forwarded) {
      const rawForwarded = forwarded
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
        .at(-1);
      hostname = normalizeHostname(rawForwarded) || undefined;
    }
  }
  if (!hostname) {
    hostname = normalizeHostname(headerStore.get('host')) || undefined;
  }
  if (!hostname) return null;

  const proto =
    process.env.TRUST_PROXY_HEADERS === 'true'
      ? headerStore.get('x-forwarded-proto')?.split(',').at(0)?.trim() || 'https'
      : 'https';

  return `${proto}://${hostname}`;
}

const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    bootstrapCode: z.string().trim().min(16).max(256),
    password: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
    confirmPassword: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
  })
  .strict();

function isTransactionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2034');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function constantTimeUtf8Equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export async function bootstrapAdmin(formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    bootstrapCode: formData.get('bootstrapCode'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) return { error: 'Check the setup fields and try again.' };

  const { name, bootstrapCode, password, confirmPassword } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  if (!constantTimeUtf8Equal(password, confirmPassword)) {
    return { error: 'Passwords do not match.' };
  }
  const passwordError = validatePasswordStrength(password, { email, displayName: name });
  if (passwordError) return { error: passwordError };

  const headerStore = await headers();
  const ip = getClientIp(headerStore);
  const submittedHash = hashBootstrapCode(bootstrapCode);
  const [ipRate, codeRate] = await Promise.all([
    consumeAuthRateLimit('bootstrap:ip', ip, 20, BOOTSTRAP_RATE_WINDOW_MS),
    consumeAuthRateLimit('bootstrap:code', submittedHash, 5, BOOTSTRAP_RATE_WINDOW_MS),
  ]);
  if (!ipRate.allowed || !codeRate.allowed) {
    return { error: 'Setup temporarily unavailable. Check the authorization code and try later.' };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let user: { id: string; email: string } | undefined;

  for (let attempt = 1; attempt <= BOOTSTRAP_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      user = await prisma.$transaction(
        async tx => {
          if ((await tx.user.count()) > 0) throw new Error('SYSTEM_ALREADY_INITIALIZED');

          const config = await tx.systemConfig.findUnique({
            where: { key: BOOTSTRAP_CONFIG_KEY },
            select: { value: true },
          });
          const state = parseBootstrapState(config?.value);
          if (
            !state ||
            state.usedAt ||
            new Date(state.expiresAt) <= new Date() ||
            !constantTimeHexEqual(state.tokenHash, submittedHash)
          ) {
            throw new Error('INVALID_BOOTSTRAP_AUTHORIZATION');
          }

          const created = await tx.user.create({
            data: {
              name,
              email,
              role: 'ADMIN',
              status: 'ACTIVE',
              passwordHash,
              invitedAt: null,
              deactivatedAt: null,
            },
            select: { id: true, email: true },
          });

          await tx.systemConfig.update({
            where: { key: BOOTSTRAP_CONFIG_KEY },
            data: {
              value: { ...state, usedAt: new Date().toISOString() },
              updatedBy: created.id,
            },
          });

          // Seed SystemSettings.appUrl from the request hostname so the
          // middleware host firewall immediately recognizes this domain
          // after bootstrap — eliminating the chicken-and-egg problem.
          const bootstrapAppUrl = resolveBootstrapAppUrl(headerStore);
          if (bootstrapAppUrl) {
            await tx.systemSettings.upsert({
              where: { id: 'default' },
              create: { id: 'default', appUrl: bootstrapAppUrl },
              update: { appUrl: bootstrapAppUrl },
            });
            await logAudit(
              {
                action: 'settings.app_url.bootstrap_seeded',
                entityType: 'USER',
                entityId: created.id,
                actorId: null,
                source: 'AUTH',
                newValue: { appUrl: bootstrapAppUrl },
                details: { method: 'operator_bootstrap_capability' },
              },
              tx
            );
          }

          await logAudit(
            {
              action: 'user.bootstrap',
              entityType: 'USER',
              entityId: created.id,
              actorId: null,
              source: 'AUTH',
              details: { method: 'operator_bootstrap_capability' },
            },
            tx
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error) {
      if (error instanceof Error && error.message === 'SYSTEM_ALREADY_INITIALIZED') {
        redirect('/login');
      }
      if (error instanceof Error && error.message === 'INVALID_BOOTSTRAP_AUTHORIZATION') {
        const [emailHash, ipHash] = await Promise.all([
          authPrivacyDigest('audit:bootstrap:email', email),
          authPrivacyDigest('audit:bootstrap:ip', ip),
        ]);
        logger.warn('auth.bootstrap.authorization_rejected', {
          component: 'setup',
          emailHash,
          ipHash,
        });
        return { error: 'Invalid or expired setup authorization code.' };
      }
      if (isTransactionConflict(error) && attempt < BOOTSTRAP_TRANSACTION_ATTEMPTS) continue;
      throw error;
    }
  }

  if (!user) return { error: 'Unable to initialize the system safely. Please retry.' };

  return { success: true, email: user.email };
}
