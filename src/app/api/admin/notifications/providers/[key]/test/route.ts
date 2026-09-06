import { NextRequest } from 'next/server';
import { testNotificationProvider } from '@/app/(app)/settings/system/actions';
import { jsonError, jsonOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    const result = await testNotificationProvider(key);
    return jsonOk(result, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Unable to send test notification',
      500
    );
  }
}
