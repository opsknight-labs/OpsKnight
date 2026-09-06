import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * GET /api/users/[id]/avatar
 * Serves the user's avatar image from the database.
 * Optimized with aggressive caching headers.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const userAvatar = await prisma.userAvatar.findUnique({
      where: { userId: id },
      select: { data: true, mimeType: true },
    });

    if (!userAvatar) {
      return new NextResponse(null, { status: 404 });
    }

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8Array = new Uint8Array(userAvatar.data);

    const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const safeMimeType = ALLOWED_MIME_TYPES.has(userAvatar.mimeType)
      ? userAvatar.mimeType
      : 'image/png';

    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type': safeMimeType,
        // Aggressive caching: 1 year, immutable (browser won't revalidate)
        // Cache invalidation is done by changing the URL query param (?t=timestamp)
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (error) {
    logger.error('api.user.avatar.error', {
      userId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch avatar' }, { status: 500 });
  }
}
