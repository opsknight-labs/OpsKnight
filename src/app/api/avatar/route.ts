import { NextRequest, NextResponse } from 'next/server';
import { createAvatar, type Style } from '@dicebear/core';
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

// Locally compiled DiceBear style engines (in-process generation, no external network calls). A Map, so a
// request's `style` is looked up by key and can never reach an inherited property.
const STYLE_ENGINES = new Map<string, Style<object>>(
  Object.entries({
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
  })
);

function sanitizeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Letters in any script, digits, whitespace, hyphen and underscore only (prevents XML injection / reflected XSS). */
function cleanSeed(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s_-]/gu, '');
}

function generateFallbackSvg(seed: string, bgColor: string, radius: number): string {
  // The seed is already sanitized; strip a legacy gender suffix and take the first two characters (by code
  // point, so a letter outside the Latin range is not split).
  const stripped = cleanSeed(seed).replace(/-(male|female|nb|other|neutral)$/, '');
  const initial = sanitizeXml(
    Array.from(stripped.trim()).slice(0, 2).join('').toUpperCase() || 'U'
  );
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

  // Sanitize seed to letters (any script), digits, whitespace, hyphen and underscore only. searchParams has
  // already decoded the value, so decoding again would throw on a literal "%" (a 500 for that seed).
  const sanitizedSeed = cleanSeed(rawSeed).slice(0, 64);

  // Validate radius is a number between 0-50
  const parsedRadius = parseInt(radiusParam, 10);
  const radius = Number.isNaN(parsedRadius) ? 50 : Math.min(50, Math.max(0, parsedRadius));

  // Validate backgroundColor is a valid hex color (6 chars, alphanumeric only)
  const bgColor = /^[a-fA-F0-9]{6}$/.test(backgroundColor) ? backgroundColor : '6366f1';

  // Resolve style engine
  const styleEngine = STYLE_ENGINES.get(styleParam) ?? initials;

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

    // If style is initials and Dicebear generated empty text (e.g. for numeric seeds like "2"),
    // fall back to clean SVG with seed initials/number so user never gets a blank avatar.
    if (styleParam === 'initials' && /<text[^>]*>\s*<\/text>/.test(svg)) {
      const fallbackSvg = generateFallbackSvg(sanitizedSeed, bgColor, radius);
      return new NextResponse(fallbackSvg, {
        headers: securityHeaders,
      });
    }

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
