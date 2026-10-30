import 'server-only';
import { IncidentUrgency, Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';

export const IncidentTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(5000).nullable().default(null),
    title: z.string().trim().min(1).max(200),
    descriptionText: z.string().max(10000).nullable().default(null),
    defaultUrgency: z.nativeEnum(IncidentUrgency).default('HIGH'),
    defaultPriority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).nullable().default(null),
    defaultServiceId: z.string().min(1).max(100).nullable().default(null),
    isPublic: z.boolean().default(false),
  })
  .strict();

export type IncidentTemplateInput = z.infer<typeof IncidentTemplateInputSchema>;

function duplicateName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'Incident template name is already in use.',
    });
  }
  throw error;
}

export async function createIncidentTemplate(
  tx: Prisma.TransactionClient,
  input: IncidentTemplateInput,
  createdById: string
) {
  if (input.defaultServiceId) {
    const service = await tx.service.findUnique({
      where: { id: input.defaultServiceId },
      select: { id: true },
    });
    if (!service)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Default service not found.' });
  }
  try {
    return await tx.incidentTemplate.create({ data: { ...input, createdById } });
  } catch (error) {
    duplicateName(error);
  }
}

export function incidentTemplateReadWhere(
  userId: string,
  admin: boolean
): Prisma.IncidentTemplateWhereInput {
  return admin ? {} : { OR: [{ isPublic: true }, { createdById: userId }] };
}

export async function assertIncidentTemplateOwner(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  admin: boolean
) {
  const template = await tx.incidentTemplate.findUnique({ where: { id } });
  if (!template)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Incident template not found.' });
  if (!admin && template.createdById !== userId) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Only the template owner can change it.',
    });
  }
  return template;
}

export async function updateIncidentTemplate(
  tx: Prisma.TransactionClient,
  id: string,
  expectedRevision: number,
  input: Partial<IncidentTemplateInput>,
  userId: string,
  admin: boolean
) {
  const current = await assertIncidentTemplateOwner(tx, id, userId, admin);
  if (current.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
  if (input.defaultServiceId) {
    const service = await tx.service.findUnique({
      where: { id: input.defaultServiceId },
      select: { id: true },
    });
    if (!service)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Default service not found.' });
  }
  try {
    const updated = await tx.incidentTemplate.updateMany({
      where: { id, revision: expectedRevision },
      data: input,
    });
    if (!updated.count) throw new AppError({ code: 'PRECONDITION_FAILED' });
    return tx.incidentTemplate.findUniqueOrThrow({ where: { id } });
  } catch (error) {
    duplicateName(error);
  }
}

export async function deleteIncidentTemplate(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  admin: boolean,
  expectedRevision?: number
) {
  const current = await assertIncidentTemplateOwner(tx, id, userId, admin);
  if (expectedRevision !== undefined && current.revision !== expectedRevision)
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  const deleted = await tx.incidentTemplate.deleteMany({
    where: { id, ...(expectedRevision !== undefined ? { revision: expectedRevision } : {}) },
  });
  if (!deleted.count) throw new AppError({ code: 'PRECONDITION_FAILED' });
  return { id, deleted: true };
}
