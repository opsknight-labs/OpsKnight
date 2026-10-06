import { jsonOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  return jsonOk({
    serverTime: now.toISOString(),
    epochMs: now.getTime(),
  });
}
