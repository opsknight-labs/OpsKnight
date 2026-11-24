import { NextRequest, NextResponse } from 'next/server';
import { getStatusPageSnapshotByRoute } from '@/lib/status-pages/snapshot';
import { buildStatusBadge } from '@/lib/status-pages/badge';
import { etagMatches, statusCacheControl, statusEtag } from '@/lib/status-pages/cache-policy';
import { isStatusPageSlug } from '@/lib/validation';

/** Overall-status SVG badge. Gated pages answer 404 so a badge can never reveal their existence. */
export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isStatusPageSlug(slug)) return new NextResponse(null, { status: 404 });
  const projected = await getStatusPageSnapshotByRoute(slug);
  const snapshot = projected.snapshot;
  const page = snapshot?.page;
  if (
    !snapshot ||
    !page ||
    page.enabled === false ||
    page.requireAuth ||
    page.statusApiRequireToken
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const etag = statusEtag([page.id, snapshot.revision, 'badge']);
  const headers = { 'Cache-Control': statusCacheControl(page), ETag: etag };
  if (etagMatches(req.headers.get('if-none-match'), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(buildStatusBadge(page.name, snapshot.status), {
    headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}
