import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { readIncidentForActor } from '../deterministic';
import type { SquireProposal } from './catalog';

export const ACTION_OUTCOME_STATES = [
  'RESERVED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
] as const;
export type SquireActionStatus = (typeof ACTION_OUTCOME_STATES)[number];
export type SquireActionResult =
  | {
      ok: true;
      message: string;
      href: string;
      /** A second, separately confirmed step offered after this one (for example publishing a draft). */
      followUp?: SquireProposal & { href?: string };
    }
  | { ok: false; message: string };
export interface SquireActionOutcome {
  id: string;
  status: SquireActionStatus;
  message: string;
  result?: SquireActionResult;
  updatedAt: string;
}

export const UNKNOWN_ACTION_MESSAGE =
  'The result is unknown. Check the incident before requesting another action; this attempt will not be repeated.';
const followUpSchema = z
  .object({
    token: z.string().min(1).max(8_192),
    receiptId: z.string().uuid().optional(),
    action: z.string().max(64),
    kind: z.enum(['WRITE', 'NAVIGATE']),
    title: z.string().max(200),
    detail: z.string().max(2_000),
    incidentId: z.string().max(64),
    expiresAt: z.string().datetime(),
    href: z.string().startsWith('/').max(256).optional(),
    preview: z
      .array(z.object({ label: z.string().max(64), value: z.string().max(1_000) }).strict())
      .max(10)
      .optional(),
    confirmLabel: z.string().max(40).optional(),
    impact: z.enum(['PAGES_PEOPLE', 'EXTERNAL_SYSTEM', 'PUBLIC', 'AUTOMATION']).optional(),
    step: z.string().max(40).optional(),
  })
  .strict();
const resultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      message: z.string().max(2_000),
      href: z.string().startsWith('/incidents/').max(256),
      followUp: followUpSchema.optional(),
    })
    .strict(),
  z.object({ ok: z.literal(false), message: z.string().max(2_000) }).strict(),
]);

/** Read-only recovery: an opaque id never grants permission to view or repeat an action. */
export async function readSquireActionOutcome(
  actor: AuthorizationActor,
  id: string,
  now: Date = new Date()
): Promise<SquireActionOutcome | null> {
  if (
    actor.apiKey ||
    actor.status !== 'ACTIVE' ||
    !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ) ||
    !z.string().uuid().safeParse(id).success
  )
    return null;
  const receipt = await prisma.squireActionReceipt.findFirst({
    where: { id, userId: actor.id, createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
  });
  if (!receipt?.incidentId || !(await readIncidentForActor(actor, receipt.incidentId))) return null;
  let status = ACTION_OUTCOME_STATES.find(state => state === receipt.status) ?? 'UNKNOWN';
  // A crashed executor cannot leave the UI claiming "still running" forever. This is informational:
  // lookup never changes the receipt, resumes work or authorizes a second mutation.
  if (
    (status === 'RESERVED' || status === 'RUNNING') &&
    now.getTime() - (receipt.startedAt ?? receipt.createdAt).getTime() > 120_000
  )
    status = 'UNKNOWN';
  let result: SquireActionResult | undefined;
  if (receipt.resultEncrypted && (status === 'SUCCEEDED' || status === 'FAILED')) {
    try {
      const parsed = resultSchema.safeParse(JSON.parse(await decrypt(receipt.resultEncrypted)));
      if (parsed.success && parsed.data.ok === (status === 'SUCCEEDED'))
        result = parsed.data as SquireActionResult;
    } catch {
      /* A retired key must not invent an outcome or expose encrypted payloads. */
    }
  }
  const message =
    result?.message ??
    (status === 'SUCCEEDED'
      ? 'The action completed. Open the incident to review the result.'
      : status === 'FAILED'
        ? 'The action did not complete. Review the incident before requesting a new suggestion.'
        : status === 'UNKNOWN'
          ? UNKNOWN_ACTION_MESSAGE
          : 'This action has not reported a result yet. Check its result; do not submit it again.');
  return {
    id,
    status,
    message,
    ...(result ? { result } : {}),
    updatedAt: receipt.updatedAt.toISOString(),
  };
}
