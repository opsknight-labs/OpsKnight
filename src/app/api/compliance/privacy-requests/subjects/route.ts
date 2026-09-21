import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';

const querySchema = z.object({ search: z.string().trim().min(2).max(100) });

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);
    const parsed = querySchema.safeParse({ search: request.nextUrl.searchParams.get('search') });
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Enter at least two characters to search for a subject.',
      });
    }
    const { search } = parsed.data;
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: 50,
    });
    return jsonOk({ users }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    return jsonError(error);
  }
}
