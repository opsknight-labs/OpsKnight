import 'server-only';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../ai/redact';
import { confidentMatch, resolveEntities } from './basic/entities';
import { SQUIRE_LIMITS } from './contract';
import { resolveEntityById, type ResolvedEntity, type SquireEntityKind } from './mentions';

/** Each kind's console path; a postmortem's page is addressed by its incident id. */
const PATHS: Record<SquireEntityKind, string> = {
  incident: 'incidents',
  service: 'services',
  team: 'teams',
  schedule: 'schedules',
  escalation_policy: 'policies',
  runbook: 'runbooks',
  postmortem: 'postmortems',
  alert: 'alerts',
  change: 'changes',
  status_page: 'settings/status-pages',
  person: 'users',
};
/** Probe order for a bare id: the kinds people paste most often first. */
const KINDS = Object.keys(PATHS) as SquireEntityKind[];

/** The words that name each kind in a question. */
const WORDS: Record<SquireEntityKind, string> = {
  incident: 'incidents?',
  service: 'services?',
  team: 'teams?',
  schedule: '(?:on[- ]?call )?schedules?',
  escalation_policy: 'escalation polic(?:y|ies)|(?<!escalation )polic(?:y|ies)',
  runbook: 'runbooks?|playbooks?',
  postmortem: 'post-?mortems?',
  alert: 'alerts?',
  change: 'change events?|changes?|deploy(?:ment)?s?',
  status_page: 'status[- ]pages?',
  person: 'users?|person|people|members?',
};
/** Kinds people name in words ("the payments service"); alerts, changes and people are named by id. */
const NAMED: SquireEntityKind[] = [
  'service',
  'team',
  'schedule',
  'escalation_policy',
  'runbook',
  'postmortem',
  'status_page',
];

export const ENTITY_LABEL: Record<SquireEntityKind, string> = {
  incident: 'incident',
  service: 'service',
  team: 'team',
  schedule: 'schedule',
  escalation_policy: 'escalation policy',
  runbook: 'runbook',
  postmortem: 'postmortem',
  alert: 'alert',
  change: 'change',
  status_page: 'status page',
  person: 'person',
};

export interface EntityRef {
  /** Null for a bare id, which is probed across kinds. */
  kind: SquireEntityKind | null;
  id?: string;
  name?: string;
  /** An incident's short reference as shown in the console ("#ABCDE"), lower case. */
  shortRef?: string;
  /** The text that named it, to remove from the question. */
  raw: string;
}

/* eslint-disable security/detect-non-literal-regexp, security/detect-object-injection -- the patterns below
   are built once from the constant kind tables above, never from user text */
