import type { NextRequest } from 'next/server';
import { users } from '@/lib/scim/lifecycle/users';
import { handle } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest) {
  return handle(() => users(request), request);
}

export async function POST(request: NextRequest) {
  return handle(() => users(request), request);
}

export async function PATCH(request: NextRequest) {
  return handle(() => users(request), request);
}
