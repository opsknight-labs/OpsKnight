import 'server-only';
import prisma from '@/lib/prisma';
import { dashboardUserReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { SquireMentionKind, SquireRequest } from './contract';
import {
  readIncidentForActor,
  resolvePageContext,
  type PageContext,
  type ReadableIncident,
  type ResolvedPageContext,
} from './deterministic';

/** Every kind of record Squire can name: the "@" kinds plus the page kinds. */
export type SquireEntityKind = SquireMentionKind | PageContext['kind'];

export interface ResolvedEntity {
  kind: SquireEntityKind;
  id: string;
  name: string;
  incident?: ReadableIncident;
  page?: ResolvedPageContext;
}

export interface ResolvedMention extends ResolvedEntity {
  kind: SquireMentionKind;
}

/**
 * The records picked with "@", each read under the person's own permissions. One they cannot read (or
 * that does not exist) is dropped silently, as an unreadable page is, so mentions cannot probe ids.
 */
export async function resolveMentions(
  actor: AuthorizationActor,
  mentions: SquireRequest['mentions']
): Promise<ResolvedMention[]> {
  const unique = [...new Map((mentions ?? []).map(m => [`${m.kind}:${m.id}`, m])).values()];
  const resolved = await Promise.all(
    unique.map(
      mention =>
        resolveEntityById(actor, mention.kind, mention.id).catch(
          () => null
        ) as Promise<ResolvedMention | null>
    )
  );
  return resolved.filter((mention): mention is ResolvedMention => mention !== null);
}

/** One record of any kind by id, read under the person's own permissions; null when unreadable or unknown. */
export async function resolveEntityById(
  actor: AuthorizationActor,
  kind: SquireEntityKind,
  id: string
): Promise<ResolvedEntity | null> {
  if (kind === 'incident') {
    const incident = await readIncidentForActor(actor, id);
    return incident ? { kind: 'incident', id: incident.id, name: incident.title, incident } : null;
  }
  if (kind === 'person') {
    // The same visibility the people lookup tool uses; without it the mention is dropped.
    let readable;
    try {
      readable = dashboardUserReadWhere(actor);
    } catch {
      return null;
    }
    const user = await prisma.user.findFirst({
      where: { AND: [{ id, status: 'ACTIVE' }, readable] },
      select: { id: true, name: true },
    });
    return user ? { kind: 'person', id: user.id, name: user.name } : null;
  }
  const page = await resolvePageContext(actor, { kind, id });
  return page ? { kind, id: page.id, name: page.name, page } : null;
}
