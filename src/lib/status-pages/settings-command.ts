import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { StatusPageSettingsSchema } from '@/lib/validation';
import { AppError } from '@/lib/errors';
import { externalizeStatusPageLogo } from './assets';
import {
  applyStatusPageConfigurationChange,
  readStatusPageConfigurationReplay,
  type StatusPageConfigurationIdempotency,
  type StatusPageConfigurationActor,
} from './publish-configuration';

/** Strictly validated administrative settings normalization shared by REST section writers.
 * Publication, privacy withdrawal and canonical audit remain owned by the UI's domain command.
 */
export async function saveStatusPageSection(
  pageId: string,
  values: Record<string, unknown>,
  actor: StatusPageConfigurationActor,
  expectedRevision: number,
  section: string,
  idempotency?: StatusPageConfigurationIdempotency
) {
  if (idempotency) {
    const replay = await readStatusPageConfigurationReplay(pageId, idempotency);
    if (replay) return replay;
  }
  const input = StatusPageSettingsSchema.parse({ ...values, id: pageId });
  if (
    input.branding &&
    Object.values(input.branding).some(
      value => typeof value === 'string' && value.startsWith('data:')
    )
  )
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'Inline branding uploads are not accepted by settings endpoints. Use validated branding asset administration.',
    });
  const current = await prisma.statusPage.findUnique({ where: { id: pageId } });
  if (!current) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
  if (current.revision !== expectedRevision) {
    if (idempotency) {
      const replay = await readStatusPageConfigurationReplay(pageId, idempotency);
      if (replay) return replay;
    }
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  }
  if (
    (input.uptimeExcellentThreshold ?? current.uptimeExcellentThreshold) <
    (input.uptimeGoodThreshold ?? current.uptimeGoodThreshold)
  )
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'Excellent uptime threshold must be greater than or equal to the good threshold.',
    });
  if (input.serviceIds) {
    const count = await prisma.service.count({ where: { id: { in: input.serviceIds } } });
    if (count !== input.serviceIds.length) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  }
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        !['id', 'expectedUpdatedAt', 'serviceIds', 'serviceConfigs'].includes(key) &&
        value !== undefined
    )
  );
  if (input.branding !== undefined)
    patch.branding =
      input.branding === null
        ? Prisma.JsonNull
        : {
            ...(current.branding &&
            typeof current.branding === 'object' &&
            !Array.isArray(current.branding)
              ? current.branding
              : {}),
            ...input.branding,
          };
  try {
    const result = await applyStatusPageConfigurationChange({
      pageId,
      idempotency,
      actor,
      patch,
      serviceIds: input.serviceIds,
      serviceConfigs: input.serviceConfigs,
      expectedRevision,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      section,
      transform: async (tx, candidate) =>
        candidate.branding && typeof candidate.branding === 'object'
          ? {
              ...candidate,
              branding: await externalizeStatusPageLogo(
                tx,
                pageId,
                candidate.branding as Record<string, unknown>
              ),
            }
          : candidate,
    });
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    throw error;
  }
}
