import 'server-only';

import { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { teamReadWhere } from '@/lib/authorization-filters';
import {
  assertCanManageBusinessServices,
  createBusinessService,
  type BusinessServiceInput,
} from './commands';
import { BusinessServiceLinkSchema, parseBusinessServiceLinks } from './links';

/** What a template may default. Identity, members, followers and dependencies are never templated. */
const TemplateFields = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    criticality: z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']).nullable().optional(),
    sloTarget: z.number().min(90).max(99.999).nullable().optional(),
    sloWindowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
    quorumPartialPct: z.number().int().min(1).max(100).nullable().optional(),
    quorumMajorPct: z.number().int().min(1).max(100).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    environment: z.string().trim().max(40).nullable().optional(),
    lifecycle: z.enum(['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED']).optional(),
    links: z.array(BusinessServiceLinkSchema).max(10).nullable().optional(),
    impactMinUrgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
    impactMaxPriority: z
      .string()
      .trim()
      .regex(/^P[1-9]$/i)
      .transform(value => value.toUpperCase())
      .nullable()
      .optional(),
    ownerTeamId: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict();

const quorumOrdered = {
  check: (t: { quorumPartialPct?: number | null; quorumMajorPct?: number | null }) =>
    t.quorumPartialPct == null ||
    t.quorumMajorPct == null ||
    t.quorumPartialPct <= t.quorumMajorPct,
  options: { message: 'The partial quorum threshold cannot exceed the major one.' },
};

export const BusinessServiceTemplateInputSchema = TemplateFields.refine(
  quorumOrdered.check,
  quorumOrdered.options
);
/** PATCH body: any subset; the merged result is validated again by the update command. */
export const BusinessServiceTemplatePatchSchema = TemplateFields.partial().refine(
  body => Object.keys(body).length > 0,
  { message: 'Send at least one field.' }
);

export type BusinessServiceTemplateInput = z.input<typeof BusinessServiceTemplateInputSchema>;

export const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  criticality: true,
  sloTarget: true,
  sloWindowDays: true,
  quorumPartialPct: true,
  quorumMajorPct: true,
  tags: true,
  environment: true,
  lifecycle: true,
  links: true,
  impactMinUrgency: true,
  impactMaxPriority: true,
  ownerTeamId: true,
  ownerTeam: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessServiceTemplateSelect;

type TemplateRow = Prisma.BusinessServiceTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

export function templateDto(row: TemplateRow) {
  return { ...row, links: parseBusinessServiceLinks(row.links) };
}

type Context = { actor: AuthorizationActor; source?: AuditEventSource };

async function audit(
  tx: Prisma.TransactionClient,
  context: Context,
  action: string,
  id: string,
  newValue: Prisma.InputJsonObject
) {
  await emitAuditEvent(
    {
      action,
      source: context.source ?? 'UI',
      target: { type: 'BUSINESS_SERVICE', id },
      actor: { type: 'USER', id: context.actor.id },
      newValue: { kind: 'template', ...newValue },
    },
    tx
  );
}

function columns(input: z.output<typeof BusinessServiceTemplateInputSchema>) {
  const { links, ...rest } = input;
  return {
    ...rest,
    ...(links !== undefined ? { links: links ?? Prisma.DbNull } : {}),
  };
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'A template with this name already exists.',
    });
  throw error;
}

async function assertTeam(
  tx: Prisma.TransactionClient,
  actor: AuthorizationActor,
  teamId?: string | null
) {
  if (!teamId) return;
  const team = await tx.team.findFirst({
    where: { AND: [{ id: teamId }, teamReadWhere(actor)] },
    select: { id: true },
  });
  if (!team)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Owner team not found.' });
}

export async function listBusinessServiceTemplates(actor: AuthorizationActor) {
  assertCanManageBusinessServices(actor);
  const rows = await prisma.businessServiceTemplate.findMany({
    orderBy: { name: 'asc' },
    take: 200,
    select: TEMPLATE_SELECT,
  });
  return rows.map(templateDto);
}

