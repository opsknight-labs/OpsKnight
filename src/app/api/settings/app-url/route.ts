import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';

// GET /api/settings/app-url
export async function GET() {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: { appUrl: true },
    });

    return jsonOk({
      appUrl: settings?.appUrl || null,
      fallback: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    });
  } catch {
    return jsonError('Failed to fetch app URL', 500);
  }
}

// POST /api/settings/app-url
export async function POST(request: NextRequest) {
  try {
    await assertAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const appUrl = typeof payload.appUrl === 'string' ? payload.appUrl : '';

    if (appUrl.trim() !== '') {
      try {
        const url = new URL(appUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return jsonError(
            new AppError({
              code: 'VALIDATION_FAILED',
              userMessage: 'URL must use http:// or https:// protocol',
              fields: [
                {
                  field: 'appUrl',
                  code: 'invalid_protocol',
                  message: 'URL must use http:// or https:// protocol',
                },
              ],
            })
          );
        }
      } catch {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'Invalid URL format',
            fields: [{ field: 'appUrl', code: 'invalid_url', message: 'Invalid URL format' }],
          })
        );
      }
    }

    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        appUrl: appUrl || null,
      },
      update: {
        appUrl: appUrl || null,
      },
    });

    revalidatePath('/settings/system');
    return jsonOk({ success: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to update app URL', 500);
  }
}
