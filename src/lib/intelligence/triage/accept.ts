import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { updateIncidentUrgencyDomainCommand } from '@/lib/incidents/urgency-command';
import { linkIncidents } from '../correlation/commands';
import { submitFeedback } from '../feedback/service';
import { TRIAGE_FINDING_KINDS } from './predict';

export const triageDecisionSchema = z
  .object({
    findingId: z.string().trim().min(1).max(64),
    decision: z.enum(['ACCEPT', 'DISMISS']),
  })
  .strict();

export type TriageDecisionResult = {
  decision: 'ACCEPT' | 'DISMISS';
  applied: 'urgency' | 'assignment' | 'duplicate' | 'noted' | 'none';
};

function denied(message: string): AppError {
  return new AppError({ code: 'AUTHORIZATION_DENIED', userMessage: message });
}

/**
 * Applies or dismisses one triage suggestion on behalf of a responder. Accepting an urgency or owner
 * suggestion runs the same incident commands as the incident page's own controls (timeline event,
 * engagement reconciliation, war-room message, notification outbox); accepting a duplicate links the
 * incidents through the existing human-link command. Either way the verdict is recorded as feedback,
 * which calibrates future suggestions. Intelligence code never writes incident rows itself: the writes
 * here are the application's domain commands, invoked by a person.
 */
export async function decideTriageSuggestion(
  actor: AuthorizationActor,
  input: unknown
): Promise<TriageDecisionResult> {
  const parsed = triageDecisionSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.map(String).join('.') || 'input',
        message: issue.message,
      })),
    });
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK))
    throw denied('You do not have permission to act on suggestions.');

  const finding = await prisma.intelligenceFinding.findUnique({
    where: { id: parsed.data.findingId },
    select: { id: true, kind: true, status: true, subjectRef: true, incidentId: true },
  });
  if (!finding || !(TRIAGE_FINDING_KINDS as readonly string[]).includes(finding.kind))
    throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const incident = await prisma.incident.findFirst({
    where: { AND: [{ id: finding.incidentId }, incidentReadWhere(actor)] },
    select: { id: true, status: true, urgency: true },
  });
  if (!incident) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });

  const verdict = parsed.data.decision === 'ACCEPT' ? 'HELPFUL' : 'NOT_HELPFUL';
  let applied: TriageDecisionResult['applied'] = 'none';

  if (parsed.data.decision === 'ACCEPT' && finding.status === 'ACTIVE') {
    if (incident.status === 'RESOLVED')
      throw new AppError({
        code: 'PRECONDITION_FAILED',
        userMessage: 'The incident is already resolved.',
      });
    // Applying a suggestion changes the incident: the same permission the incident page's controls require.
    const mayEdit = hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE);
    if (finding.kind === 'TRIAGE_URGENCY') {
      const urgency = finding.subjectRef;
      if (urgency !== 'LOW' && urgency !== 'MEDIUM' && urgency !== 'HIGH')
        throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      if (!mayEdit) throw denied('You do not have permission to change urgency.');
      await updateIncidentUrgencyDomainCommand({
        incidentId: incident.id,
        urgency,
        reason: 'accepted triage suggestion',
      });
      applied = 'urgency';
    } else if (finding.kind === 'TRIAGE_ASSIGNMENT' && finding.subjectRef) {
      if (!mayEdit) throw denied('You do not have permission to reassign incidents.');
      const [type, id] = finding.subjectRef.split(':', 2);
      await assignIncidentDomainCommand({
        incidentId: incident.id,
        assigneeId: type === 'user' ? id : null,
        teamId: type === 'team' ? id : null,
        actor: { id: actor.id },
      });
      applied = 'assignment';
    } else if (finding.kind === 'TRIAGE_DUPLICATE' && finding.subjectRef) {
      await linkIncidents(actor, { incidentId: incident.id, otherIncidentId: finding.subjectRef });
      applied = 'duplicate';
    } else {
      applied = 'noted';
    }
  }

  await submitFeedback(actor, {
    subjectType: 'FINDING',
    subjectId: finding.id,
    verdict,
    ...(parsed.data.decision === 'DISMISS' ? { reasonCode: 'OTHER' } : {}),
  });
  return { decision: parsed.data.decision, applied };
}
