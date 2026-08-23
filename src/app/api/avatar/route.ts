import { NextRequest, NextResponse } from 'next/server';
import { createAvatar } from '@dicebear/core';
import {
  initials,
  shapes,
  personas,
  identicon,
  avataaars,
  bottts,
  thumbs,
  lorelei,
  notionists,
  openPeeps,
  micah,
  miniavs,
  pixelArt,
  rings,
  glass,
} from '@dicebear/collection';
import { logger } from '@/lib/logger';

// Map of locally compiled DiceBear style engines (0ms in-process generation, 0 external network calls)
const STYLE_ENGINES: Record<string, any> = {
  initials,
  shapes,
  personas,
  identicon,
  avataaars,
  bottts,
  thumbs,
  lorelei,
  notionists,
  'open-peeps': openPeeps,
  micah,
  miniavs,
  'pixel-art': pixelArt,
  rings,
  glass,
};

function sanitizeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateFallbackSvg(seed: string, bgColor: string, radius: number): string {
  // Sanitize seed to safe alphanumeric characters only (prevent XML injection / reflected XSS)
  const cleanSeed = seed
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/-(male|female|nb|other|neutral)$/, '');
  const initial = sanitizeXml(cleanSeed.trim().slice(0, 2).toUpperCase() || 'U');
  const safeBg = /^[a-fA-F0-9]{6}$/.test(bgColor) ? bgColor : '6366f1';
  const rx = radius === 0 ? 0 : 50;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#${safeBg}" rx="${rx}"/>
    <text x="50%" y="54%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="38" font-weight="600" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const styleParam = (searchParams.get('style') || 'initials').toLowerCase();
  const rawSeed = searchParams.get('seed') || 'default';
  const backgroundColor = searchParams.get('backgroundColor') || '6366f1';
  const radiusParam = searchParams.get('radius') || '50';

  // Sanitize seed to alphanumeric, whitespace, hyphen, underscore only
  const sanitizedSeed = decodeURIComponent(rawSeed)
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .slice(0, 64);

  // Validate radius is a number between 0-50
  const parsedRadius = parseInt(radiusParam, 10);
  const radius = Number.isNaN(parsedRadius) ? 50 : Math.min(50, Math.max(0, parsedRadius));

  // Validate backgroundColor is a valid hex color (6 chars, alphanumeric only)
  const bgColor = /^[a-fA-F0-9]{6}$/.test(backgroundColor) ? backgroundColor : '6366f1';

  // Resolve style engine
  const styleEngine = STYLE_ENGINES[styleParam] || STYLE_ENGINES.initials;

  const securityHeaders = {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };

  try {
    const avatar = createAvatar(styleEngine, {
      seed: sanitizedSeed,
      backgroundColor: [bgColor],
      radius,
    });

    const svg = avatar.toString();

    return new NextResponse(svg, {
      headers: securityHeaders,
    });
  } catch (error) {
    logger.warn('Local avatar generation error, using fallback SVG', {
      error: error instanceof Error ? error.message : String(error),
      style: styleParam,
      seed: sanitizedSeed,
    });

    const fallbackSvg = generateFallbackSvg(sanitizedSeed, bgColor, radius);
    return new NextResponse(fallbackSvg, {
      headers: securityHeaders,
    });
  }
}
