import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';

const querySchema = z.object({ search: z.string().trim().min(0).max(100).optional().default('') });

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);
    const parsed = querySchema.safeParse({ search: request.nextUrl.searchParams.get('search') ?? '' });
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Invalid search query.',
      });
    }
    const { search } = parsed.data;
    const where: { status: 'ACTIVE'; OR?: Array<{ name?: { contains: string; mode: 'insensitive' }; email?: { contains: string; mode: 'insensitive' } }> } = {
      status: 'ACTIVE',
    };
    if (search.length > 0) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: 50,
    });
    return jsonOk({ users }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    return jsonError(error);
  }
}
