import { NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonApiOk, jsonError } from '@/lib/api-response';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { retryAuthenticationAlert } from '@/lib/auth-control/security-events';
import { revokeAuthenticationSession } from '@/lib/auth-control/sessions';
import { getControlActor } from '@/lib/auth-control/actor';
import {
  authenticationDashboard,
  authenticationAlertHistory,
  authenticationAlertHistoryStatus,
  identityClaimsPreview,
  searchAuthenticationUsers,
} from '@/lib/auth-control/dashboard';
import { assertAuthenticationOrigin } from '@/lib/auth-control/origin';
import {
  activateOidcRevision,
  beginOidcRevisionTest,
  enforcementPreview,
  OIDC_TEST_COOKIE,
  stageOidcRevision,
  stageRollback,
} from '@/lib/auth-control/oidc-revisions';
import {
  createEmergencyAccount,
  changeEmergencyMethod,
  disableEmergencyAccount,
  registrationOptions,
  retireLegacyEmergency,
  revokeEmergencyCredential,
  verifyRegistration,
} from '@/lib/auth-control/emergency-management';
import { CEREMONY_COOKIE, emergencyCookieOptions } from '@/lib/auth-control/emergency';
import { restorePasswordAccess, repairCanonicalOrigin } from '@/lib/auth-control/recovery';
import { changeAuthenticationMode } from '@/app/(app)/settings/system/authentication-actions';
import { readJsonBodyWithLimit } from '@/lib/request-body';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';

const id = z.string().min(1).max(128);
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('retryAlert'),
      alertId: id,
      expectedGeneration: z.number().int().min(0),
      confirmation: z.literal('RETRY SECURITY EMAIL'),
    })
    .strict(),
  z
    .object({
      action: z.literal('repairOrigin'),
      expectedVersion: z.number().int().positive(),
      confirmation: z.literal('REPAIR PINNED ORIGIN'),
    })
    .strict(),
  z
    .object({
      action: z.literal('stage'),
      configuration: z.unknown(),
      acknowledgeBroadAdminRules: z.boolean().default(false),
      sourceRevisionId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('test'),
      revisionId: id,
      adminUserId: id,
      linkApproved: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('preview'), revisionId: id }).strict(),
  z
    .object({
      action: z.literal('activate'),
      revisionId: id,
      expectedVersion: z.number().int().positive(),
      mode: z.enum(['SSO_OPTIONAL', 'SSO_REQUIRED']),
      confirmation: z.literal('ACTIVATE VERIFIED SSO'),
    })
    .strict(),
  z.object({ action: z.literal('rollback'), revisionId: id }).strict(),
  z
    .object({
      action: z.literal('createEmergency'),
      displayName: z.string().trim().min(1).max(80),
      independenceConfirmed: z.literal(true),
      authenticationMethod: z.enum(['PASSWORD', 'WEBAUTHN']).default('WEBAUTHN'),
    })
    .strict(),
  z
    .object({
      action: z.literal('changeEmergencyMethod'),
      confirmation: z.literal('CHANGE RECOVERY CREDENTIAL'),
      accountId: id,
      method: z.enum(['PASSWORD', 'WEBAUTHN']),
      compromised: z.boolean(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ action: z.literal('enroll'), accountId: id }).strict(),
  z
    .object({
      action: z.literal('verifyEnrollment'),
      challengeId: id,
      displayName: z.string().trim().min(1).max(80),
      response: z.custom<RegistrationResponseJSON>(value =>
        Boolean(
          value &&
          typeof value === 'object' &&
          'id' in value &&
          'response' in value &&
          'type' in value &&
          value.type === 'public-key'
        )
      ),
    })
    .strict(),
  z.object({ action: z.literal('revokeSession'), sessionId: id }).strict(),
  z.object({ action: z.literal('revoke'), credentialId: id, compromised: z.boolean() }).strict(),
  z
    .object({
      action: z.literal('disableEmergency'),
      accountId: id,
      compromised: z.boolean().default(false),
    })
    .strict(),
  z.object({ action: z.literal('retireLegacy') }).strict(),
  z.object({ action: z.literal('claims'), revisionId: id, claims: z.record(z.unknown()) }).strict(),
  z
    .object({
      action: z.literal('mode'),
      mode: z.enum(['PASSWORD_ONLY', 'SSO_OPTIONAL']),
      expectedVersion: z.number().int().positive(),
      currentPassword: z.string().max(256),
      confirmation: z.literal('CHANGE AUTHENTICATION POLICY'),
    })
    .strict(),
  z
    .object({
      action: z.literal('restorePassword'),
      adminUserId: id,
      password: z.string().min(1).max(256),
      expectedVersion: z.number().int().positive(),
      confirmation: z.enum(['RESTORE PASSWORD ACCESS', 'RESTORE INSTANCE PASSWORD ACCESS']),
      scope: z.enum(['ADMIN_ONLY', 'INSTANCE']).default('ADMIN_ONLY'),
    })
    .strict(),
]);
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const json = (data: unknown) => jsonApiOk(data, { headers });

