import { NextRequest } from 'next/server';
import { getUptimeExportResponse } from '@/app/api/status/uptime-export/route';

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return getUptimeExportResponse(req, slug);
}
