import { safePublicationResult } from '@/lib/status-pages/publication-diagnostics';
import { saveStatusPageSection } from '@/lib/status-pages/settings-command';
import type {
  StatusPageConfigurationActor,
  StatusPageConfigurationIdempotency,
} from '@/lib/status-pages/publish-configuration';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { StatusPageSettingsSchema } from '@/lib/validation';
import { statusPageSectionFields } from '@/lib/status-pages/settings-sections';

export const StatusPageParams = z.object({ id: z.string().cuid() }).strict();
export function statusPageSectionSchema(section: string) {
  const fields = statusPageSectionFields(section);
  const shape = StatusPageSettingsSchema.innerType().shape;
  return z
    .object(
      Object.fromEntries(
        Object.entries(shape).filter(
          ([key]) =>
            fields?.has(key) &&
            !['id', 'expectedUpdatedAt', 'customDomain', 'subdomain'].includes(key)
        )
      )
    )
    .strict()
    .refine(value => Object.keys(value).length > 0, 'Provide at least one setting.');
}
export async function requireStatusPageSettings(db: Prisma.TransactionClient, id: string) {
  const page = await db.statusPage.findUnique({ where: { id } });
  if (!page) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
  return page;
}

export function projectStatusPageSection(
  page: Awaited<ReturnType<typeof requireStatusPageSettings>>,
  section: string
) {
  const fields = statusPageSectionFields(section);
  const values = Object.fromEntries(
    Object.entries(page).filter(
      ([key]) =>
        fields?.has(key) && !['id', 'expectedUpdatedAt', 'customDomain', 'subdomain'].includes(key)
    )
  );
  return { id: page.id, revision: page.revision, updatedAt: page.updatedAt, values };
}

export const StatusPageServiceParams = StatusPageParams.extend({
  serviceId: z.string().cuid(),
}).strict();
export const StatusPageServicePresentation = z
  .object({
    displayName: z.string().trim().max(200).nullable().optional(),
    order: z.number().int().min(0).max(100000).optional(),
    showOnPage: z.boolean().optional(),
  })
  .strict();
export const StatusPageServiceSet = z
  .object({
    serviceIds: z.array(z.string().cuid()).max(10000),
    serviceConfigs: z.record(StatusPageServicePresentation).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (new Set(input.serviceIds).size !== input.serviceIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['serviceIds'],
        message: 'Service identifiers must be unique.',
      });
    for (const id of Object.keys(input.serviceConfigs ?? {}))
      if (!input.serviceIds.includes(id))
        ctx.addIssue({
          code: 'custom',
          path: ['serviceConfigs'],
          message: 'Presentation settings must belong to a selected service.',
        });
  });

export function requireStatusPageIdempotency(
  req: Request,
  principalId: string,
  body: unknown,
  expectedRevision: number
): StatusPageConfigurationIdempotency {
  const key = req.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return {
    scope: `${req.method}:${new URL(req.url).pathname}`,
    context: { key, principalId },
    payload: { body, expectedRevision },
  };
}
export async function executeIdempotentStatusPageSection(
  req: Request,
  principalId: string,
  pageId: string,
  body: Record<string, unknown>,
  actor: StatusPageConfigurationActor,
  expectedRevision: number,
  section: string
) {
  const result = await saveStatusPageSection(
    pageId,
    body,
    actor,
    expectedRevision,
    section,
    requireStatusPageIdempotency(req, principalId, body, expectedRevision)
  );
  return safePublicationResult(result);
}
