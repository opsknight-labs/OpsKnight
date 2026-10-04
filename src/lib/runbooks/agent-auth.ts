import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getExecutionSigningKey } from './execution-signing';
import { RunbookAgentNotFoundError, RunbookAgentRevokedError } from './errors';

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function agentSignaturePayload(input: {
  method: string;
  pathname: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.pathname,
    input.timestamp,
    input.nonce,
    sha256(input.body),
  ].join('\n');
}

export async function createAgentEnrollment(input: {
  name: string;
  hostname?: string;
  actorId: string;
}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const { publicKey: executionPublicKey } = await getExecutionSigningKey();
  const enrollmentExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const agent = await prisma.runbookAgent.create({
    data: {
      name: input.name,
      hostname: input.hostname,
      status: 'ENROLLING',
      enrollmentTokenHash: sha256(token),
      enrollmentExpiresAt,
      createdById: input.actorId,
    },
  });
  return { agent, token, enrollmentExpiresAt, executionPublicKey };
}

export async function consumeEnrollmentToken(input: {
  token: string;
  publicKey: string;
  hostname?: string;
  version: string;
  platform: string;
}) {
  let publicKey: string;
  try {
    const parsedKey = crypto.createPublicKey(input.publicKey);
    if (
      !input.publicKey.trim().startsWith('-----BEGIN PUBLIC KEY-----') ||
      parsedKey.asymmetricKeyType !== 'ed25519'
    ) {
      throw new Error('Invalid signing key');
    }
    publicKey = parsedKey.export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    throw new Error('A PEM public signing key is required.');
  }
  const tokenHash = sha256(input.token);
  return prisma.$transaction(async tx => {
    const candidate = await tx.runbookAgent.findFirst({
      where: {
        enrollmentTokenHash: tokenHash,
        status: 'ENROLLING',
        enrollmentExpiresAt: { gt: new Date() },
      },
    });
    if (!candidate) throw new Error('Enrollment token is invalid, expired, or already consumed.');
    const updated = await tx.runbookAgent.updateMany({
      where: { id: candidate.id, enrollmentTokenHash: tokenHash, status: 'ENROLLING' },
      data: {
        publicKey,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
        enrolledAt: new Date(),
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        hostname: input.hostname ?? candidate.hostname,
        version: input.version,
        platform: input.platform,
      },
    });
    if (updated.count !== 1) throw new Error('Enrollment token has already been consumed.');
    return tx.runbookAgent.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { id: true, name: true, status: true },
    });
  });
}

export async function authenticateAgentRequest(request: Request, rawBody: string) {
  const agentId = request.headers.get('x-opsknight-agent-id') ?? '';
  const timestamp = request.headers.get('x-opsknight-timestamp') ?? '';
  const nonce = request.headers.get('x-opsknight-nonce') ?? '';
  const signature = request.headers.get('x-opsknight-signature') ?? '';
  if (!agentId || !timestamp || !nonce || !signature || nonce.length > 200) {
    throw new Error('Missing agent authentication headers.');
  }
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > SIGNATURE_WINDOW_MS) {
    throw new Error('Agent request timestamp is outside the allowed window.');
  }
  const agent = await prisma.runbookAgent.findUnique({
    where: { id: agentId },
    select: { id: true, status: true, publicKey: true },
  });
  if (!agent) throw new RunbookAgentNotFoundError(agentId);
  if (agent.status === 'REVOKED') throw new RunbookAgentRevokedError(agentId);
  if (!agent.publicKey) throw new Error('Agent has not completed enrollment.');
  const payload = agentSignaturePayload({
    method: request.method,
    pathname: new URL(request.url).pathname,
    timestamp,
    nonce,
    body: rawBody,
  });
  const valid = crypto.verify(
    null,
    Buffer.from(payload),
    agent.publicKey,
    Buffer.from(signature, 'base64')
  );
  if (!valid) throw new Error('Agent request signature is invalid.');
  await prisma.runbookAgentRequestNonce
    .create({ data: { agentId, nonceHash: sha256(nonce) } })
    .catch(error => {
      if ((error as { code?: string }).code === 'P2002') {
        throw new Error('Agent request replay detected.');
      }
      throw error;
    });
  return agent;
}
