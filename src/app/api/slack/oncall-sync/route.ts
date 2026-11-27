import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { getSlackInstall } from '@/lib/slack';
import { listSlackUsergroups } from '@/lib/slack/oncall-sync';

const upsertSchema = z.object({
  scheduleId: z.string().trim().min(1).max(191),
  // Slack user group ids look like S01ABC234.
  usergroupId: z
    .string()
    .trim()
    .regex(/^S[A-Z0-9]{2,30}$/, 'Enter a Slack user group id (S…).'),
  enabled: z.boolean().optional(),
});
const deleteSchema = z.object({ scheduleId: z.string().trim().min(1).max(191) });

/** GET -> mappings, schedules, and the user groups Slack lists (null without usergroups:read). */
export async function GET() {
  try {
    await assertAdmin();
    const install = await getSlackInstall();
    const [mappings, schedules, usergroups] = await Promise.all([
      prisma.slackOnCallSync.findMany({ orderBy: { createdAt: 'asc' }, take: 200 }),
      prisma.onCallSchedule.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      install ? listSlackUsergroups(install) : Promise.resolve(null),
    ]);
    return jsonOk({
      mappings,
      schedules,
      usergroups,
      canWrite: install?.scopes.includes('usergroups:write') ?? false,
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertAdmin();
    const parsed = upsertSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.',
        })
      );
    }
    const { scheduleId, usergroupId, enabled } = parsed.data;
    const schedule = await prisma.onCallSchedule.findUnique({
      where: { id: scheduleId },
      select: { id: true },
    });
    if (!schedule) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Schedule not found.' })
      );
    }
    const mapping = await prisma.slackOnCallSync.upsert({
      where: { scheduleId },
      create: { scheduleId, usergroupId, enabled: enabled ?? true },
      update: { usergroupId, ...(enabled !== undefined ? { enabled } : {}), lastError: null },
    });
    return jsonOk({ mapping });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await assertAdmin();
    const parsed = deleteSchema.safeParse({
      scheduleId: new URL(request.url).searchParams.get('scheduleId'),
    });
    if (!parsed.success) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'scheduleId is required.' })
      );
    }
    await prisma.slackOnCallSync.deleteMany({ where: { scheduleId: parsed.data.scheduleId } });
    return jsonOk({ deleted: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}
