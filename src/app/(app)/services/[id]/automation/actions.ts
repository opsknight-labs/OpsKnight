'use server';
import { getAutomationSettings } from '@/lib/automation/settings';
import { readAutomationReadiness } from '@/lib/automation/readiness';
import { candidateEvidenceFreshness } from '@/lib/automation/evidence-freshness';
import { decodeExplanation } from '@/lib/automation/explanation';
import { z, ZodError } from 'zod';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { assertAutomationAccess } from '@/lib/automation/access';
import {
  saveDraft,
  publishVersion,
  changeMode,
  activateCandidate,
  discardCandidate,
  AutomationConflict,
} from '@/lib/automation/versioning';
import { emptySnapshot, snapshotSchema } from '@/lib/automation/contract';
import { automationEnabled } from '@/lib/automation/runtime';
import { compileAutomation } from '@/lib/automation/compiler';
import { discoverFields } from '@/lib/automation/discovery';
import {
  assertAutomationPayloadSize,
  validateAutomationSnapshot,
  simulateAutomationSnapshot,
  restoreAutomationDraft,
} from '@/lib/automation/authoring';
import { automationSimulationEventSchema as eventSchema } from '@/lib/automation/authoring-contract';
import { readAutomationVersion } from '@/lib/automation/history';
import { hasCapability } from '@/lib/authorization';
import { normalizeValue } from '@/lib/automation/context/normalize';
const id = z.string().min(1).max(100);
const actionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('restoreDraft'),
      serviceId: id,
      sourceVersionId: id,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('save'),
      serviceId: id,
      snapshot: snapshotSchema,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      serviceId: id,
      expectedRevision: z.number().int().nonnegative(),
      expectedActiveVersionId: id.nullable(),
      expectedCandidateVersionId: id.nullable().optional(),
      sourceVersionId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('activateCandidate'),
      serviceId: id,
      expectedCandidateVersionId: id,
      expectedActiveVersionId: id.nullable().optional(),
      expectedReadinessPolicyRevision: z.number().int().nonnegative().optional(),
      acknowledgeNoShadow: z.boolean().optional(),
      acknowledgeShadowErrors: z.boolean().optional(),
      acknowledgeMaterialDifferences: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('discardCandidate'),
      serviceId: id,
      expectedCandidateVersionId: id,
    })
    .strict(),
  z
    .object({
      action: z.literal('mode'),
      serviceId: id,
      mode: z.enum(['DISABLED', 'SHADOW', 'LIVE']),
      acknowledgeNoShadow: z.boolean().optional(),
      acknowledgeShadowErrors: z.boolean().optional(),
      expectedActiveVersionId: id.nullable(),
    })
    .strict(),
  z.object({ action: z.literal('lint'), serviceId: id, snapshot: snapshotSchema }).strict(),
  z.object({ action: z.literal('discover'), serviceId: id, sample: z.unknown() }).strict(),
  z.object({ action: z.literal('discoverRecent'), serviceId: id }).strict(),
  z
    .object({
      action: z.literal('test'),
      serviceId: id,
      snapshot: snapshotSchema,
      event: eventSchema,
      providerPayload: z.unknown(),
      integrationType: z.string().min(1).max(64),
      integrationId: id.optional(),
      evaluationAt: z.string().datetime().optional(),
    })
    .strict(),
]);
export async function automationAction(raw: unknown) {
  try {
    assertAutomationPayloadSize(raw);
    const input = actionSchema.parse(raw);
    const capability =
      input.action === 'save' || input.action === 'restoreDraft'
        ? 'automation.edit'
        : ['publish', 'mode', 'activateCandidate', 'discardCandidate'].includes(input.action)
          ? 'automation.publish'
          : 'automation.read';
    const user = await assertAutomationAccess(input.serviceId, capability);
    if (input.action === 'restoreDraft')
      return {
        ok: true as const,
        data: await restoreAutomationDraft({ ...input, actorId: user.id }),
      };
    if (input.action === 'save')
      return { ok: true as const, data: await saveDraft({ ...input, actorId: user.id }) };
    if (input.action === 'publish')
      return { ok: true as const, data: await publishVersion({ ...input, actorId: user.id }) };
    if (input.action === 'activateCandidate')
      return { ok: true as const, data: await activateCandidate({ ...input, actorId: user.id }) };
    if (input.action === 'discardCandidate')
      return { ok: true as const, data: await discardCandidate({ ...input, actorId: user.id }) };
    if (input.action === 'mode')
      return { ok: true as const, data: await changeMode({ ...input, actorId: user.id }) };
    if (input.action === 'lint')
      return {
        ok: true as const,
        data: await prisma.$transaction(tx =>
          validateAutomationSnapshot(tx, input.serviceId, input.snapshot)
        ),
      };
    if (input.action === 'discoverRecent') {
      if (!hasCapability(user.role, 'incident.sensitive.read'))
        throw new Error('Sensitive incident access is required to discover recent alert values');
      const alerts = await prisma.alert.findMany({
        where: { serviceId: input.serviceId },
        select: { payload: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const suggestions = new Map<
        string,
        {
          key: string;
          path: string;
          value: string;
          type: string;
          unmapped: boolean;
          frequency: number;
          examples: string[];
          source: 'EVENT';
        }
      >();
      for (const alert of alerts) {
        for (const field of discoverFields({ payload: alert.payload })) {
          const prior = suggestions.get(field.path);
          suggestions.set(field.path, {
            ...field,
            source: 'EVENT' as const,
            frequency: (prior?.frequency ?? 0) + 1,
            examples: [...new Set([...(prior?.examples ?? []), field.value])].slice(0, 3),
          });
        }
      }
      const ranked = [...suggestions.values()]
        .sort(
          (a, b) =>
            Number(/environment|service|team|region|account|cluster|namespace/i.test(b.path)) -
              Number(/environment|service|team|region|account|cluster|namespace/i.test(a.path)) ||
            b.frequency - a.frequency
        )
        .slice(0, 64);
      return { ok: true as const, data: ranked };
    }
    if (input.action === 'discover')
      return { ok: true as const, data: discoverFields(input.sample) };
    return {
      ok: true as const,
      data: await prisma.$transaction(tx =>
        simulateAutomationSnapshot(tx, {
          ...input,
          event: input.event,
          providerPayload: input.providerPayload,
          evaluationAt: input.evaluationAt ?? new Date().toISOString(),
        })
      ),
    };
  } catch (error) {
    return automationFailure(error);
  }
}
export type AutomationActionFailure = {
  ok: false;
  code: 'CONFLICT' | 'FORBIDDEN' | 'VALIDATION' | 'REJECTED' | 'UNEXPECTED';
  conflict: boolean;
  error: string;
};
function automationFailure(error: unknown): AutomationActionFailure {
  const fail = (code: AutomationActionFailure['code'], message: string) => ({
    ok: false as const,
    code,
    conflict: code === 'CONFLICT',
    error: message,
  });
  if (error instanceof AutomationConflict) return fail('CONFLICT', error.message);
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return fail(
      'VALIDATION',
      issue
        ? `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
        : 'Automation request is invalid'
    );
  }
  if (error instanceof AppError) {
    const denied = ['AUTHORIZATION_DENIED', 'AUTHENTICATION_REQUIRED'].includes(error.code);
    return fail(
      denied ? 'FORBIDDEN' : 'REJECTED',
      error.exposure === 'public' ? error.userMessage : 'Automation request failed'
    );
  }
  // Domain guards throw plain Errors with user-facing text; anything else is internal.
  if (error instanceof Error && error.constructor === Error) {
    if (error.message === 'VERSION_INVALID')
      return fail(
        'REJECTED',
        'The active version failed integrity validation. Publish a new version and try again.'
      );
    if (error.message.startsWith('Transaction failed after'))
      return fail('REJECTED', 'Automation is busy with another change. Try again.');
    return fail('REJECTED', error.message);
  }
  logger.error('automation.action.failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return fail('UNEXPECTED', 'Automation request failed. Try again.');
}
export async function getAutomationArea(
  serviceIdRaw: string,
  areaRaw: string = 'overview',
  pageRaw: number = 1
) {
  const serviceId = id.parse(serviceIdRaw),
    area = z.enum(['overview', 'context', 'rules', 'test', 'activity', 'trace']).parse(areaRaw);
  const page = z.number().int().min(1).max(10000).parse(pageRaw);
  const user = await assertAutomationAccess(serviceId, 'automation.read');
  const canReadSensitive = hasCapability(user.role, 'incident.sensitive.read');
  let canEdit = false;
  try {
    await assertAutomationAccess(serviceId, 'automation.edit');
    canEdit = true;
  } catch {
    /* Read-only role or service ownership does not grant editing. */
  }
  const config = await prisma.serviceAutomationConfig.findUnique({
    where: { serviceId },
    select: { mode: true, activeVersionId: true, candidateVersionId: true, updatedAt: true },
  });
  const draftRevision = await prisma.automationDraft.findUnique({
    where: { serviceId },
    select: { revision: true },
  });
  const draft = ['context', 'rules', 'test'].includes(area)
    ? await prisma.automationDraft.findUnique({ where: { serviceId } })
    : null;
  const versions =
    area === 'activity'
      ? await prisma.automationVersion.findMany({
          where: { serviceId },
          orderBy: { versionNumber: 'desc' },
          take: 20,
          skip: (page - 1) * 20,
          select: {
            id: true,
            versionNumber: true,
            publishedAt: true,
            publishedBy: true,
            checksum: true,
            sourceVersionId: true,
          },
        })
      : [];
  const versionTotal =
    area === 'activity' ? await prisma.automationVersion.count({ where: { serviceId } }) : 0;
  const observations =
    area === 'context'
      ? await prisma.automationContextObservation.findMany({
          where: { serviceId },
          select: {
            id: true,
            serviceId: true,
            integrationId: true,
            integrationType: true,
            fieldKey: true,
            sourcePath: true,
            fieldType: true,
            rawValuePreview: true,
            count: true,
            unmapped: true,
            firstSeenAt: true,
            lastSeenAt: true,
          },
          orderBy: { lastSeenAt: 'desc' },
          take: 200,
        })
      : [];
  const aggregates = ['overview', 'rules'].includes(area)
    ? await prisma.automationShadowAggregate.findMany({
        where: {
          serviceId,
          versionId: config?.activeVersionId ?? '__no_active_version__',
          bucketDate: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        take: 100,
        orderBy: { bucketDate: 'desc' },
      })
    : [];
  const traces = ['overview', 'trace'].includes(area)
    ? await prisma.automationTrace.findMany({
        where: { serviceId },
        orderBy: { evaluationAt: 'desc' },
        take: 25,
      })
    : [];
  const policies = ['rules', 'test'].includes(area)
    ? await prisma.escalationPolicy.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];
  const slack = ['rules', 'test'].includes(area)
    ? await prisma.slackDestination.findMany({
        where: { serviceId, enabled: true },
        select: { id: true, channelName: true },
      })
    : [];
  const teams = ['rules', 'test'].includes(area)
    ? await prisma.microsoftTeamsDestination.findMany({
        where: { serviceId, enabled: true },
        select: { id: true, channelName: true },
      })
    : [];
  const integrations = ['context', 'test'].includes(area)
    ? await prisma.integration.findMany({
        where: { serviceId },
        select: { id: true, name: true, type: true },
      })
    : [];
  const rawAlerts =
    area === 'test' && canReadSensitive
      ? await prisma.alert.findMany({
          where: { serviceId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, payload: true, createdAt: true, dedupKey: true },
          take: 20,
        })
      : [];
  const alerts = rawAlerts.map(alert => {
    const payload = alert.payload as Record<string, unknown> | null;
    const sourceStr = typeof payload?.source === 'string' ? payload.source.toLowerCase() : '';
    const matched =
      integrations.find(i => alert.dedupKey?.startsWith(i.id + ':') || alert.dedupKey === i.id) ??
      integrations.find(
        i =>
          sourceStr &&
          (i.type.toLowerCase() === sourceStr || i.name.toLowerCase().includes(sourceStr))
      );
    return {
      id: alert.id,
      payload: alert.payload,
      createdAt: alert.createdAt,
      dedupKey: alert.dedupKey,
      integrationId: matched?.id ?? null,
      integrationType: matched?.type ?? null,
      providerSample: null,
      replayMode: 'NORMALIZED_ONLY' as const,
    };
  });
  const activeVersion = config?.activeVersionId
    ? await prisma.automationVersion.findUnique({
        where: { id: config.activeVersionId },
        select: {
          id: true,
          versionNumber: true,
          publishedAt: true,
          publishedBy: true,
          lintReport: true,
          snapshot: true,
        },
      })
    : null;
  const candidateVersion = config?.candidateVersionId
    ? await prisma.automationVersion.findUnique({
        where: { id: config.candidateVersionId },
        select: {
          id: true,
          versionNumber: true,
          publishedAt: true,
          publishedBy: true,
          checksum: true,
          lintReport: true,
          snapshot: true,
        },
      })
    : null;
  const candidateAggregates = config?.candidateVersionId
    ? await prisma.automationShadowAggregate.findMany({
        where: {
          serviceId,
          versionId: config.candidateVersionId,
          bucketDate: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        take: 100,
        orderBy: { bucketDate: 'desc' },
      })
    : [];
  let unmappedCount = 0;
  if (area === 'overview' && activeVersion) {
    const parsed = snapshotSchema.safeParse(activeVersion.snapshot);
    if (!parsed.success)
      throw new Error(`Version ${activeVersion.versionNumber} failed integrity validation`);
    const fields = compileAutomation(parsed.data).compiled.fields;
    const observedValues = await prisma.automationContextObservation.findMany({
      where: { serviceId },
      take: 5000,
      select: { fieldKey: true, rawValuePreview: true, unmapped: true },
    });
    for (const observation of observedValues) {
      const field = fields.find(candidate => candidate.key === observation.fieldKey);
      if (!field) continue;
      try {
        if (
          observation.rawValuePreview
            ? normalizeValue(observation.rawValuePreview, field).state === 'UNMAPPED'
            : observation.unmapped
        )
          unmappedCount++;
      } catch {
        unmappedCount++;
      }
    }
  }
  const publishers = versions.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(versions.map(version => version.publishedBy))] } },
        select: { id: true, name: true },
      })
    : [];
  return {
    enabled: await automationEnabled(),
    mode: config?.mode ?? 'DISABLED',
    activeVersionId: config?.activeVersionId ?? null,
    candidateVersionId: config?.candidateVersionId ?? null,
    recoveryOwnerId: user.id,
    canEdit,
    canPublish: user.role === 'ADMIN',
    canReadSensitive,
    draft: draft
      ? { snapshot: draft.snapshot, revision: draft.revision }
      : {
          snapshot: activeVersion?.snapshot ?? emptySnapshot,
          revision: draftRevision?.revision ?? 0,
        },
    activeVersion:
      activeVersion && area === 'overview'
        ? { ...activeVersion, snapshot: undefined }
        : activeVersion,
    candidateVersion:
      candidateVersion && area === 'overview'
        ? { ...candidateVersion, snapshot: undefined }
        : candidateVersion,
    candidateAggregates,
    candidateReadiness:
      config?.candidateVersionId && ['overview', 'rules'].includes(area)
        ? await readAutomationReadiness(prisma, serviceId, config.candidateVersionId)
        : null,
    candidateEvidenceFreshness: config?.candidateVersionId
      ? await candidateEvidenceFreshness(
          prisma,
          serviceId,
          config.candidateVersionId,
          candidateAggregates[0]?.bucketDate ?? null
        )
      : null,
    versions: versions.map(version => ({
      ...version,
      publisherName:
        publishers.find(publisher => publisher.id === version.publishedBy)?.name ??
        'Former administrator',
    })),
    versionTotal,
    observations:
      canReadSensitive && (await getAutomationSettings()).automationStoreObservationPreviews
        ? observations
        : observations.map(observation => ({
            ...observation,
            rawValuePreview: '[redacted]',
          })),
    unmappedCount,
    aggregates,
    traces: canReadSensitive
      ? traces.map(trace => ({ ...trace, detail: decodeExplanation(trace.detail) }))
      : traces.map(trace => ({
          ...trace,
          detail: {
            redacted: true,
            shadowDifferent: !!(
              trace.detail &&
              typeof trace.detail === 'object' &&
              !Array.isArray(trace.detail) &&
              'shadowDifferent' in trace.detail &&
              trace.detail.shadowDifferent
            ),
          },
        })),
    policies,
    destinations: [
      ...slack.map(d => ({ ...d, provider: 'SLACK' as const })),
      ...teams.map(d => ({ ...d, provider: 'TEAMS' as const })),
    ],
    integrations,
    alerts,
  };
}
export async function getAutomationVersionSnapshot(serviceIdRaw: string, versionIdRaw: string) {
  const serviceId = id.parse(serviceIdRaw),
    versionId = id.parse(versionIdRaw);
  await assertAutomationAccess(serviceId, 'automation.read');
  return (await readAutomationVersion(prisma, serviceId, versionId)).snapshot;
}