export async function createBusinessServiceTemplate(
  raw: BusinessServiceTemplateInput,
  context: Context,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const input = BusinessServiceTemplateInputSchema.parse(raw);
  const run = async (tx: Prisma.TransactionClient) => {
    await assertTeam(tx, context.actor, input.ownerTeamId);
    const created = await tx.businessServiceTemplate
      .create({ data: columns(input), select: TEMPLATE_SELECT })
      .catch(conflict);
    await audit(tx, context, 'business_service_template.created', created.id, {
      name: created.name,
    });
    return templateDto(created);
  };
  return client ? run(client) : prisma.$transaction(run);
}

export async function updateBusinessServiceTemplate(
  id: string,
  raw: Partial<BusinessServiceTemplateInput>,
  context: Context,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const run = async (tx: Prisma.TransactionClient) => {
    const current = await tx.businessServiceTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    });
    if (!current) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const input = BusinessServiceTemplateInputSchema.parse({
      name: current.name,
      quorumPartialPct: current.quorumPartialPct,
      quorumMajorPct: current.quorumMajorPct,
      ...raw,
    });
    // Only what the caller sent is written, so an omitted field keeps its stored value.
    const sent = Object.fromEntries(Object.entries(columns(input)).filter(([key]) => key in raw));
    // An unchanged owner team may stay even when the actor cannot see it.
    if (input.ownerTeamId !== current.ownerTeamId)
      await assertTeam(tx, context.actor, input.ownerTeamId);
    const updated = await tx.businessServiceTemplate
      .update({ where: { id }, data: sent, select: TEMPLATE_SELECT })
      .catch(conflict);
    await audit(tx, context, 'business_service_template.updated', id, { name: updated.name });
    return templateDto(updated);
  };
  return client ? run(client) : prisma.$transaction(run);
}

export async function deleteBusinessServiceTemplate(
  id: string,
  context: Context,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const run = async (tx: Prisma.TransactionClient) => {
    const removed = await tx.businessServiceTemplate.deleteMany({ where: { id } });
    if (!removed.count) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    await audit(tx, context, 'business_service_template.deleted', id, {});
    return { id, deleted: true as const };
  };
  return client ? run(client) : prisma.$transaction(run);
}

/** Template defaults as a business-service input; explicit overrides win. Pure. */
export function templateToInput(
  template: Pick<
    z.output<typeof BusinessServiceTemplateInputSchema>,
    | 'description'
    | 'criticality'
    | 'sloTarget'
    | 'sloWindowDays'
    | 'quorumPartialPct'
    | 'quorumMajorPct'
    | 'tags'
    | 'environment'
    | 'lifecycle'
    | 'links'
    | 'impactMinUrgency'
    | 'impactMaxPriority'
    | 'ownerTeamId'
  >,
  overrides: Partial<BusinessServiceInput> & { name: string }
): BusinessServiceInput {
  const defaults = Object.fromEntries(
    Object.entries({
      description: template.description,
      criticality: template.criticality,
      sloTarget: template.sloTarget,
      sloWindowDays: template.sloWindowDays,
      quorumPartialPct: template.quorumPartialPct,
      quorumMajorPct: template.quorumMajorPct,
      tags: template.tags,
      environment: template.environment,
      lifecycle: template.lifecycle,
      links: template.links,
      impactMinUrgency: template.impactMinUrgency,
      impactMaxPriority: template.impactMaxPriority,
      ownerTeamId: template.ownerTeamId,
    }).filter(
      ([, value]) =>
        value !== undefined && value !== null && !(Array.isArray(value) && !value.length)
    )
  );
  const given = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );
  return { ...defaults, ...given } as BusinessServiceInput;
}

/** Creates a business service from a template through the normal create command (RBAC, audit). */
export async function createBusinessServiceFromTemplate(
  templateId: string,
  overrides: Partial<BusinessServiceInput> & { name: string },
  context: Context,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const db = client ?? prisma;
  const template = await db.businessServiceTemplate.findUnique({
    where: { id: templateId },
    select: TEMPLATE_SELECT,
  });
  if (!template)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Template not found.' });
  return createBusinessService(
    templateToInput({ ...template, links: parseBusinessServiceLinks(template.links) }, overrides),
    context,
    client
  );
}
