import { serverCardPreflight, serverCardResponse } from '@/lib/mcp/protocol/server-card';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return serverCardResponse(request);
}

export const OPTIONS = serverCardPreflight;
