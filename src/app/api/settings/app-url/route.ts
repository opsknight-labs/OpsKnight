import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { jsonSettingsChanged } from '@/lib/settings-api-response';
import { normalizePublicOrigin } from '@/lib/public-origin';
import {
  SettingsChangedMutationError,
  isSettingsChangedError,
  parseSettingsRevision,
} from '@/lib/settings-result';

const AppUrlSchema = z.object({
  appUrl: z.string().trim().max(2048),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
});

function validateAppUrl(value: string): string | null {
  if (!value) return null;
  try {
    return normalizePublicOrigin(value);
  } catch {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Application URL must be an HTTP or HTTPS origin without credentials, a path, query, or fragment.',
      fields: [
        {
          field: 'appUrl',
          code: 'invalid_url',
          message: 'Application URL must be an HTTP or HTTPS origin without credentials, a path, query, or fragment.',
        },
      ],
    });
  }
}

export async function GET() {
  try {
    await assertAdmin();
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: { appUrl: true, updatedAt: true },
    });

    return jsonOk({
      appUrl: settings?.appUrl || null,
      updatedAt: settings?.updatedAt?.toISOString() || null,
      fallback:
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXTAUTH_URL ||
        'http://localhost:3000',
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to fetch app URL', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await assertAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = AppUrlSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message || 'Invalid application URL.',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'appUrl',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }

    const appUrl = validateAppUrl(parsed.data.appUrl);
    const expectedUpdatedAt = parsed.data.expectedUpdatedAt ?? null;
    const expectedRevision = parseSettingsRevision(expectedUpdatedAt);
    const existing = await prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: { appUrl: true, updatedAt: true },
    });

    if (existing && !expectedRevision) return jsonSettingsChanged();
    if (!existing && expectedRevision) return jsonSettingsChanged();

    const updatedAt = await prisma.$transaction(async tx => {
      if (existing) {
        const updated = await tx.systemSettings.updateMany({
          where: { id: 'default', updatedAt: expectedRevision! },
          data: { appUrl },
        });
        if (updated.count !== 1) throw new SettingsChangedMutationError();
      } else {
        await tx.systemSettings.create({
          data: { id: 'default', appUrl },
        });
      }

      await logAudit(
        {
          action: 'settings.app_url.updated',
          entityType: 'USER',
          entityId: actor.id,
          actorId: actor.id,
          oldValue: { appUrl: existing?.appUrl || null },
          newValue: { appUrl },
          details: { setting: 'application_url' },
        },
        tx
      );

      const saved = await tx.systemSettings.findUniqueOrThrow({
        where: { id: 'default' },
        select: { updatedAt: true },
      });
      return saved.updatedAt.toISOString();
    });

    revalidatePath('/settings/system');
    return jsonOk({ success: true, appUrl, updatedAt });
  } catch (error) {
    if (
      isSettingsChangedError(error) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      return jsonSettingsChanged();
    }
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to update app URL', 500);
  }
}
