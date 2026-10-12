import 'server-only';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import prisma from '@/lib/prisma';
import { lockControlActor, type ControlActor } from './actor';
import { authenticationOrigin } from './origin';
import { digest, secret } from './emergency';
import { securityEvent } from './security-events';

export async function createEmergencyAccount(
  actor: ControlActor,
  displayName: string,
  independenceConfirmed: boolean
) {
  if (!independenceConfirmed)
    throw new Error('Confirm that this identity uses independently held hardware keys.');
  return prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    if ((await tx.emergencyAccount.count({ where: { status: { not: 'DISABLED' } } })) >= 20)
      throw new Error('Disable obsolete emergency identities before creating another.');
    const account = await tx.emergencyAccount.create({
      data: { displayName, independenceConfirmedAt: new Date() },
    });
    await securityEvent(tx, 'auth.emergency.enrolled', account.id, {
      authorizedBy: `${actor.kind}:${actor.id}`,
    });
    return { id: account.id, displayName: account.displayName };
  });
}

export async function registrationOptions(actor: ControlActor, accountId: string) {
  const origin = await authenticationOrigin();
  const account = await prisma.emergencyAccount.findUnique({
    where: { id: accountId },
    include: { credentials: { where: { revokedAt: null } } },
  });
  if (!account || account.status === 'DISABLED') throw new Error('Emergency account unavailable.');
  const options = await generateRegistrationOptions({
    rpName: 'OpsKnight Emergency Access',
    rpID: new URL(origin).hostname,
    userID: new TextEncoder().encode(account.id),
    userName: account.id,
    userDisplayName: account.displayName,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'cross-platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: account.credentials.map(credential => ({ id: credential.credentialId })),
  });
  const browserToken = secret();
  const challenge = await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const current = await tx.emergencyAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (current.status === 'DISABLED' || current.credentialVersion !== account.credentialVersion)
      throw new Error('Emergency identity changed. Reload.');
    return tx.emergencyChallenge.create({
      data: {
        kind: 'REGISTER',
        challenge: options.challenge,
        browserHash: digest(browserToken),
        emergencyAccountId: account.id,
        credentialVersion: account.credentialVersion,
        authorizedBy: `${actor.kind}:${actor.id}`,
        expiresAt: new Date(Date.now() + 300000),
      },
    });
  });
  return { options, challengeId: challenge.id, browserToken };
}

