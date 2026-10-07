import { NextRequest } from 'next/server';
import { getStatusHistoryResponse } from '@/app/api/status/history/handler';

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return getStatusHistoryResponse(req, slug);
}
