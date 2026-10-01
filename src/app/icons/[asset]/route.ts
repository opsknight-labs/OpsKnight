import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

type IconSpec = {
  size: number;
  logoScale: number;
};

const ICON_BACKGROUND = '#0f172a';

// The canonical URLs are versioned by name so iOS/Android do not reuse the
// old, visually off-centre install artwork from their icon caches.
const ICON_SPECS = new Map<string, IconSpec>([
  ['opsknight-192.png', { size: 192, logoScale: 0.78 }],
  ['opsknight-512.png', { size: 512, logoScale: 0.78 }],
  ['opsknight-maskable-192.png', { size: 192, logoScale: 0.65 }],
  ['opsknight-maskable-512.png', { size: 512, logoScale: 0.65 }],
  ['opsknight-apple-touch.png', { size: 180, logoScale: 0.78 }],

  // Compatibility aliases for older manifests and queued Push payloads. The
  // stale PNG files are deliberately removed, so these names now render the
  // corrected centered artwork too.
  ['app-icon-192.png', { size: 192, logoScale: 0.78 }],
  ['app-icon-512.png', { size: 512, logoScale: 0.78 }],
  ['app-icon-maskable-192.png', { size: 192, logoScale: 0.65 }],
  ['app-icon-maskable-512.png', { size: 512, logoScale: 0.65 }],
  ['apple-touch-icon.png', { size: 180, logoScale: 0.78 }],
]);

let cachedLogoDataUrl: string | null = null;

function opsKnightLogoDataUrl() {
  if (!cachedLogoDataUrl) {
    const logo = readFileSync(join(process.cwd(), 'public', 'logo.png'));
    cachedLogoDataUrl = `data:image/png;base64,${logo.toString('base64')}`;
  }
  return cachedLogoDataUrl;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> }
) {
  const { asset } = await params;
  const spec = ICON_SPECS.get(asset);

  if (!spec) {
    return new Response('Not found', { status: 404 });
  }

  const logoSize = Math.round(spec.size * spec.logoScale);

  return new ImageResponse(
    createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ICON_BACKGROUND,
        },
      },
      createElement('img', {
        src: opsKnightLogoDataUrl(),
        width: logoSize,
        height: logoSize,
        alt: '',
        style: { objectFit: 'contain' },
      })
    ),
    {
      width: spec.size,
      height: spec.size,
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    }
  );
}