async function verifyRegistrationInternal(
  actor: ControlActor,
  challengeId: string,
  browserToken: string,
  displayName: string,
  response: RegistrationResponseJSON
) {
  const origin = await authenticationOrigin();
  const flow = await prisma.emergencyChallenge.findUnique({ where: { id: challengeId } });
  if (
    !flow ||
    flow.kind !== 'REGISTER' ||
    flow.authorizedBy !== `${actor.kind}:${actor.id}` ||
    flow.browserHash !== digest(browserToken) ||
    flow.consumedAt ||
    flow.expiresAt.getTime() <= Date.now()
  )
    throw new Error('Enrollment challenge expired or used. Begin enrollment again.');
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: flow.challenge,
    expectedOrigin: origin,
    expectedRPID: new URL(origin).hostname,
    requireUserVerification: true,
  });
  const info = verification.registrationInfo;
  if (
    !verification.verified ||
    !info ||
    info.credentialDeviceType !== 'singleDevice' ||
    info.credentialBackedUp
  )
    throw new Error(
      'Use an independently held hardware security key with user verification; synchronized passkeys are not accepted for emergency recovery.'
    );
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const account = await tx.emergencyAccount.findUniqueOrThrow({
      where: { id: flow.emergencyAccountId },
    });
    if (account.status === 'DISABLED' || account.credentialVersion !== flow.credentialVersion)
      throw new Error('Emergency credentials changed. Begin enrollment again.');
    const consumed = await tx.emergencyChallenge.updateMany({
      where: { id: flow.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new Error('Enrollment challenge already used.');
    await tx.emergencyCredential.create({
      data: {
        emergencyAccountId: account.id,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        displayName,
      },
    });
    await tx.emergencyAccount.update({
      where: { id: account.id },
      data: {
        credentialVersion: { increment: 1 },
        verifiedCredentialVersion: null,
        verifiedAt: null,
      },
    });
    await tx.emergencySession.updateMany({
      where: { emergencyAccountId: account.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await securityEvent(tx, 'auth.emergency.credential.enrolled', account.id, {
      authorizedBy: `${actor.kind}:${actor.id}`,
      requiresNewDrill: true,
    });
  });
}

export async function emergencyReadiness(tx: Pick<typeof prisma, 'emergencyAccount'>) {
  const origin = await authenticationOrigin();
  const accounts = await tx.emergencyAccount.findMany({
    where: {
      status: 'ACTIVE',
      verifiedOrigin: origin,
      verifiedAt: { gte: new Date(Date.now() - 90 * 86400000) },
    },
    include: {
      credentials: { where: { revokedAt: null, deviceType: 'singleDevice', backedUp: false } },
    },
  });
  return accounts.filter(
    account =>
      account.verifiedCredentialVersion === account.credentialVersion &&
      account.credentials.length > 0
  );
}

export async function revokeEmergencyCredential(
  actor: ControlActor,
  credentialId: string,
  compromised: boolean
) {
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const credential = await tx.emergencyCredential.findUniqueOrThrow({
      where: { id: credentialId },
    });
    if (credential.revokedAt) return;
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const ready = await emergencyReadiness(tx);
    const affectedReady = ready.some(account => account.id === credential.emergencyAccountId);
    if (policy.mode === 'SSO_REQUIRED' && affectedReady && ready.length <= 2 && !compromised)
      throw new Error(
        'Enroll and drill a replacement independent identity before reducing recovery readiness. Confirm compromise only for an actual compromised key.'
      );
    if (policy.mode === 'SSO_REQUIRED' && affectedReady && ready.length <= 1)
      throw new Error(
        'Keep another verified emergency identity before revoking the last recovery identity.'
      );
    await tx.emergencyCredential.update({
      where: { id: credential.id },
      data: { revokedAt: new Date() },
    });
    await tx.emergencyAccount.update({
      where: { id: credential.emergencyAccountId },
      data: {
        credentialVersion: { increment: 1 },
        verifiedAt: null,
        verifiedCredentialVersion: null,
      },
    });
    await tx.emergencySession.updateMany({
      where: { emergencyAccountId: credential.emergencyAccountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await securityEvent(tx, 'auth.emergency.credential.revoked', credential.emergencyAccountId, {
      compromised,
      authorizedBy: `${actor.kind}:${actor.id}`,
    });
  });
}

export async function disableEmergencyAccount(actor: ControlActor, accountId: string) {
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const ready = await emergencyReadiness(tx);
    if (
      policy.mode === 'SSO_REQUIRED' &&
      ready.some(account => account.id === accountId) &&
      ready.length <= 2
    )
      throw new Error('Verify a replacement emergency identity before disabling this one.');
    await tx.emergencyAccount.update({
      where: { id: accountId },
      data: {
        status: 'DISABLED',
        credentialVersion: { increment: 1 },
        verifiedAt: null,
        verifiedCredentialVersion: null,
      },
    });
    await tx.emergencyCredential.updateMany({
      where: { emergencyAccountId: accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.emergencySession.updateMany({
      where: { emergencyAccountId: accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await securityEvent(tx, 'auth.emergency.disabled', accountId, {
      authorizedBy: `${actor.kind}:${actor.id}`,
    });
  });
}

export async function retireLegacyEmergency(actor: ControlActor) {
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    if ((await emergencyReadiness(tx)).length < 2)
      throw new Error(
        'Verify two independent emergency identities before retiring legacy recovery.'
      );
    await tx.authenticationPolicy.update({
      where: { id: 'default' },
      data: { legacyEmergencyEmail: null, version: { increment: 1 } },
    });
    await tx.emergencySession.updateMany({
      where: { legacyUserId: { not: null }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await securityEvent(tx, 'auth.emergency.legacy.retired', actor.id, {
      originalUserPreserved: true,
    });
  });
}

export async function verifyRegistration(
  actor: ControlActor,
  challengeId: string,
  browserToken: string,
  displayName: string,
  response: RegistrationResponseJSON
) {
  try {
    await verifyRegistrationInternal(actor, challengeId, browserToken, displayName, response);
  } catch (error) {
    await prisma.$transaction(async tx => {
      await securityEvent(
        tx,
        'auth.emergency.credential.enrollment.failed',
        actor.id,
        { authorizedBy: `${actor.kind}:${actor.id}` },
        'failure'
      );
    });
    throw error;
  }
}
