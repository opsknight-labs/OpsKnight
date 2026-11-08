import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { incidentReadWhere, runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { readIncidentForActor } from '../deterministic';
import { describeServiceFact } from '../tools-knowledge';
import {
  SQUIRE_ACTION_INPUTS,
  SQUIRE_ACTION_KIND,
  SNAPSHOT_FREE_ACTIONS,
  isSquireActionName,
  type SquireActionName,
  type SquireProposal,
} from './catalog';
import { isExtendedSquireAction } from './catalog-extended';
import {
  describeExtended,
  extendedActionsAvailable,
  extendedSnapshot,
  type ExtendedDescription,
} from './extended';

/** A proposal must be confirmed soon after it was made, while the situation it describes still holds. */
export const PROPOSAL_TTL_MS = 10 * 60_000;

const preconditionsSchema = z
  .object({
    incident: z
      .object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']),
        escalationGeneration: z.number().int().nonnegative(),
        assigneeId: z.string().nullable(),
        teamId: z.string().nullable(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
    relationship: z
      .object({ id: z.string(), updatedAt: z.string().datetime() })
      .strict()
      .nullable()
      .optional(),
    // Extended actions: the facts the card was built on (extended.ts), re-read before executing.
    extra: z
      .record(z.string().max(64), z.union([z.string().max(256), z.number(), z.boolean(), z.null()]))
      .optional(),
  })
  .strict();
export type SquireProposalPreconditions = z.infer<typeof preconditionsSchema>;

interface SealedProposal {
  v: 1;
  id: string;
  action: SquireActionName;
  input: unknown;
  actorId: string;
  exp: number;
  preconditions?: SquireProposalPreconditions;
}

const short = (text: string, max = 120) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Turns a model's tool call into a proposal card, or null when it is not something this person could do or
 * see. Nothing is executed here. The payload is sealed with the application's authenticated encryption, so
 * the browser can hand it back on confirmation but cannot read, alter or forge one, and it names the
 * person it was made for and when it expires.
 */
export async function buildProposal(
  actor: AuthorizationActor,
  name: string,
  rawInput: unknown,
  now: Date = new Date(),
  options: { followUp?: boolean } = {}
): Promise<(SquireProposal & { href?: string }) | null> {
  if (!isSquireActionName(name)) return null;
  // Extended actions are opt-in, never for API keys, and some exist only as a second step.
  if (isExtendedSquireAction(name) && !(await extendedActionsAvailable(actor, name, options)))
    return null;
  // eslint-disable-next-line security/detect-object-injection -- name was checked by isSquireActionName
  const parsed = SQUIRE_ACTION_INPUTS[name].safeParse(rawInput);
  if (!parsed.success) return null;
  const input = parsed.data as { incidentId: string } & Record<string, unknown>;
  const incident = await readIncidentForActor(actor, input.incidentId);
  if (!incident) return null;

  const described = await describe(actor, name, input, incident, now);
  if (!described) return null;

  let preconditions: SquireProposalPreconditions | undefined;
  // eslint-disable-next-line security/detect-object-injection -- name was checked against the closed action union
  if (SQUIRE_ACTION_KIND[name] === 'WRITE' && !SNAPSHOT_FREE_ACTIONS.has(name)) {
    const snapshot = await prisma.incident.findFirst({
      where: { AND: [{ id: incident.id }, incidentReadWhere(actor)] },
      select: {
        status: true,
        escalationGeneration: true,
        assigneeId: true,
        teamId: true,
        updatedAt: true,
      },
    });
    if (!snapshot || snapshot.status !== incident.status) return null;
    preconditions = { incident: { ...snapshot, updatedAt: snapshot.updatedAt.toISOString() } };
    if (name === 'link_related_incident') {
      const other = String(input.otherIncidentId);
      const relationship = await prisma.incidentRelationship.findFirst({
        where: {
          type: 'RELATED',
          OR: [
            { sourceIncidentId: incident.id, targetIncidentId: other },
            { sourceIncidentId: other, targetIncidentId: incident.id },
          ],
        },
        select: { id: true, updatedAt: true },
      });
      preconditions.relationship = relationship
        ? { id: relationship.id, updatedAt: relationship.updatedAt.toISOString() }
        : null;
    }
    if (isExtendedSquireAction(name)) {
      const extra = await extendedSnapshot(prisma, actor, name, input, incident.id);
      if (!extra) return null;
      preconditions.extra = extra;
    }
  }

  const sealed: SealedProposal = {
    v: 1,
    id: randomUUID(),
    action: name,
    input,
    actorId: actor.id,
    exp: now.getTime() + PROPOSAL_TTL_MS,
    ...(preconditions ? { preconditions } : {}),
  };
  return {
    token: await encrypt(JSON.stringify(sealed)),
    receiptId: sealed.id,
    action: name,
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    kind: SQUIRE_ACTION_KIND[name],
    title: described.title,
    detail: described.detail,
    incidentId: incident.id,
    expiresAt: new Date(sealed.exp).toISOString(),
    ...(described.href ? { href: described.href } : {}),
    ...('preview' in described && described.preview ? { preview: described.preview } : {}),
    ...('confirmLabel' in described && described.confirmLabel
      ? { confirmLabel: described.confirmLabel }
      : {}),
    ...('impact' in described && described.impact ? { impact: described.impact } : {}),
    ...('step' in described && described.step ? { step: described.step } : {}),
  };
}

async function describe(
  actor: AuthorizationActor,
  name: SquireActionName,
  input: Record<string, unknown>,
  incident: { id: string; title: string; status: string; urgency?: string },
  now: Date
): Promise<{ title: string; detail: string; href?: string } | ExtendedDescription | null> {
  const subject = `“${short(incident.title, 80)}”`;
  switch (name) {
    case 'acknowledge_incident':
      if (incident.status !== 'OPEN') return null;
      return {
        title: 'Acknowledge incident',
        detail: `Acknowledge ${subject}. Escalation stops for this incident.`,
      };
    case 'resolve_incident':
      if (incident.status === 'RESOLVED') return null;
      return {
        title: 'Resolve incident',
        detail: `Resolve ${subject} with the note: ${short(String(input.resolution), 300)}`,
      };
    case 'add_incident_note':
      return {
        title: 'Add a note',
        detail: `Add to the timeline of ${subject}: ${short(String(input.content), 300)}`,
      };
    case 'reassign_incident': {
      const person = await prisma.user.findFirst({
        where: { id: String(input.assigneeId), status: 'ACTIVE' },
        select: { name: true, email: true },
      });
      if (!person) return null;
      return {
        title: 'Reassign incident',
        detail: `Assign ${subject} to ${person.name || person.email}.`,
      };
    }
    case 'link_related_incident': {
      if (input.otherIncidentId === incident.id) return null;
      const other = await prisma.incident.findFirst({
        where: { AND: [{ id: String(input.otherIncidentId) }, incidentReadWhere(actor)] },
        select: { title: true },
      });
      if (!other) return null;
      return {
        title: 'Mark as related',
        detail: `Mark ${subject} as related to “${short(other.title, 80)}”.`,
      };
    }
    case 'open_runbook': {
      let readable;
      try {
        readable = runbookReadWhere(actor);
      } catch {
        return null;
      }
      const runbook = await prisma.runbook.findFirst({
        where: { AND: [{ id: String(input.runbookId) }, readable] },
        select: { name: true },
      });
      if (!runbook) return null;
      return {
        title: 'Open runbook',
        detail: `Open “${short(runbook.name, 80)}” to run it against ${subject}. You review inputs and approvals there.`,
        href: `/incidents/${encodeURIComponent(incident.id)}?tab=runbooks`,
      };
    }
    case 'draft_postmortem':
      return {
        title: 'Draft the postmortem',
        detail: `Open the postmortem for ${subject}, where “Draft with AI” fills in what is still empty.`,
        href: `/postmortems/${encodeURIComponent(incident.id)}`,
      };
    case 'learn_service_fact':
      return describeServiceFact(actor, incident.id, String(input.fact));
    default:
      return describeExtended(actor, name, input, incident, now);
  }
}

export type OpenedProposal = {
  id: string;
  action: SquireActionName;
  input: unknown;
  preconditions?: SquireProposalPreconditions;
};

/** Opens a sealed proposal for the person confirming it; null if it is malformed, someone else's or expired. */
export async function openProposal(
  token: string,
  actorId: string,
  now: Date = new Date()
): Promise<OpenedProposal | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 8_192) return null;
  let sealed: SealedProposal;
  try {
    sealed = JSON.parse(await decrypt(token)) as SealedProposal;
  } catch {
    return null;
  }
  if (
    sealed?.v !== 1 ||
    !z.string().uuid().safeParse(sealed.id).success ||
    !isSquireActionName(sealed.action)
  )
    return null;
  if (
    sealed.actorId !== actorId ||
    typeof sealed.exp !== 'number' ||
    !Number.isFinite(sealed.exp) ||
    sealed.exp <= now.getTime()
  )
    return null;
  const preconditions =
    sealed.preconditions === undefined
      ? undefined
      : preconditionsSchema.safeParse(sealed.preconditions);
  if (preconditions && !preconditions.success) return null;
  return {
    id: sealed.id,
    action: sealed.action,
    input: sealed.input,
    ...(preconditions?.success ? { preconditions: preconditions.data } : {}),
  };
}
