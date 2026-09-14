import { NextRequest, NextResponse } from 'next/server';
import { getToken, type JWT } from 'next-auth/jwt';
import { z } from 'zod';

import { getRequestActorContext } from '@/lib/request-actor-context';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { SESSION_TOKEN_COOKIE_NAME, useSecureCookies } from '@/lib/auth-cookies';
import { customJwtDecode } from '@/lib/auth-jwt-encoder';
import {
  listRegisteredSessions,
  promoteRegisteredSessionPolicy,
  recordRegisteredSessionActivity,
  revokeAllRegisteredSessions,
  revokeRegisteredSession,
} from '@/lib/session-registry';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

const RevokeSchema = z
  .object({
    sessionId: z.string().min(16).max(128).optional(),
    all: z.boolean().optional(),
  })
  .strict()
  .refine(value => value.all === true || Boolean(value.sessionId), {
    message: 'sessionId is required unless all=true',
  });

const HeartbeatSchema = z
  .object({
    policy: z.enum(['STANDARD', 'TRUSTED_PWA']).optional(),
  })
  .strict();

async function currentToken(request: NextRequest): Promise<JWT | null> {
  return getToken({
    req: request,
    secret: await getNextAuthSecret(),
    cookieName: SESSION_TOKEN_COOKIE_NAME,
    secureCookie: useSecureCookies,
    decode: customJwtDecode,
  });
}

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: NextRequest) {
  const context = await getRequestActorContext();
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: noStoreHeaders });
  }
  const token = await currentToken(request);
  const sessionId = typeof token?.jti === 'string' ? token.jti : null;
  if (!sessionId) {
    return NextResponse.json({ error: 'Session identity unavailable' }, { status: 401, headers: noStoreHeaders });
  }
  await recordRegisteredSessionActivity({
    userId: context.user.id,
    sessionId,
    userAgent: request.headers.get('user-agent'),
  });
  const sessions = await listRegisteredSessions(context.user.id, sessionId);
  return NextResponse.json({ sessions }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const context = await getRequestActorContext();
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: noStoreHeaders });
  }
  const token = await currentToken(request);
  const sessionId = typeof token?.jti === 'string' ? token.jti : null;
  if (!sessionId) {
    return NextResponse.json({ error: 'Session identity unavailable' }, { status: 401, headers: noStoreHeaders });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = HeartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid session heartbeat' }, { status: 400, headers: noStoreHeaders });
  }

  if (parsed.data.policy === 'TRUSTED_PWA') {
    if (token?.rememberMe !== true) {
      return NextResponse.json(
        { error: 'Trusted PWA policy requires an extended credential session' },
        { status: 409, headers: noStoreHeaders }
      );
    }
    const promoted = await promoteRegisteredSessionPolicy({
      userId: context.user.id,
      sessionId,
      policy: 'TRUSTED_PWA',
    });
    if (!promoted) {
      return NextResponse.json({ error: 'Session is no longer active' }, { status: 401, headers: noStoreHeaders });
    }
  }

  await recordRegisteredSessionActivity({
    userId: context.user.id,
    sessionId,
    userAgent: request.headers.get('user-agent'),
  });
  return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
}

export async function DELETE(request: NextRequest) {
  const context = await getRequestActorContext();
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: noStoreHeaders });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = RevokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid session revocation request', issues: parsed.error.issues },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const token = await currentToken(request);
  const current = typeof token?.jti === 'string' ? token.jti : null;

  if (parsed.data.all === true) {
    const revoked = await revokeAllRegisteredSessions(context.user.id);
    await revokeUserSessions(context.user.id);
    await logAudit({
      action: 'session.revoked_all',
      entityType: 'USER',
      entityId: context.user.id,
      actorId: context.user.id,
      details: { reason: 'User initiated session revocation', registeredSessionsRevoked: revoked },
    });
    return NextResponse.json({ success: true, revoked, current: true }, { headers: noStoreHeaders });
  }

  const sessionId = parsed.data.sessionId!;
  const revoked = await revokeRegisteredSession({ userId: context.user.id, sessionId });
  if (!revoked) {
    return NextResponse.json(
      { error: 'Session was not found or was already revoked' },
      { status: 404, headers: noStoreHeaders }
    );
  }
  await logAudit({
    action: 'session.revoked',
    entityType: 'USER',
    entityId: context.user.id,
    actorId: context.user.id,
    details: { sessionId, current: current === sessionId },
  });
  return NextResponse.json(
    { success: true, revoked: 1, current: current === sessionId },
    { headers: noStoreHeaders }
  );
}