// An id has a digit, so path words such as /services/business or /runbooks/executions never match.
const ID = '(?=[A-Za-z_-]*\\d)[A-Za-z0-9_-]{8,64}';
const URL_REF = new RegExp(`/(${Object.values(PATHS).join('|')})/(${ID})`, 'g');
const KIND_ID = new RegExp(
  `\\b(${KINDS.map(kind => `(?<${kind}>${WORDS[kind]})`).join('|')})\\s*(?:id\\s*)?[:#]?\\s*((?=[a-z]*\\d)[a-z0-9]{20,32})\\b`,
  'gi'
);
const BARE_ID = /\b((?=[a-z]*\d)c[a-z0-9]{20,31})\b/g;
const SHORT_REF = /(?:\bincident\s*#([a-z0-9]{5})|(?:^|\s)#([A-Z0-9]{5}))\b/gi;
const SHORT_REF_BARE = /^[A-Z0-9]{5}$/;
/** Words that start a description, not a name: "this service", "a new team", "which runbook". */
const NOT_A_NAME =
  /^(?:this|that|these|those|my|our|your|their|its|his|her|a|an|the|any|each|every|all|which|what|new|same|current|another|other|one|some|no|default|affected|owning|right|correct|whose)$/;
const LEAD = '(?:the|for|with|of|on|about|in|is|to|from|at|and|show|open|view|describe)';

/** A word of a name: never a lead word, so the name is what follows the last one. */
const WORD = `(?!${LEAD}\\b)[a-z0-9][\\w'-]*`;
/** "The incident service", "an escalation policy": a kind word alone is not a name. */
const KIND_WORD = new RegExp(
  `^(?:${Object.values(WORDS).join('|')}|on[- ]?call|escalation|status)$`,
  'i'
);
const NAME_PATTERNS = NAMED.map(kind => {
  const singular = WORDS[kind].replace(/s\?|\(\?:y\|ies\)/g, m => (m === 's?' ? '' : 'y'));
  return [
    kind,
    [
      // "with the payments worker service": a name follows a lead word, never the start of the question.
      new RegExp(
        `\\b${LEAD}\\s+(?:${LEAD}\\s+)*((?:${WORD}\\s+){0,2}?${WORD})\\s+(?:${singular})\\b(?!['’]s|-)`,
        'gi'
      ),
      // 'runbook "DB failover"', "schedule called Primary"
      new RegExp(
        `\\b(?:${singular})\\s+(?:called\\s+|named\\s+)?["“]([^"”]{2,60})["”]|\\b(?:${singular})\\s+(?:called|named)\\s+([\\w][\\w .'-]{1,60}?)\\s*(?:[?.!,]|$)`,
        'gi'
      ),
    ],
  ] as const;
});
/** "Its incident id", "the service link": words that only point at the record. */
const POINTER = new RegExp(
  `\\b(?:its|it'?s|the|this|an?)\\s+(?:${Object.values(WORDS).join('|')})\\s+(?:id|link|url)\\b.*$`,
  'i'
);
/* eslint-enable security/detect-non-literal-regexp, security/detect-object-injection */

function kindOf(groups: Record<string, string | undefined> | undefined): SquireEntityKind | null {
  // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed kind list
  return KINDS.find(kind => groups?.[kind] !== undefined) ?? null;
}

/**
 * The records a question names: pasted links (full or relative, desktop or mobile), "<kind> <id>",
 * "incident #ABCDE", bare collision-resistant ids, and names next to a kind word ("the payments service",
 * 'runbook "DB failover"'). Nothing is read here; `resolveEntityReferences` applies permissions.
 */
export function detectEntityReferences(message: string): EntityRef[] {
  const text = message.slice(0, 2_000);
  const refs: EntityRef[] = [];
  const seen = new Set<string>();
  const add = (ref: EntityRef) => {
    const key = ref.id ?? ref.shortRef ?? `${ref.kind}:${ref.name?.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const match of text.matchAll(URL_REF)) {
    // eslint-disable-next-line security/detect-object-injection -- entry is a member of the closed kind list
    const kind = KINDS.find(entry => PATHS[entry] === match[1])!;
    add({ kind, id: match[2], raw: match[0] });
  }
  for (const match of text.matchAll(KIND_ID))
    add({ kind: kindOf(match.groups), id: match[match.length - 1], raw: match[0] });
  for (const match of text.matchAll(BARE_ID)) add({ kind: null, id: match[1], raw: match[1] });
  for (const match of text.matchAll(SHORT_REF)) {
    const ref = match[1] ?? match[2];
    // A bare "#ABCDE" counts only in the console's upper-case form with a digit ("#ALERT" is a word);
    // "incident #abcde" in any form.
    if (match[2] && !(SHORT_REF_BARE.test(match[2]) && /\d/.test(match[2]))) continue;
    add({ kind: 'incident', shortRef: ref.toLowerCase(), raw: match[0].trim() });
  }
  // Names are read from the text without links or ids, so a path is never taken for a name.
  const words = text.replace(/\S*\/\S*/g, ' ').replace(BARE_ID, ' ');
  for (const [kind, patterns] of NAME_PATTERNS)
    for (const pattern of patterns)
      for (const match of words.matchAll(pattern)) {
        const name = (match[1] ?? match[2])?.trim();
        if (!name || NOT_A_NAME.test(name.split(/\s+/)[0].toLowerCase()) || KIND_WORD.test(name))
          continue;
        add({ kind, name, raw: match[0].trim() });
      }
  // As many as "@" mentions allow: each one may cost a read per kind.
  return refs.slice(0, SQUIRE_LIMITS.mentionsMax);
}

/** The question with a reference (and phrases that only point at it, "its incident id") removed. */
export function questionWithout(message: string, ref: EntityRef): string {
  return message
    .slice(0, 2_000)
    .replace(/https?:\/\/\S*/gi, ' ')
    .replace(ref.raw, ' ')
    .replace(POINTER, ' ')
    .replace(/\bfrom (?:its|the) (?:url|link)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const contains = (name: string) => ({ contains: name, mode: 'insensitive' as const });

/** Ids of records whose name contains `name`, before permissions; each is then read under them. */
async function idsByName(kind: SquireEntityKind, name: string): Promise<string[]> {
  const select = { id: true } as const;
  const rows =
    kind === 'runbook'
      ? await prisma.runbook.findMany({
          where: { archivedAt: null, name: contains(name) },
          select,
          take: 5,
        })
      : kind === 'escalation_policy'
        ? await prisma.escalationPolicy.findMany({
            where: { name: contains(name) },
            select,
            take: 5,
          })
        : kind === 'status_page'
          ? await prisma.statusPage.findMany({ where: { name: contains(name) }, select, take: 5 })
          : kind === 'postmortem'
            ? await prisma.postmortem.findMany({
                where: { title: contains(name) },
                select,
                take: 5,
              })
            : [];
  return rows.map(row => row.id);
}

async function resolveByName(
  actor: AuthorizationActor,
  kind: SquireEntityKind,
  name: string
): Promise<ResolvedEntity | null> {
  if (kind === 'service' || kind === 'team' || kind === 'schedule' || kind === 'person') {
    const match = confidentMatch(await resolveEntities(actor, name, [kind]), kind);
    return match ? resolveEntityById(actor, kind, match.id) : null;
  }
  const readable = (
    await Promise.all(
      (await idsByName(kind, name)).map(id => resolveEntityById(actor, kind, id).catch(() => null))
    )
  ).filter((row): row is ResolvedEntity => row !== null);
  // One readable match, or the one whose name is exactly what was typed; several is not a guess to make.
  return (
    readable.find(row => row.name.toLowerCase() === name.toLowerCase()) ??
    (readable.length === 1 ? readable[0] : null)
  );
}

/** "#ABCDE": the readable incident whose id ends with it, when exactly one does. */
async function resolveShortRef(actor: AuthorizationActor, ref: string) {
  // shortcut: an unindexed suffix scan over readable incidents; add a stored short reference if it gets slow.
  const rows = await prisma.incident.findMany({
    where: { AND: [{ id: { endsWith: ref } }, incidentReadWhere(actor)] },
    select: { id: true },
    take: 2,
  });
  return rows.length === 1 ? resolveEntityById(actor, 'incident', rows[0].id) : null;
}

/**
 * Each reference read under the person's own permissions, in order; one they cannot read, that does not
 * exist, or whose name is ambiguous resolves to null, so a hidden record is indistinguishable from a missing one.
 */
export async function resolveEntityReferences(
  actor: AuthorizationActor,
  refs: readonly EntityRef[]
): Promise<Array<ResolvedEntity | null>> {
  return Promise.all(
    refs.map(async ref => {
      try {
        if (ref.shortRef) return await resolveShortRef(actor, ref.shortRef);
        if (ref.id && ref.kind) return await resolveEntityById(actor, ref.kind, ref.id);
        if (ref.id) {
          // A bare id: one permission-scoped read per kind, stopping at the first hit.
          for (const kind of KINDS) {
            const found = await resolveEntityById(actor, kind, ref.id).catch(() => null);
            if (found) return found;
          }
          return null;
        }
        return ref.kind && ref.name ? await resolveByName(actor, ref.kind, ref.name) : null;
      } catch {
        return null;
      }
    })
  );
}

/** The console link for a resolved record. */
export function entityLink(entity: ResolvedEntity): string {
  const id = entity.kind === 'postmortem' ? (entity.page?.incidentId ?? entity.id) : entity.id;
  return `/${PATHS[entity.kind]}/${id}`;
}

/**
 * One line per record for the AI prompt: kind, id, name and link. Names are record text, so secrets are
 * redacted and quotes and line breaks removed; people are left out unless their names may be sent.
 */
export function entityHintsForPrompt(
  resolved: ReadonlyArray<ResolvedEntity | null>,
  options: { personal?: boolean } = {}
): string {
  return resolved
    .filter((entity): entity is ResolvedEntity => entity !== null)
    .filter(entity => options.personal || entity.kind !== 'person')
    .map(entity => {
      const name = redactSecrets(entity.name)
        .replace(/["\s]+/g, ' ')
        .trim()
        .slice(0, 120);
      return `- The user referred to the ${ENTITY_LABEL[entity.kind]} "${name}" (id ${entity.id}) ${entityLink(entity)}`;
    })
    .join('\n');
}
