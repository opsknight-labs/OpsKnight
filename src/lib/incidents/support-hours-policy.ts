import 'server-only';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertCanModifyService, getUserPermissions } from '@/lib/rbac';
import { emitAuditEvent } from '@/lib/audit';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';
import type { AuthorizedPolicyActor } from './policy-actor';

const windowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine(
    value => value.endMinute - value.startMinute >= 15,
    'Support windows must be at least 15 minutes.'
  );
const exceptionSchema = z
  .object({
    localDate: z.coerce.date(),
    available: z.boolean(),
    startMinute: z.number().int().min(0).max(1439).nullable(),
    endMinute: z.number().int().min(1).max(1440).nullable(),
    label: z.string().trim().max(120).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.available !==
      (value.startMinute !== null &&
        value.endMinute !== null &&
        value.startMinute < value.endMinute)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Available exceptions require a valid window; unavailable exceptions require no window.',
      });
  });
export const supportHoursPolicySchema = z
  .object({
    scopeKey: z.string().regex(/^(workspace|service:[A-Za-z0-9_-]+)$/),
    expectedVersion: z.number().int().nonnegative(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine(value => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone.'),
    inheritWorkspace: z.boolean(),
    mode: z.enum(['INHERIT', 'ALWAYS', 'SCHEDULED']).optional(),
    windows: z.array(windowSchema).max(28),
    exceptions: z.array(exceptionSchema).max(366),
  })
  .strict()
  .superRefine((value, context) => {
    const mode = value.mode ?? (value.inheritWorkspace ? 'INHERIT' : 'SCHEDULED');
    if (value.scopeKey === 'workspace' && value.inheritWorkspace)
      context.addIssue({
        code: 'custom',
        path: ['inheritWorkspace'],
        message: 'Workspace cannot inherit.',
      });
    if (value.scopeKey === 'workspace' && mode === 'INHERIT')
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Workspace support hours cannot inherit.',
      });
    if (mode !== 'SCHEDULED' && (value.windows.length > 0 || value.exceptions.length > 0))
      context.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'Only scheduled support hours can contain windows or exceptions.',
      });
    if (mode === 'SCHEDULED' && value.windows.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'Scheduled support hours require at least one recurring staffed window.',
      });
    const keys = value.windows.map(
      window => `${window.dayOfWeek}:${window.startMinute}:${window.endMinute}`
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'Duplicate support windows are not allowed.',
      });
    for (let day = 0; day <= 6; day++) {
      const windows = value.windows
        .filter(window => window.dayOfWeek === day)
        .sort((left, right) => left.startMinute - right.startMinute);
      if (
        windows.some(
          (window, index) => index > 0 && window.startMinute < windows[index - 1].endMinute
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['windows'],
          message: 'Support windows on the same day cannot overlap.',
        });
    }
    const exceptionDates = value.exceptions.map(exception =>
      exception.localDate.toISOString().slice(0, 10)
    );
    if (new Set(exceptionDates).size !== exceptionDates.length)
      context.addIssue({
        code: 'custom',
        path: ['exceptions'],
        message: 'Only one support-hours exception is allowed per local date.',
      });
  });

export async function saveSupportHoursPolicy(
  raw: unknown,
  authorizedActor?: AuthorizedPolicyActor
) {
  const input = supportHoursPolicySchema.parse(raw);
  const mode = input.mode ?? (input.inheritWorkspace ? 'INHERIT' : 'SCHEDULED');
  const permissions = authorizedActor
    ? {
        authenticated: true,
        id: authorizedActor.actorId,
        capabilities: authorizedActor.capabilities,
      }
    : await getUserPermissions();
  if (!permissions.authenticated || !permissions.id)
    throw new IncidentResponsePolicyError('UNAUTHORIZED');
  if (authorizedActor) {
    if (!permissions.capabilities.includes('admin.manage'))
      throw new IncidentResponsePolicyError('UNAUTHORIZED');
  } else if (input.scopeKey.startsWith('service:')) {
    await assertCanModifyService(input.scopeKey.slice(8));
  } else if (!permissions.capabilities.includes('admin.manage')) {
    throw new IncidentResponsePolicyError('UNAUTHORIZED');
  }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`response-support:${input.scopeKey}`}, 0))`;
    const previous = await tx.responseSupportHoursPolicy.findFirst({
      where: { scopeKey: input.scopeKey, sealedAt: { not: null } },
      orderBy: { version: 'desc' },
    });
    if ((previous?.version ?? 0) !== input.expectedVersion)
      throw new IncidentResponsePolicyError('CONFLICT');
    if (
      input.scopeKey.startsWith('service:') &&
      !(await tx.service.findUnique({
        where: { id: input.scopeKey.slice(8) },
        select: { id: true },
      }))
    )
      throw new IncidentResponsePolicyError('NOT_FOUND');
    const draft = await tx.responseSupportHoursPolicy.create({
      data: {
        scopeKey: input.scopeKey,
        version: input.expectedVersion + 1,
        timezone: input.timezone,
        inheritWorkspace: mode === 'INHERIT',
        mode,
        createdById: permissions.id,
        windows: { create: input.windows },
        exceptions: {
          create: input.exceptions.map(item => ({ ...item, label: item.label ?? null })),
        },
      },
    });
    const sealed = await tx.responseSupportHoursPolicy.update({
      where: { id: draft.id },
      data: { sealedAt: new Date() },
      include: { windows: true, exceptions: true },
    });
    await emitAuditEvent(
      {
        action: 'response_support.policy.version_created',
        source: authorizedActor?.source ?? 'UI',
        target: { type: 'SYSTEM_CONFIG', id: input.scopeKey },
        actor: { type: 'USER', id: permissions.id },
        metadata: {
          previousVersion: previous?.version ?? null,
          newVersion: sealed.version,
          timezone: sealed.timezone,
          mode: sealed.mode,
          windowCount: sealed.windows.length,
          exceptionCount: sealed.exceptions.length,
          slaClockUnaffected: true,
        },
      },
      tx
    );
    return sealed;
  });
}
