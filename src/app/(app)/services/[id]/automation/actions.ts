'use server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAutomationAccess } from '@/lib/automation/access';
import {
  saveDraft,
  publishVersion,
  changeMode,
  AutomationConflict,
} from '@/lib/automation/versioning';
import { emptySnapshot, snapshotSchema } from '@/lib/automation/contract';
import { automationEnabled } from '@/lib/automation/runtime';
import { compileAutomation } from '@/lib/automation/compiler';
import { discoverFields } from '@/lib/automation/discovery';
import { testAutomation } from '@/lib/automation/testing';
const id = z.string().min(1).max(100);
const eventSchema = z
  .object({
    event_action: z.enum(['trigger', 'resolve', 'acknowledge']),
    dedup_key: z.string().max(512),
    payload: z
      .object({
        summary: z.string().min(1).max(500),
        source: z.string().min(1).max(500),
        severity: z.enum(['critical', 'error', 'warning', 'info']),
        custom_details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
const actionSchema = z.discriminatedUnion('action', [
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
      sourceVersionId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('mode'),
      serviceId: id,
      mode: z.enum(['DISABLED', 'SHADOW', 'LIVE']),
      expectedActiveVersionId: id.nullable(),
    })
    .strict(),
  z.object({ action: z.literal('lint'), serviceId: id, snapshot: snapshotSchema }).strict(),
  z.object({ action: z.literal('discover'), serviceId: id, sample: z.unknown() }).strict(),
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
    const input = actionSchema.parse(raw);
    if (JSON.stringify(raw).length > 256 * 1024) throw new Error('Sample or draft is too large');
    const capability =
      input.action === 'save'
        ? 'automation.edit'
        : ['publish', 'mode'].includes(input.action)
          ? 'automation.publish'
          : 'automation.read';
    const user = await assertAutomationAccess(input.serviceId, capability);
    if (input.action === 'save')
      return { ok: true as const, data: await saveDraft({ ...input, actorId: user.id }) };
    if (input.action === 'publish')
      return { ok: true as const, data: await publishVersion({ ...input, actorId: user.id }) };
    if (input.action === 'mode')
      return { ok: true as const, data: await changeMode({ ...input, actorId: user.id }) };
    if (input.action === 'lint')
      return { ok: true as const, data: compileAutomation(input.snapshot) };
    if (input.action === 'discover')
      return { ok: true as const, data: discoverFields(input.sample) };
    if (
      input.integrationId &&
      !(await prisma.integration.findFirst({
        where: { id: input.integrationId, serviceId: input.serviceId },
      }))
    )
      throw new Error('Integration belongs to another service');
    return {
      ok: true as const,
      data: await prisma.$transaction(tx =>
        testAutomation(tx, {
          ...input,
          event: input.event,
          providerPayload: input.providerPayload,
          evaluationAt: input.evaluationAt ?? new Date().toISOString(),
        })
      ),
    };
  } catch (error) {
    return {
      ok: false as const,
      conflict: error instanceof AutomationConflict,
      error: error instanceof Error ? error.message : 'Automation request failed',
    };
  }
}
export async function getAutomationArea(serviceIdRaw: string, areaRaw: string = 'overview') {
  const serviceId = id.parse(serviceIdRaw),
    area = z.enum(['overview', 'context', 'rules', 'test', 'activity', 'trace']).parse(areaRaw);
  const user = await assertAutomationAccess(serviceId, 'automation.read');
  let canEdit = false;
  try {
    await assertAutomationAccess(serviceId, 'automation.edit');
    canEdit = true;
  } catch {
    /* Read-only role or service ownership does not grant editing. */
  }
  const config = await prisma.serviceAutomationConfig.findUnique({
    where: { serviceId },
    select: { mode: true, activeVersionId: true, updatedAt: true },
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
          take: 50,
        })
      : [];
  const observations =
    area === 'context'
      ? await prisma.automationContextObservation.findMany({
          where: { serviceId },
          orderBy: { lastSeenAt: 'desc' },
          take: 200,
        })
      : [];
  const aggregates =
    area === 'overview'
      ? await prisma.automationShadowAggregate.findMany({
          where: { serviceId, bucketDate: { gte: new Date(Date.now() - 7 * 86400000) } },
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
  const policies =
    area === 'rules'
      ? await prisma.escalationPolicy.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : [];
  const slack =
    area === 'rules'
      ? await prisma.slackDestination.findMany({
          where: { serviceId, enabled: true },
          select: { id: true, channelName: true },
        })
      : [];
  const teams =
    area === 'rules'
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
  const alerts =
    area === 'test'
      ? await prisma.alert.findMany({
          where: { serviceId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, payload: true, createdAt: true },
          take: 20,
        })
      : [];
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
  return {
    enabled: await automationEnabled(),
    mode: config?.mode ?? 'DISABLED',
    activeVersionId: config?.activeVersionId ?? null,
    canEdit,
    canPublish: user.role === 'ADMIN',
    draft: draft
      ? { snapshot: draft.snapshot, revision: draft.revision }
      : {
          snapshot: activeVersion?.snapshot ?? emptySnapshot,
          revision: draftRevision?.revision ?? 0,
        },
    activeVersion,
    versions,
    observations,
    aggregates,
    traces,
    policies,
    destinations: [
      ...slack.map(d => ({ ...d, provider: 'SLACK' as const })),
      ...teams.map(d => ({ ...d, provider: 'TEAMS' as const })),
    ],
    integrations,
    alerts,
  };
}
