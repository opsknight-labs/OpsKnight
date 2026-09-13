import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { emitAuditEvent } from '@/lib/audit';

const unlinkSchema = z.object({ id: z.string().trim().min(1).max(191) }).strict();

export async function GET() {
  try {
    const user = await getCurrentUser();
    const links = await prisma.chatIdentityLink.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { id: true, provider: true, providerTenantId: true, displayName: true, verifiedAt: true },
      orderBy: { verifiedAt: 'desc' },
    });
    return jsonOk({ links });
  } catch {
    return jsonError('Unauthorized', 401);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = unlinkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError('Invalid identity link', 400);
    const updated = await prisma.chatIdentityLink.updateMany({
      where: { id: parsed.data.id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) return jsonError('Identity link not found', 404);
    await emitAuditEvent({
      action: 'chatops.identity.unlinked', source: 'UI', target: { type: 'USER', id: user.id },
      actor: { type: 'USER', id: user.id }, metadata: { provider: 'MICROSOFT_TEAMS', linkId: parsed.data.id },
    }).catch(() => undefined);
    return jsonOk({ ok: true });
  } catch {
    return jsonError('Unauthorized', 401);
  }
}
