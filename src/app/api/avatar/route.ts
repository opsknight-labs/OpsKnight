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
  // eslint-disable-line @typescript-eslint/no-explicit-any
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

function generateFallbackSvg(seed: string, bgColor: string, radius: number): string {
  const cleanSeed = decodeURIComponent(seed).replace(/-(male|female|nb|other|neutral)$/, '');
  const initial = cleanSeed.trim().slice(0, 2).toUpperCase() || 'U';
  const rx = radius === 0 ? 0 : 50;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#${bgColor}" rx="${rx}"/>
    <text x="50%" y="54%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="38" font-weight="600" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const styleParam = searchParams.get('style') || 'initials';
  const seed = searchParams.get('seed') || 'default';
  const backgroundColor = searchParams.get('backgroundColor') || '6366f1';
  const radiusParam = searchParams.get('radius') || '50';

  // Validate radius is a number between 0-50
  const parsedRadius = parseInt(radiusParam, 10);
  const radius = Number.isNaN(parsedRadius) ? 50 : Math.min(50, Math.max(0, parsedRadius));

  // Validate backgroundColor is a valid hex color (6 chars, alphanumeric only)
  const bgColor = /^[a-fA-F0-9]{6}$/.test(backgroundColor) ? backgroundColor : '6366f1';

  // Resolve style engine
  const styleEngine = STYLE_ENGINES[styleParam] || STYLE_ENGINES.initials;

  try {
    const avatar = createAvatar(styleEngine, {
      seed: decodeURIComponent(seed),
      backgroundColor: [bgColor],
      radius,
    });

    const svg = avatar.toString();

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logger.warn('Local avatar generation error, using fallback SVG', {
      error: error instanceof Error ? error.message : String(error),
      style: styleParam,
      seed,
    });

    const fallbackSvg = generateFallbackSvg(seed, bgColor, radius);
    return new NextResponse(fallbackSvg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
