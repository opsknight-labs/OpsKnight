import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSloBurn } from '@/lib/slo/burn';
import { analysisPolicyHash } from '../analysis/contract';
import { RESPONSE_LIMITS } from '../contract';
import { withDbBudget } from '../jobs/db-budget';
import type { ClaimedWorkItem } from '../jobs/work-queue';
import { resolveEffectivePolicy, type IntelligenceSettingsView } from '../settings/service';
import { replaceFindings, type FindingRow } from '../similarity/findings';
import {
  adjustUrgencyForBurn,
  estimateResolution,
  weightedVote,
  type TriagePrecedent,
  type UrgencyValue,
} from './scoring';

export type TriageOutcome =
  'analyzed' | 'skipped_off' | 'skipped_disabled_feature' | 'incident_gone' | 'stale';

export const TRIAGE_FINDING_KINDS = [
  'TRIAGE_URGENCY',
  'TRIAGE_ASSIGNMENT',
  'TRIAGE_DUPLICATE',
  'TRIAGE_RESOLUTION_TIME',
] as const;

const isUrgency = (value: string | null): value is UrgencyValue =>
  value === 'LOW' || value === 'MEDIUM' || value === 'HIGH';

/**
 * Resolved precedents for an incident: its current similar-incident findings joined to the referenced
 * incidents. Only resolved precedents vote; an open precedent has no outcome yet.
 */
