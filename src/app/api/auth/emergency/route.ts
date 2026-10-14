import { NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonApiOk, jsonError } from '@/lib/api-response';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { readJsonBodyWithLimit } from '@/lib/request-body';
import { getClientIp } from '@/lib/client-ip';
import { assertAuthenticationOrigin } from '@/lib/auth-control/origin';
import {
  CEREMONY_COOKIE,
  EMERGENCY_COOKIE,
  emergencyCookieOptions,
  emergencyLoginOptions,
  verifyEmergencyLogin,
  legacyEmergencyLogin,
  passwordEmergencyLogin,
  deliberateEmergencyActivity,
  revokeEmergencySession,
} from '@/lib/auth-control/emergency';

const responseSchema = z.custom<AuthenticationResponseJSON>(value =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'response' in value &&
    'type' in value &&
    value.type === 'public-key'
  )
);
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('passwordLogin'),
      accountId: z.string().min(1).max(128),
      password: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal('passwordReauth'),
      accountId: z.string().min(1).max(128),
      password: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal('options'),
      accountId: z.string().min(1).max(128),
      reauthenticate: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal('verify'),
      challengeId: z.string().max(128),
      response: responseSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('legacy'),
      email: z.string().email().max(254),
      password: z.string().min(1).max(256),
    })
    .strict(),
  z.object({ action: z.literal('activity') }).strict(),
  z.object({ action: z.literal('logout') }).strict(),
]);
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function POST(request: NextRequest) {
  try {
    await assertAuthenticationOrigin(request, true);
    const input = schema.parse(await readJsonBodyWithLimit(request, 65536));
    const token = request.cookies.get(EMERGENCY_COOKIE)?.value ?? '';
    const ip = getClientIp(request.headers);
    if (input.action === 'options') {
      const result = await emergencyLoginOptions(
        input.accountId,
        ip,
        input.reauthenticate ? token : undefined
      );
      const response = jsonApiOk(
        { options: result.options, challengeId: result.challengeId },
        { headers: noStore }
      );
      response.cookies.set(CEREMONY_COOKIE, result.browserToken, {
        ...emergencyCookieOptions,
        maxAge: 300,
      });
      return response;
    }
    if (
      input.action === 'verify' ||
      input.action === 'legacy' ||
      input.action === 'passwordLogin' ||
      input.action === 'passwordReauth'
    ) {
      const result =
        input.action === 'verify'
          ? await verifyEmergencyLogin(
              input.challengeId,
              request.cookies.get(CEREMONY_COOKIE)?.value ?? '',
              input.response,
              ip
            )
          : input.action === 'legacy'
            ? await legacyEmergencyLogin(input.email, input.password, ip)
            : await passwordEmergencyLogin(
                input.accountId,
                input.password,
                ip,
                input.action === 'passwordReauth' ? token : undefined
              );
      const response = jsonApiOk(
        { success: true, expiresAt: result.expiresAt.toISOString(), recoveryUrl: '/recovery' },
        { headers: noStore }
      );
      response.cookies.set(EMERGENCY_COOKIE, result.token, {
        ...emergencyCookieOptions,
        expires: result.expiresAt,
      });
      response.cookies.set(CEREMONY_COOKIE, '', { ...emergencyCookieOptions, maxAge: 0 });
      return response;
    }
    if (input.action === 'activity') await deliberateEmergencyActivity(token);
    if (input.action === 'logout') await revokeEmergencySession(token);
    const response = jsonApiOk({ success: true }, { headers: noStore });
    if (input.action === 'logout')
      response.cookies.set(EMERGENCY_COOKIE, '', { ...emergencyCookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(
      error instanceof z.ZodError
        ? 'Invalid emergency request.'
        : error instanceof Error && !('clientVersion' in error)
          ? error.message
          : 'Emergency authentication unavailable.',
      error instanceof z.ZodError ? 400 : 403,
      undefined,
      noStore
    );
  }
}