export async function GET(request: NextRequest) {
  try {
    const params = z
      .object({
        section: z
          .enum(['overview', 'connection', 'access', 'policy', 'emergency', 'diagnostics'])
          .default('overview'),
        view: z.enum(['dashboard', 'admins', 'users', 'alerts']).default('dashboard'),
        q: z.string().max(100).default(''),
        after: z.string().max(512).optional(),
        status: authenticationAlertHistoryStatus.default('failed'),
      })
      .strict()
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    const actor = await getControlActor();
    if (
      !(await consumeAuthRateLimit('auth-control-read', `${actor.kind}:${actor.id}`, 120, 60000))
        .allowed
    )
      return jsonError('Too many authentication reads.', 429, undefined, headers);
    if (params.view === 'alerts')
      return json(await authenticationAlertHistory(params.status, params.after));
    if (params.view !== 'dashboard')
      return json(
        await searchAuthenticationUsers(actor, params.q, params.after, params.view === 'admins')
      );
    const response = json(await authenticationDashboard(actor, params.section));
    if (actor.kind === 'admin' && request.cookies.has('opsknight-emergency'))
      response.cookies.set('opsknight-emergency', '', { ...emergencyCookieOptions, maxAge: 0 });
    if (actor.kind === 'admin' && request.cookies.has('__Host-opsknight-emergency'))
      response.cookies.set('__Host-opsknight-emergency', '', {
        ...emergencyCookieOptions,
        maxAge: 0,
      });
    return response;
  } catch {
    return jsonError(
      'Authentication administration requires an active administrator or emergency recovery session.',
      403,
      undefined,
      headers
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await readJsonBodyWithLimit(request, 65536));
    const actor = await getControlActor(input.action !== 'preview' && input.action !== 'claims');
    await assertAuthenticationOrigin(
      request,
      actor.kind !== 'admin' ||
        [
          'enroll',
          'verifyEnrollment',
          'revoke',
          'disableEmergency',
          'createEmergency',
          'changeEmergencyMethod',
        ].includes(input.action)
    );
    if (
      !(await consumeAuthRateLimit('auth-control', `${actor.kind}:${actor.id}`, 60, 300000)).allowed
    )
      throw new Error('Too many authentication operations. Try again later.');
    switch (input.action) {
      case 'repairOrigin':
        return json(await repairCanonicalOrigin(actor, input.expectedVersion));
      case 'stage':
        return json(
          await stageOidcRevision(
            actor,
            input.configuration,
            input.acknowledgeBroadAdminRules,
            input.sourceRevisionId
          )
        );
      case 'test': {
        const result = await beginOidcRevisionTest(
          actor,
          input.revisionId,
          input.adminUserId,
          input.linkApproved
        );
        const response = json({ url: result.url });
        response.cookies.set(OIDC_TEST_COOKIE, result.browserToken, {
          ...emergencyCookieOptions,
          sameSite: 'lax',
          maxAge: 300,
        });
        return response;
      }
      case 'preview':
        return json(await enforcementPreview(input.revisionId));
      case 'activate':
        return json(
          await activateOidcRevision(
            actor,
            input.revisionId,
            input.expectedVersion,
            input.mode,
            input.confirmation
          )
        );
      case 'rollback':
        return json(await stageRollback(actor, input.revisionId));
      case 'createEmergency':
        return json(
          await createEmergencyAccount(
            actor,
            input.displayName,
            input.independenceConfirmed,
            input.authenticationMethod
          )
        );
      case 'changeEmergencyMethod':
        return json(
          await changeEmergencyMethod(
            actor,
            input.accountId,
            input.method,
            input.compromised,
            input.expectedVersion
          )
        );
      case 'enroll': {
        const result = await registrationOptions(actor, input.accountId);
        const response = json({ options: result.options, challengeId: result.challengeId });
        response.cookies.set(CEREMONY_COOKIE, result.browserToken, {
          ...emergencyCookieOptions,
          maxAge: 300,
        });
        return response;
      }
      case 'verifyEnrollment':
        await verifyRegistration(
          actor,
          input.challengeId,
          request.cookies.get(CEREMONY_COOKIE)?.value ?? '',
          input.displayName,
          input.response
        );
        return json({ success: true });
      case 'retryAlert':
        await retryAuthenticationAlert(actor, input.alertId, input.expectedGeneration);
        return json({ success: true });
      case 'revokeSession':
        await revokeAuthenticationSession(actor, input.sessionId);
        return json({ success: true });
      case 'revoke':
        await revokeEmergencyCredential(actor, input.credentialId, input.compromised);
        return json({ success: true });
      case 'disableEmergency':
        await disableEmergencyAccount(actor, input.accountId, input.compromised);
        return json({ success: true });
      case 'retireLegacy':
        await retireLegacyEmergency(actor);
        return json({ success: true });
      case 'claims':
        return json(await identityClaimsPreview(input.revisionId, input.claims));
      case 'mode':
        if (actor.kind !== 'admin')
          throw new Error('Use the explicit recovery workflow to restore password access.');
        {
          const { action: _action, ...transition } = input;
          return json(await changeAuthenticationMode(transition));
        }
      case 'restorePassword':
        return json(
          await restorePasswordAccess(
            actor,
            input.adminUserId,
            input.password,
            input.expectedVersion,
            input.confirmation,
            input.scope
          )
        );
    }
  } catch (error) {
    return jsonError(
      error instanceof z.ZodError
        ? 'Invalid authentication request.'
        : error instanceof Error && !('clientVersion' in error)
          ? error.message
          : 'Authentication administration unavailable.',
      error instanceof z.ZodError ? 400 : 403,
      undefined,
      headers
    );
  }
}
