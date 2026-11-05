import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { unsubscribeByToken } from '@/lib/status-pages/unsubscribe';

export const dynamic = 'force-dynamic';

/**
 * RFC 8058 one-click unsubscribe target for the List-Unsubscribe header.
 * Mailbox providers (Gmail, Yahoo, Apple) POST `List-Unsubscribe=One-Click` here
 * with no cookies or Origin. No redirect, no confirmation page: just a 200.
 * GET is deliberately not supported, so link scanners can't unsubscribe anyone.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  let oneClick = false;
  try {
    const form = await req.formData();
    oneClick = form.get('List-Unsubscribe') === 'One-Click';
  } catch {
    oneClick = false;
  }
  if (!oneClick) {
    return jsonError('Expected List-Unsubscribe=One-Click', 400);
  }
  await unsubscribeByToken(token);
  // Same response whether or not the token matched, so tokens can't be probed.
  return new NextResponse(null, { status: 200 });
}
