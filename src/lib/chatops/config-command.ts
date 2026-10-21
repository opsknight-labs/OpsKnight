import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getGlobalWarRoomPolicy, setGlobalDefaultWarRoomProviders, setGlobalMeetingProvider } from '@/lib/incident-collaboration/policy';
import type { WarRoomProviderSet, IncidentMeetingProvider } from '@/lib/incident-collaboration/types';

const ALLOWED_BRIDGE_TEMPLATE_VARIABLES = new Set(['incidentId']);
export const chatOpsConfigSchema = z.object({
  enabled: z.boolean(),
  channelPrefix: z.string().trim().min(1).max(20).regex(/^[a-z0-9-]+$/)
    .refine(value => !value.startsWith('-') && !value.endsWith('-') && !value.includes('--')),
  autoCreateOnUrgency: z.array(z.enum(['HIGH', 'MEDIUM', 'LOW'])).max(3),
  autoCreateOnPriority: z.array(z.enum(['P1', 'P2', 'P3', 'P4', 'P5'])).max(5),
  archiveOnResolve: z.boolean(),
  defaultVideoBridge: z.enum(['MICROSOFT_TEAMS', 'JITSI', 'ZOOM', 'GOOGLE_MEET', 'NONE']),
  customBridgeUrlTemplate: z.string().trim().max(2048),
  defaultProviders: z.array(z.enum(['SLACK', 'MICROSOFT_TEAMS'])).min(1).max(2).refine(
    providers => new Set(providers).size === providers.length, 'Provider names must be unique.'
  ),
}).strict().superRefine((value, ctx) => {
  if (!value.customBridgeUrlTemplate) return;
  const placeholders = Array.from(value.customBridgeUrlTemplate.matchAll(/\{([^{}]+)\}/g)).map(match => match[1]);
  const unsupported = placeholders.find(placeholder => !ALLOWED_BRIDGE_TEMPLATE_VARIABLES.has(placeholder));
  if (unsupported) {
    ctx.addIssue({ code: 'custom', path: ['customBridgeUrlTemplate'],
      message: `Unsupported bridge URL template variable: {${unsupported}}.` });
    return;
  }
  try {
    const url = new URL(value.customBridgeUrlTemplate.replaceAll('{incidentId}', 'incident-id'));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
  } catch {
    ctx.addIssue({ code: 'custom', path: ['customBridgeUrlTemplate'],
      message: 'Custom bridge URL must be a valid HTTP(S) URL template.' });
  }
});

export async function getChatOpsConfiguration(db: Prisma.TransactionClient = prisma) {
  const [config, policy] = await Promise.all([
    db.chatOpsConfig.findUnique({ where: { id: 'default' } }), getGlobalWarRoomPolicy(db),
  ]);
  return {
    revision: config?.revision ?? 0, updatedAt: config?.updatedAt ?? null,
    enabled: config?.enabled ?? false,
    channelPrefix: config?.channelPrefix ?? 'inc',
    autoCreateOnUrgency: config?.autoCreateOnUrgency ?? ['HIGH'],
    autoCreateOnPriority: config?.autoCreateOnPriority ?? ['P1', 'P2'],
    archiveOnResolve: config?.archiveOnResolve ?? true,
    defaultVideoBridge: config?.defaultVideoBridge ?? policy.defaultMeetingProvider,
    customBridgeUrlTemplate: config?.customBridgeUrlTemplate ?? '',
    defaultProviders: policy.defaultProviders,
  };
}

export async function saveChatOpsConfiguration(
  input: z.infer<typeof chatOpsConfigSchema>,
  expected: { revision?: number; updatedAt?: Date | null },
  actor: { id: string; source: 'UI' | 'API'; apiClientId?: string },
  tx: Prisma.TransactionClient
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings:chatops:default', 0))`;
  const existing = await tx.chatOpsConfig.findUnique({ where: { id: 'default' } });
  if ((expected.revision !== undefined && (existing?.revision ?? 0) !== expected.revision) ||
      (expected.updatedAt !== undefined && (existing?.updatedAt?.getTime() ?? null) !== (expected.updatedAt?.getTime() ?? null))) {
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  }
  const previousPolicy = await getGlobalWarRoomPolicy(tx);
  const data = {
    enabled: input.enabled, channelPrefix: input.channelPrefix,
    autoCreateOnUrgency: input.autoCreateOnUrgency,
    autoCreateOnPriority: input.autoCreateOnPriority,
    archiveOnResolve: input.archiveOnResolve,
    defaultVideoBridge: input.defaultVideoBridge,
    customBridgeUrlTemplate: input.customBridgeUrlTemplate || null,
  };
  if (existing) await tx.chatOpsConfig.update({ where: { id: 'default' }, data });
  else await tx.chatOpsConfig.create({ data: { id: 'default', ...data } });
  await setGlobalDefaultWarRoomProviders(input.defaultProviders as WarRoomProviderSet, actor.id, tx);
  await setGlobalMeetingProvider(input.defaultVideoBridge as IncidentMeetingProvider, actor.id, tx, false);
  await logAudit({
    action: 'chatops.config.updated', entityType: 'SYSTEM_CONFIG', entityId: 'chatops-config',
    actorId: actor.id, source: actor.source,
    oldValue: existing ? { ...previousPolicy, channelPrefix: existing.channelPrefix,
      customBridgeUrlTemplate: existing.customBridgeUrlTemplate } : null,
    newValue: { ...input },
    details: actor.apiClientId ? { apiClientId: actor.apiClientId } : null,
  }, tx);
  return getChatOpsConfiguration(tx);
}