async function loadPrecedents(
  tx: Prisma.TransactionClient,
  incidentId: string
): Promise<TriagePrecedent[]> {
  const findings = await tx.intelligenceFinding.findMany({
    where: { incidentId, kind: 'SIMILAR_INCIDENT', status: 'ACTIVE', subjectRef: { not: null } },
    orderBy: { rank: 'asc' },
    take: RESPONSE_LIMITS.triagePrecedents,
    select: { subjectRef: true, confidence: true },
  });
  if (findings.length === 0) return [];
  const rows = await tx.incident.findMany({
    where: { id: { in: findings.map(f => f.subjectRef as string) }, status: 'RESOLVED' },
    select: {
      id: true,
      urgency: true,
      priority: true,
      teamId: true,
      assigneeId: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  return findings.flatMap(finding => {
    const row = byId.get(finding.subjectRef as string);
    if (!row) return [];
    return [
      {
        incidentId: row.id,
        weight: Math.max(0, Math.min(1, finding.confidence)),
        urgency: row.urgency,
        priority: row.priority,
        teamId: row.teamId,
        assigneeId: row.assigneeId,
        resolutionMinutes: row.resolvedAt
          ? Math.max(0, (row.resolvedAt.getTime() - row.createdAt.getTime()) / 60_000)
          : null,
      },
    ];
  });
}

/**
 * Computes triage suggestions for one incident from its resolved precedents and stores them as findings.
 * Suggestions are only ever written; applying one is a responder's decision through the normal incident
 * commands. Gated by the effective policy's `triage.enabled` (off by default).
 */
export async function predictTriage(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation'>,
  settings: IntelligenceSettingsView,
  now: Date = new Date()
): Promise<TriageOutcome> {
  const incidentId = item.subjectKey;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      serviceId: true,
      status: true,
      urgency: true,
      priority: true,
      teamId: true,
      assigneeId: true,
      createdAt: true,
      intelligenceFingerprint: {
        select: { template: true, updatedAt: true, sourceUpdatedAt: true },
      },
    },
  });
  if (!incident) return 'incident_gone';
  const policy = await resolveEffectivePolicy(incident.serviceId);
  if (policy.effectiveMode === 'OFF') return 'skipped_off';
  if (!policy.definition.triage.enabled) return 'skipped_disabled_feature';

  const burn = await getSloBurn(incident.serviceId, now).catch(() => null);
  const burning = burn?.burning ?? false;

  return withDbBudget(settings, async tx => {
    const newest = await tx.intelligenceFinding.aggregate({
      where: { incidentId, kind: { in: [...TRIAGE_FINDING_KINDS] } },
      _max: { generation: true },
    });
    const completed = await tx.intelligenceAnalysisSnapshot.aggregate({
      where: { incidentId, kind: { in: [...TRIAGE_FINDING_KINDS] } },
      _max: { generation: true },
    });
    if (Math.max(newest._max.generation ?? 0, completed._max.generation ?? 0) > item.generation)
      return 'stale' as const;

    const precedents = await loadPrecedents(tx, incidentId);
    const resolvedOrClosed = incident.status === 'RESOLVED';

    // Urgency: a vote among precedents, raised (never lowered) while the service burns its error budget.
    const urgencyRows: FindingRow[] = [];
    const urgencyVote = weightedVote(
      precedents.map(p => ({ value: isUrgency(p.urgency) ? p.urgency : null, weight: p.weight }))
    );
    if (urgencyVote && isUrgency(incident.urgency) && !resolvedOrClosed) {
      const suggested = adjustUrgencyForBurn(urgencyVote.value, incident.urgency, burning);
      if (suggested !== incident.urgency) {
        urgencyRows.push({
          confidence: urgencyVote.confidence,
          subjectRef: suggested,
          evidence: {
            type: 'triage_urgency',
            calibrated: false,
            current: incident.urgency,
            voted: urgencyVote.value,
            share: urgencyVote.share,
            supporters: urgencyVote.supporters,
            voters: urgencyVote.voters,
            sloBurning: burning,
          },
        });
      }
    }

    // Ownership: team or person that resolved the precedents. One suggestion, never both (assignment is exclusive).
    const assignmentRows: FindingRow[] = [];
    if (!resolvedOrClosed && !incident.assigneeId) {
      const owners = precedents.map(p => ({
        value: p.assigneeId ? `user:${p.assigneeId}` : p.teamId ? `team:${p.teamId}` : null,
        weight: p.weight,
      }));
      const vote = weightedVote(owners);
      const current = incident.teamId ? `team:${incident.teamId}` : null;
      if (vote && vote.value !== current) {
        assignmentRows.push({
          confidence: vote.confidence,
          subjectRef: vote.value,
          evidence: {
            type: 'triage_assignment',
            calibrated: false,
            share: vote.share,
            supporters: vote.supporters,
            voters: vote.voters,
            currentTeam: incident.teamId ?? null,
          },
        });
      }
    }

    // Duplicate: an open incident on the same service with the same masked title, opened within the window.
    const duplicateRows: FindingRow[] = [];
    const template = incident.intelligenceFingerprint?.template ?? '';
    if (template && !resolvedOrClosed) {
      const since = new Date(now.getTime() - RESPONSE_LIMITS.duplicateWindowMinutes * 60_000);
      const candidates = await tx.incidentFingerprint.findMany({
        where: {
          serviceId: incident.serviceId,
          template,
          incidentId: { not: incidentId },
          incidentCreatedAt: { gte: since },
          incident: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } },
        },
        orderBy: { incidentCreatedAt: 'desc' },
        take: 3,
        select: { incidentId: true, incidentCreatedAt: true },
      });
      if (candidates.length > 0) {
        const linked = await tx.incidentRelationship.findMany({
          where: {
            OR: candidates.flatMap(c => [
              { sourceIncidentId: incidentId, targetIncidentId: c.incidentId },
              { sourceIncidentId: c.incidentId, targetIncidentId: incidentId },
            ]),
          },
          select: { sourceIncidentId: true, targetIncidentId: true },
        });
        const already = new Set(linked.flatMap(l => [l.sourceIncidentId, l.targetIncidentId]));
        for (const candidate of candidates) {
          if (already.has(candidate.incidentId)) continue;
          const gapMinutes = Math.abs(+incident.createdAt - +candidate.incidentCreatedAt) / 60_000;
          duplicateRows.push({
            confidence: Math.round(Math.min(0.9, 0.9 * Math.exp(-gapMinutes / 240)) * 1000) / 1000,
            subjectRef: candidate.incidentId,
            evidence: {
              type: 'triage_duplicate',
              calibrated: false,
              sameTemplate: true,
              sameService: true,
              gapMinutes: Math.round(gapMinutes),
            },
          });
        }
      }
    }

    // Expected time to resolve: weighted quantiles over resolved precedents.
    const resolutionRows: FindingRow[] = [];
    const estimate = resolvedOrClosed ? null : estimateResolution(precedents);
    if (estimate) {
      resolutionRows.push({
        confidence: estimate.confidence,
        subjectRef: null,
        evidence: {
          type: 'triage_resolution_time',
          calibrated: false,
          expectedMinutes: estimate.expectedMinutes,
          lowMinutes: estimate.lowMinutes,
          highMinutes: estimate.highMinutes,
          samples: estimate.samples,
        },
      });
    }

    const common = {
      incidentId,
      generation: item.generation,
      policyVersion: policy.version,
      policyHash: analysisPolicyHash(policy),
      sourceUpdatedAt: incident.intelligenceFingerprint?.sourceUpdatedAt ?? undefined,
      fingerprintUpdatedAt: incident.intelligenceFingerprint?.updatedAt,
    };
    const results = [
      await replaceFindings(tx, { ...common, kind: 'TRIAGE_URGENCY', rows: urgencyRows }),
      await replaceFindings(tx, { ...common, kind: 'TRIAGE_ASSIGNMENT', rows: assignmentRows }),
      await replaceFindings(tx, { ...common, kind: 'TRIAGE_DUPLICATE', rows: duplicateRows }),
      await replaceFindings(tx, {
        ...common,
        kind: 'TRIAGE_RESOLUTION_TIME',
        rows: resolutionRows,
      }),
    ];
    return results.every(result => result === 'stale') ? 'stale' : 'analyzed';
  });
}
