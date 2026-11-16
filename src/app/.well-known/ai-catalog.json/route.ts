import { aiCatalogResponse, serverCardPreflight } from '@/lib/mcp/protocol/server-card';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return aiCatalogResponse(request);
}

export const OPTIONS = serverCardPreflight;
