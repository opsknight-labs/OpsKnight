import { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { executeIdempotentOperation, type IdempotencyContext } from '@/lib/idempotency';
import { getBaseUrl } from '@/lib/env-validation';
import { authorizeChatOpsIncident } from './chatops-lifecycle';

export async function executeChatOpsPostmortemCommand(input: {
  incidentId: string;
  actor: { id: string; name: string };
  channelName: string;
  idempotency?: IdempotencyContext;
}) {
  await authorizeChatOpsIncident(input.incidentId, input.actor.id, 'MANAGE');
  const result = await runSerializableTransaction(async tx => {
    const existing = await tx.postmortem.findUnique({
      where: { incidentId: input.incidentId },
      select: { title: true, status: true },
    });
    if (existing)
      return { created: false, title: existing.title, status: existing.status, timelineCount: 0 };
    const incident = await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: { title: true, urgency: true, service: { select: { name: true } } },
    });
    if (!incident) throw new Error('Incident not found');
    const [notes, events] = await Promise.all([
      tx.incidentNote.findMany({
        where: { incidentId: input.incidentId },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      tx.incidentEvent.findMany({
        where: { incidentId: input.incidentId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const timeline = [
      ...events.map(event => ({
        id: `event-${event.id}`,
        timestamp: event.createdAt.toISOString(),
        type:
          event.type === 'ACKNOWLEDGED' || event.type === 'ESCALATED'
            ? 'ESCALATION'
            : event.type === 'MANUAL_RESOLVED' || event.type === 'AUTO_RESOLVED'
              ? 'RESOLUTION'
              : 'DETECTION',
        title: event.message.slice(0, 60),
        description: event.message,
        actor: 'System',
      })),
      ...notes.map(note => ({
        id: `note-${note.id}`,
        timestamp: note.createdAt.toISOString(),
        type: 'MITIGATION',
        title: `Note by ${note.user?.name ?? 'Deleted user'}`,
        description: note.content,
        actor: note.user?.name ?? 'Deleted user',
      })),
    ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const actionItems = notes
      .filter(note => /todo:|action item:|fix:|followup:/i.test(note.content))
      .map(note => ({
        title: note.content.replace(/^(todo:|action item:|fix:|followup:)\s*/i, '').trim(),
        status: 'OPEN',
        priority: 'MEDIUM',
      }));
    const execution = await executeIdempotentOperation(tx, {
      scope: 'chatops-postmortem',
      context: input.idempotency,
      payload: { incidentId: input.incidentId },
      execute: async () => {
        const postmortem = await tx.postmortem.create({
          data: {
            incidentId: input.incidentId,
            title: `Postmortem: ${incident.title}`,
            summary: `Automated postmortem draft generated from Slack war-room #${input.channelName}`,
            impact: { service: incident.service.name, urgency: incident.urgency },
            rootCause: 'TBD — Generated from Slack War Room',
            resolution: `Generated via ChatOps by ${input.actor.name}`,
            lessons: 'Timeline and notes captured from Slack war-room channel.',
            timeline: timeline as Prisma.InputJsonValue,
            actionItems: actionItems as Prisma.InputJsonValue,
            createdById: input.actor.id,
            status: 'DRAFT',
          },
        });
        await tx.incidentEvent.create({
          data: {
            incidentId: input.incidentId,
            message: `Postmortem draft generated via Slack ChatOps by ${input.actor.name}`,
          },
        });
        return {
          created: true,
          title: postmortem.title,
          status: postmortem.status,
          timelineCount: timeline.length,
        };
      },
    });
    return execution.value;
  });
  return { ...result, url: `${getBaseUrl()}/postmortems/${input.incidentId}` };
}
