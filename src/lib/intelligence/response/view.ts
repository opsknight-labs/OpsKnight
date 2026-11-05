import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, runbookReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy, resolveEffectivePolicyForRequest } from '../settings/service';

export interface ChangeCauseView {
  findingId: string;
  changeId: string;
  kind: string;
  summary: string;
  source: string;
  version: string | null;
  url: string | null;
  serviceName: string | null;
  occurredAt: Date;
  /** Minutes the change preceded the incident. */
  leadMinutes: number;
  relation: 'SAME_SERVICE' | 'UPSTREAM' | 'GLOBAL';
  confidencePercent: number;
}

export interface UpstreamIncidentView {
  findingId: string;
  incidentId: string;
  title: string;
  status: string;
  serviceName: string;
  leadMinutes: number;
  confidencePercent: number;
}

export interface RunbookRecommendationView {
  findingId: string;
  runbookId: string;
  name: string;
  succeeded: number;
  eligible: number;
  bound: boolean;
}

export interface ResponseIntelligenceView {
  changes: ChangeCauseView[];
  upstreamIncidents: UpstreamIncidentView[];
  runbooks: RunbookRecommendationView[];
}

const MAX_PER_SECTION = 5;

type Evidence = Record<string, unknown>;
const asEvidence = (value: unknown): Evidence =>
  value && typeof value === 'object' ? (value as Evidence) : {};
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function relationOf(value: unknown): ChangeCauseView['relation'] {
  return value === 'SAME_SERVICE' || value === 'UPSTREAM' ? value : 'GLOBAL';
}

/**
 * Probable causes and runbook recommendations for one incident, as the actor may see them.
 * Returns null when nothing should be shown: no capability, incident not visible, policy not in a
 * visible mode (SHADOW only records), or no findings. Every referenced change, incident and runbook
 * is filtered through the viewer's own read rules, so a finding can never reveal what they cannot read.
 */
export async function getResponseIntelligenceForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<ResponseIntelligenceView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let incidentReadable: ReturnType<typeof incidentReadWhere>;
  try {
    incidentReadable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const source = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, incidentReadable] },
    select: { serviceId: true },
  });
  if (!source) return null;

  // Deduplicated per request: an incident page renders several cards that all need the same policy.
  const policy =
    client === prisma
      ? await resolveEffectivePolicyForRequest(source.serviceId)
      : await resolveEffectivePolicy(source.serviceId, client);
  if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') return null;
  if (!policy.definition.response.enabled) return null;

  const findings = await client.intelligenceFinding.findMany({
    where: {
      incidentId,
      status: 'ACTIVE',
      kind: { in: ['CHANGE_CORRELATION', 'PROBABLE_CAUSE', 'RUNBOOK_RECOMMENDATION'] },
      subjectRef: { not: null },
    },
    orderBy: [{ kind: 'asc' }, { rank: 'asc' }],
    take: MAX_PER_SECTION * 6,
    select: { id: true, kind: true, confidence: true, subjectRef: true, evidence: true },
  });
  if (findings.length === 0) return null;
  const refs = (kind: string) => findings.filter(f => f.kind === kind);

  const changeFindings = refs('CHANGE_CORRELATION');
  const causeFindings = refs('PROBABLE_CAUSE');
  const runbookFindings = refs('RUNBOOK_RECOMMENDATION');

  let serviceReadable: ReturnType<typeof serviceReadWhere> | null = null;
  try {
    serviceReadable = serviceReadWhere(actor);
  } catch {
    serviceReadable = null;
  }
  let runbookReadable: ReturnType<typeof runbookReadWhere> | null = null;
  try {
    runbookReadable = runbookReadWhere(actor);
  } catch {
    runbookReadable = null;
  }

  const [changeRows, incidentRows, runbookRows] = await Promise.all([
    changeFindings.length === 0 || !serviceReadable
      ? []
      : client.changeEvent.findMany({
          where: {
            id: { in: changeFindings.map(f => f.subjectRef as string) },
            // A global scope is an empty filter; say so explicitly rather than rely on `{ service: {} }`.
            ...(Object.keys(serviceReadable).length === 0
              ? {}
              : { OR: [{ serviceId: null }, { service: serviceReadable }] }),
          },
          select: {
            id: true,
            kind: true,
            summary: true,
            source: true,
            version: true,
            url: true,
            occurredAt: true,
            service: { select: { name: true } },
          },
        }),
    causeFindings.length === 0
      ? []
      : client.incident.findMany({
          where: {
            AND: [{ id: { in: causeFindings.map(f => f.subjectRef as string) } }, incidentReadable],
          },
          select: { id: true, title: true, status: true, service: { select: { name: true } } },
        }),
    runbookFindings.length === 0 || !runbookReadable
      ? []
      : client.runbook.findMany({
          where: {
            AND: [
              { id: { in: runbookFindings.map(f => f.subjectRef as string) } },
              runbookReadable,
            ],
          },
          select: { id: true, name: true },
        }),
  ]);

  const changeById = new Map(changeRows.map(row => [row.id, row]));
  const incidentById = new Map(incidentRows.map(row => [row.id, row]));
  const runbookById = new Map(runbookRows.map(row => [row.id, row]));

  const changes: ChangeCauseView[] = [];
  for (const finding of changeFindings) {
    const change = changeById.get(finding.subjectRef as string);
    if (!change) continue;
    const evidence = asEvidence(finding.evidence);
    changes.push({
      findingId: finding.id,
      changeId: change.id,
      kind: change.kind,
      summary: change.summary,
      source: change.source,
      version: change.version,
      url: change.url,
      serviceName: change.service?.name ?? null,
      occurredAt: change.occurredAt,
      leadMinutes: Math.max(0, Math.round(num(evidence.leadSeconds) / 60)),
      relation: relationOf(evidence.relation),
      confidencePercent: Math.round(finding.confidence * 100),
    });
    if (changes.length === MAX_PER_SECTION) break;
  }

  const upstreamIncidents: UpstreamIncidentView[] = [];
  for (const finding of causeFindings) {
    const other = incidentById.get(finding.subjectRef as string);
    if (!other) continue;
    upstreamIncidents.push({
      findingId: finding.id,
      incidentId: other.id,
      title: other.title,
      status: other.status,
      serviceName: other.service.name,
      leadMinutes: Math.max(0, Math.round(num(asEvidence(finding.evidence).leadSeconds) / 60)),
      confidencePercent: Math.round(finding.confidence * 100),
    });
    if (upstreamIncidents.length === MAX_PER_SECTION) break;
  }

  const runbooks: RunbookRecommendationView[] = [];
  for (const finding of runbookFindings) {
    const runbook = runbookById.get(finding.subjectRef as string);
    if (!runbook) continue;
    const evidence = asEvidence(finding.evidence);
    runbooks.push({
      findingId: finding.id,
      runbookId: runbook.id,
      name: runbook.name,
      succeeded: num(evidence.succeeded),
      eligible: num(evidence.eligible),
      bound: evidence.bound === true,
    });
    if (runbooks.length === MAX_PER_SECTION) break;
  }

  if (changes.length + upstreamIncidents.length + runbooks.length === 0) return null;
  return { changes, upstreamIncidents, runbooks };
}
