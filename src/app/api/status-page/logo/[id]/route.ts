import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

function parseDataImage(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+)(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1];
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  try {
    if (isBase64) {
      return { mime, buffer: Buffer.from(payload, 'base64') };
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

    let buffer = parsed.buffer;
    const isSvg = parsed.mime.includes('svg');

    if (isSvg) {
      const svgText = buffer.toString('utf8');
      // Basic SVG sanitization against stored XSS
      const sanitizedSvg = svgText
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/on\w+\s*=\s*(["']).*?\1/gi, '')
        .replace(/on\w+\s*=\s*[^>\s]+/gi, '')
        .replace(/javascript:/gi, '');
      buffer = Buffer.from(sanitizedSvg, 'utf8');
    }

    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': parsed.mime,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(isSvg
          ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }
          : {}),
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
