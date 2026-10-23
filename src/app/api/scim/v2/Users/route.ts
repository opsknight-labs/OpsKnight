import type { NextRequest } from 'next/server';
import { users } from '@/lib/scim/lifecycle/users';
import { handle, collectionMethodNotAllowed } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest) {
  return handle(() => users(request), request);
}

export async function POST(request: NextRequest) {
  return handle(() => users(request), request);
}

export function PATCH() {
  return collectionMethodNotAllowed();
}
export function PUT() {
  return collectionMethodNotAllowed();
}
export function DELETE() {
  return collectionMethodNotAllowed();
}
