import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

// Whitelist allowed styles and formats to prevent injection attacks
const ALLOWED_STYLES = [
  'big-smile',
  'avataaars',
  'bottts',
  'identicon',
  'initials',
  'lorelei',
  'micah',
  'miniavs',
  'notionists',
  'open-peeps',
  'personas',
  'pixel-art',
  'shapes',
  'thumbs',
] as const;

const ALLOWED_FORMATS = ['png', 'svg', 'jpg'] as const;

/**
 * Avatar Proxy API Route
 *
 * This proxies DiceBear avatar requests through our own domain to avoid
 * CSP/infrastructure blocks in production environments.
 *
 * Usage: /api/avatar?style=big-smile&seed=user-123&backgroundColor=b91c1c&radius=50
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const styleParam = searchParams.get('style') || 'big-smile';
  const seed = searchParams.get('seed') || 'default';
  const backgroundColor = searchParams.get('backgroundColor') || '84cc16';
  const radiusParam = searchParams.get('radius') || '50';
  const formatParam = searchParams.get('format') || 'png';

  // Validate style against whitelist
  const style = ALLOWED_STYLES.includes(styleParam as (typeof ALLOWED_STYLES)[number])
    ? styleParam
    : 'big-smile';

  // Validate format against whitelist
  const format = ALLOWED_FORMATS.includes(formatParam as (typeof ALLOWED_FORMATS)[number])
    ? formatParam
    : 'png';

  // Validate radius is a number between 0-50
  const parsedRadius = parseInt(radiusParam, 10);
  const radius = (
    Number.isNaN(parsedRadius) ? 50 : Math.min(50, Math.max(0, parsedRadius))
  ).toString();

  // Validate backgroundColor is a valid hex color (6 chars, alphanumeric only)
  const bgColor = /^[a-fA-F0-9]{6}$/.test(backgroundColor) ? backgroundColor : '84cc16';

  // Construct the DiceBear URL with validated parameters
  const dicebearUrl = `https://api.dicebear.com/9.x/${style}/${format}?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=${radius}`;

  try {
    const response = await fetch(dicebearUrl, {
      headers: {
        Accept: 'image/*',
      },
      signal: AbortSignal.timeout(5000),
      // Cache for 1 day
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch avatar' }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        // Cache avatars for 1 year - URL changes (via seed param) handle cache invalidation
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    logger.error('Avatar proxy error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to proxy avatar' }, { status: 500 });
  }
}
