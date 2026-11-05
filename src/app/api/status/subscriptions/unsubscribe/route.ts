import { NextRequest, NextResponse } from 'next/server';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { unsubscribeByToken } from '@/lib/status-pages/unsubscribe';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let token = '';
  let expectedSlug = '';

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await req.json();
      token = String(body.token || '');
      expectedSlug = String(body.expectedSlug || '');
    } catch {}
  } else {
    try {
      const form = await req.formData();
      token = String(form.get('token') || '');
      expectedSlug = String(form.get('expectedSlug') || '');
    } catch {}
  }

  const subscription = await unsubscribeByToken(token, expectedSlug);
  if (subscription) {
    const publicBase = getStatusPagePublicUrl(subscription.statusPage);
    const destination = `${publicBase.replace(/\/$/, '')}/unsubscribe/${encodeURIComponent(token)}?done=1`;
    return NextResponse.redirect(new URL(destination, req.url), 303);
  }

  return NextResponse.redirect(new URL('/status', req.url), 303);
}
