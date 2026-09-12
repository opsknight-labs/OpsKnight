import type { NextRequest } from 'next/server';
import { readScopedPolicy, writeScopedPolicy } from '@/lib/response-policy-api';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  return readScopedPolicy(request, `service:${(await context.params).id}`);
}
export async function PUT(request: NextRequest, context: Context) {
  return writeScopedPolicy(request, `service:${(await context.params).id}`);
}
