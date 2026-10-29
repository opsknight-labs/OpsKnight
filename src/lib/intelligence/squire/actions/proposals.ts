import 'server-only';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { incidentReadWhere, runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { readIncidentForActor } from '../deterministic';
import {
  SQUIRE_ACTION_INPUTS,
  SQUIRE_ACTION_KIND,
  isSquireActionName,
  type SquireActionName,
  type SquireProposal,
} from './catalog';

/** A proposal must be confirmed soon after it was made, while the situation it describes still holds. */
export const PROPOSAL_TTL_MS = 10 * 60_000;

interface SealedProposal {
  v: 1;
  id: string;
  action: SquireActionName;
  input: unknown;
  actorId: string;
  exp: number;
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
  now: Date = new Date()
): Promise<(SquireProposal & { href?: string }) | null> {
  if (!isSquireActionName(name)) return null;
  // eslint-disable-next-line security/detect-object-injection -- name was checked by isSquireActionName
  const parsed = SQUIRE_ACTION_INPUTS[name].safeParse(rawInput);
  if (!parsed.success) return null;
  const input = parsed.data as { incidentId: string } & Record<string, unknown>;
  const incident = await readIncidentForActor(actor, input.incidentId);
  if (!incident) return null;

  const described = await describe(actor, name, input, incident);
  if (!described) return null;

  const sealed: SealedProposal = {
    v: 1,
    id: randomUUID(),
    action: name,
    input,
    actorId: actor.id,
    exp: now.getTime() + PROPOSAL_TTL_MS,
  };
  return {
    token: await encrypt(JSON.stringify(sealed)),
    action: name,
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    kind: SQUIRE_ACTION_KIND[name],
    title: described.title,
    detail: described.detail,
    incidentId: incident.id,
    expiresAt: new Date(sealed.exp).toISOString(),
    ...(described.href ? { href: described.href } : {}),
  };
}

async function describe(
  actor: AuthorizationActor,
  name: SquireActionName,
  input: Record<string, unknown>,
  incident: { id: string; title: string; status: string }
): Promise<{ title: string; detail: string; href?: string } | null> {
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
  }
}

export type OpenedProposal = { id: string; action: SquireActionName; input: unknown };

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
  if (sealed?.v !== 1 || typeof sealed.id !== 'string' || !isSquireActionName(sealed.action))
    return null;
  if (sealed.actorId !== actorId || typeof sealed.exp !== 'number' || sealed.exp < now.getTime())
    return null;
  return { id: sealed.id, action: sealed.action, input: sealed.input };
}
