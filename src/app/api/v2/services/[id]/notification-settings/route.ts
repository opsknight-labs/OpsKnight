import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { SERVICE_NOTIFICATION_CHANNEL_VALUES } from '@/lib/service-notification-settings';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const channelSchema = z.enum(SERVICE_NOTIFICATION_CHANNEL_VALUES);
const settingsSchema = z.object({
  serviceNotificationChannels: z.array(channelSchema).max(7).refine(channels => new Set(channels).size === channels.length, 'Channels must be unique').optional(),
  serviceNotifyOnTriggered: z.boolean().optional(),
  serviceNotifyOnAck: z.boolean().optional(),
  serviceNotifyOnResolved: z.boolean().optional(),
  serviceNotifyOnSlaBreach: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one setting is required');

function settingsDto(service: {
  id: string;
  revision: number;
  serviceNotificationChannels: string[];
  serviceNotifyOnTriggered: boolean;
  serviceNotifyOnAck: boolean;
  serviceNotifyOnResolved: boolean;
  serviceNotifyOnSlaBreach: boolean;
}) {
  return {
    serviceId: service.id,
    revision: service.revision,
    serviceNotificationChannels: service.serviceNotificationChannels,
    serviceNotifyOnTriggered: service.serviceNotifyOnTriggered,
    serviceNotifyOnAck: service.serviceNotifyOnAck,
    serviceNotifyOnResolved: service.serviceNotifyOnResolved,
    serviceNotifyOnSlaBreach: service.serviceNotifyOnSlaBreach,
  };
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const service = await prisma.service.findFirst({
      where: { AND: [{ id: params.id }, serviceReadWhere(actor)] },
      select: {
        id: true, revision: true, serviceNotificationChannels: true,
        serviceNotifyOnTriggered: true, serviceNotifyOnAck: true,
        serviceNotifyOnResolved: true, serviceNotifyOnSlaBreach: true,
      },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    return { data: settingsDto(service), headers: etagHeaders(service.revision) };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_UPDATE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: settingsSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    const exists = await tx!.service.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const expected = requireRevisionIfMatch(req);
    const current = await tx!.service.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!current) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const changed = await tx!.service.updateMany({
      where: { id: params.id, revision: expected },
      data: body,
    });
    if (changed.count !== 1) throw preconditionFailed();
    if (body.serviceNotificationChannels && !body.serviceNotificationChannels.includes('SLACK')) {
      await tx!.slackDestination.updateMany({
        where: { serviceId: params.id, enabled: true },
        data: { enabled: false },
      });
    }
    const service = await tx!.service.findUniqueOrThrow({
      where: { id: params.id },
      select: {
        id: true, revision: true, serviceNotificationChannels: true,
        serviceNotifyOnTriggered: true, serviceNotifyOnAck: true,
        serviceNotifyOnResolved: true, serviceNotifyOnSlaBreach: true,
      },
    });
    await logV2Audit({
      action: 'service.notifications.updated',
      entityType: 'SERVICE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { changedFields: Object.keys(body) },
      tx,
    });
    return { data: settingsDto(service), headers: etagHeaders(service.revision) };
  },
});
