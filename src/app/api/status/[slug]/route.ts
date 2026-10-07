import { NextRequest } from 'next/server';
import { getStatusResponse } from '../handler';

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return getStatusResponse(req, slug);
}
