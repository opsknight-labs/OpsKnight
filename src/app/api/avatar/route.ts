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

function generateFallbackSvg(seed: string, bgColor: string, radius: string): string {
  const cleanSeed = decodeURIComponent(seed).replace(/-(male|female|nb|other|neutral)$/, '');
  const initial = cleanSeed.trim().slice(0, 2).toUpperCase() || 'U';
  const rx = radius === '0' ? '0' : '50';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#${bgColor}" rx="${rx}"/>
    <text x="50%" y="54%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="38" font-weight="600" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const styleParam = searchParams.get('style') || 'personas';
  const seed = searchParams.get('seed') || 'default';
  const backgroundColor = searchParams.get('backgroundColor') || '6366f1';
  const radiusParam = searchParams.get('radius') || '50';
  const formatParam = searchParams.get('format') || 'svg';

  // Validate style against whitelist
  const style = ALLOWED_STYLES.includes(styleParam as (typeof ALLOWED_STYLES)[number])
    ? styleParam
    : 'personas';

  // Validate format against whitelist
  const format = ALLOWED_FORMATS.includes(formatParam as (typeof ALLOWED_FORMATS)[number])
    ? formatParam
    : 'svg';

  // Validate radius is a number between 0-50
  const parsedRadius = parseInt(radiusParam, 10);
  const radius = (
    Number.isNaN(parsedRadius) ? 50 : Math.min(50, Math.max(0, parsedRadius))
  ).toString();

  // Validate backgroundColor is a valid hex color (6 chars, alphanumeric only)
  const bgColor = /^[a-fA-F0-9]{6}$/.test(backgroundColor) ? backgroundColor : '6366f1';

  // Construct the DiceBear URL with validated parameters
  const dicebearUrl = `https://api.dicebear.com/9.x/${style}/${format}?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=${radius}`;

  try {
    const response = await fetch(dicebearUrl, {
      headers: {
        Accept: 'image/*',
      },
      signal: AbortSignal.timeout(6000),
      // Cache for 1 day
      next: { revalidate: 86400 },
    });

    if (response.ok) {
      const contentType =
        response.headers.get('content-type') || (format === 'svg' ? 'image/svg+xml' : 'image/png');
      const buffer = await response.arrayBuffer();

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  } catch (error) {
    logger.warn('DiceBear upstream fetch failed, using local SVG fallback', {
      error: error instanceof Error ? error.message : String(error),
      style,
      seed,
    });
  }

  // Graceful local fallback: return crisp deterministic SVG
  const fallbackSvg = generateFallbackSvg(seed, bgColor, radius);
  return new NextResponse(fallbackSvg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
