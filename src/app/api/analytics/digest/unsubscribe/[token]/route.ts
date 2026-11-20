import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { unsubscribeWeeklyDigestByToken } from '@/lib/analytics/digest';

export const dynamic = 'force-dynamic';

/**
 * RFC 8058 one-click unsubscribe for the weekly analytics summary (List-Unsubscribe header).
 * Mail providers POST `List-Unsubscribe=One-Click` with no cookies, so this is public and
 * token-authenticated. GET is not supported, so link scanners can't unsubscribe anyone.
 * Always 200 for a well-formed request, so tokens can't be probed.
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
  if (!oneClick) return jsonError('Expected List-Unsubscribe=One-Click', 400);
  await unsubscribeWeeklyDigestByToken(token);
  return new NextResponse(null, { status: 200 });
}
