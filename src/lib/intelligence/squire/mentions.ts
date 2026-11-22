import 'server-only';
import prisma from '@/lib/prisma';
import { dashboardUserReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { SquireMentionKind, SquireRequest } from './contract';
import {
  readIncidentForActor,
  resolvePageContext,
  type ReadableIncident,
  type ResolvedPageContext,
} from './deterministic';

export interface ResolvedMention {
  kind: SquireMentionKind;
  id: string;
  name: string;
  incident?: ReadableIncident;
  page?: ResolvedPageContext;
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
    unique.map(mention => resolveMention(actor, mention).catch(() => null))
  );
  return resolved.filter((mention): mention is ResolvedMention => mention !== null);
}

async function resolveMention(
  actor: AuthorizationActor,
  mention: NonNullable<SquireRequest['mentions']>[number]
): Promise<ResolvedMention | null> {
  if (mention.kind === 'incident') {
    const incident = await readIncidentForActor(actor, mention.id);
    return incident ? { kind: 'incident', id: incident.id, name: incident.title, incident } : null;
  }
  if (mention.kind === 'person') {
    // The same visibility the people lookup tool uses; without it the mention is dropped.
    let readable;
    try {
      readable = dashboardUserReadWhere(actor);
    } catch {
      return null;
    }
    const user = await prisma.user.findFirst({
      where: { AND: [{ id: mention.id, status: 'ACTIVE' }, readable] },
      select: { id: true, name: true },
    });
    return user ? { kind: 'person', id: user.id, name: user.name } : null;
  }
  const page = await resolvePageContext(actor, { kind: mention.kind, id: mention.id });
  return page ? { kind: mention.kind, id: page.id, name: page.name, page } : null;
}
