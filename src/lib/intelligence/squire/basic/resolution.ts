import 'server-only';
import prisma from '@/lib/prisma';
import { runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../../ai/redact';
import type { ReadableIncident } from '../deterministic';
import type { EvidenceSnapshot } from '../evidence';
import { formatWhen } from './reads';

const clean = (value: string, max = 400) =>
  redactSecrets(value).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * "How was this fixed?": what responders recorded on an incident the person can already read — the
 * resolution note ("Resolution: …" notes), the other notes, and runbook runs on runbooks they may read.
 */
export async function howFixedAnswer(
  actor: AuthorizationActor,
  incident: ReadableIncident,
  timeZone: string,
  collect?: (source: EvidenceSnapshot) => void
): Promise<string> {
  collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  // Runbook runs only on runbooks the person may read; a role without runbook access sees none.
  let readable: ReturnType<typeof runbookReadWhere> | null = null;
  try {
    readable = runbookReadWhere(actor);
  } catch {
    // No runbook access: the runs are left out.
  }
  const [detail, notes, runs] = await Promise.all([
    prisma.incident.findUnique({ where: { id: incident.id }, select: { resolvedAt: true } }),
    prisma.incidentNote.findMany({
      where: { incidentId: incident.id },
      // The latest 20, so a long incident still shows its resolution note.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: { content: true, createdAt: true, user: { select: { name: true } } },
    }),
    readable
      ? prisma.runbookExecution.findMany({
          where: { incidentId: incident.id, runbook: readable },
          orderBy: { createdAt: 'asc' },
          take: 5,
          select: { status: true, createdAt: true, runbook: { select: { name: true } } },
        })
      : [],
  ]);
  notes.reverse();
  const resolution = notes.findLast(note => /^resolution:/i.test(note.content.trim()));
  const others = notes.filter(note => note !== resolution).slice(-8);
  const when = (at: Date) => formatWhen(at, timeZone);
  const resolved = incident.status === 'RESOLVED';
  const lines = [
    `## How ${clean(incident.title, 160)} was ${resolved ? 'fixed' : 'handled so far'}`,
    resolved
      ? `Resolved${detail?.resolvedAt ? ` ${when(detail.resolvedAt)}` : ''}.`
      : `It is not resolved yet (${incident.status.toLowerCase()}); this is what is recorded so far.`,
    resolution
      ? `**Recorded resolution:** ${clean(resolution.content.trim().replace(/^resolution:\s*/i, ''))}`
      : resolved
        ? 'No resolution note was recorded.'
        : '',
    others.length
      ? `### Notes\n${others.map(note => `- ${when(note.createdAt)}${note.user?.name ? ` (${clean(note.user.name, 80)})` : ''}: ${clean(note.content)}`).join('\n')}`
      : '',
    runs.length
      ? `### Runbook runs\n${runs.map(run => `- ${clean(run.runbook.name, 120)}: ${run.status.toLowerCase().replace(/_/g, ' ')} (${when(run.createdAt)})`).join('\n')}`
      : '',
    !resolution && !others.length && !runs.length
      ? 'No notes or runbook runs are recorded on it.'
      : '',
    `/incidents/${incident.id}`,
    'This is what responders recorded, not a verified root cause.',
  ];
  return lines.filter(Boolean).join('\n\n');
}
