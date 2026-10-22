import type { NextRequest } from 'next/server';
import { groups } from '@/lib/scim/lifecycle/groups';
import { handle } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest) {
  return handle(() => groups(request), request);
}

export async function POST(request: NextRequest) {
  return handle(() => groups(request), request);
}

export async function PATCH(request: NextRequest) {
  return handle(() => groups(request), request);
}
