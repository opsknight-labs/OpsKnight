import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createHash } from 'node:crypto';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function parseDataImage(dataUrl: string): { mime: string; buffer: Buffer } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 6) return null;
  const metadata = dataUrl.slice(5, comma).split(';');
  const mime = metadata[0]?.toLowerCase() ?? '';
  if (!ALLOWED_LOGO_TYPES.has(mime)) return null;
  const isBase64 = metadata.includes('base64');
  const payload = dataUrl.slice(comma + 1);
  if (payload.length > MAX_LOGO_BYTES * 2) return null;
  try {
    if (isBase64) {
      const buffer = Buffer.from(payload, 'base64');
      return buffer.length <= MAX_LOGO_BYTES ? { mime, buffer } : null;
    }
    const decoded = decodeURIComponent(payload);
    return { mime, buffer: Buffer.from(decoded, 'utf8') };
  } catch {
    return null;
  }
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const statusPageId = params.id;
  if (!statusPageId) {
    return NextResponse.json({ error: 'Missing status page ID.' }, { status: 400 });
  }

  try {
    const statusPage = await prisma.statusPage.findUnique({
      where: { id: statusPageId },
      select: { branding: true },
    });

    if (!statusPage?.branding || typeof statusPage.branding !== 'object') {
      return NextResponse.json({ error: 'Logo not found.' }, { status: 404 });
    }

    const branding = statusPage.branding as Record<string, unknown>;
    const logoUrl = typeof branding.logoUrl === 'string' ? branding.logoUrl : '';
    if (!logoUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Logo not found.' }, { status: 404 });
    }

    const parsed = parseDataImage(logoUrl);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid logo data.' }, { status: 400 });
    }

    const buffer = parsed.buffer;

    const body = new Uint8Array(buffer);
    const etag = `"${createHash('sha256').update(buffer).digest('base64url')}"`;
    if (_req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': parsed.mime,
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (error) {
    logger.error('Failed to load status page logo', {
      error: error instanceof Error ? error.message : String(error),
      statusPageId,
    });
    return NextResponse.json({ error: 'Failed to load logo.' }, { status: 500 });
  }
}
