import type { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { readScopedPolicy, writeScopedPolicy } from '@/lib/response-policy-api';

const validScope = /^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/;

function scope(request: NextRequest) {
  return request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
}

export async function GET(request: NextRequest) {
  const scopeKey = scope(request);
  if (!validScope.test(scopeKey)) return jsonError('Invalid scopeKey', 400);
  return readScopedPolicy(request, scopeKey);
}

export async function PUT(request: NextRequest) {
  const scopeKey = scope(request);
  if (!validScope.test(scopeKey)) return jsonError('Invalid scopeKey', 400);
  return writeScopedPolicy(request, scopeKey);
}
