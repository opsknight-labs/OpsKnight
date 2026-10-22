import type { NextRequest } from 'next/server';
import { groups } from '@/lib/scim/lifecycle/groups';
import { handle, collectionMethodNotAllowed } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest) {
  return handle(() => groups(request), request);
}

export async function POST(request: NextRequest) {
  return handle(() => groups(request), request);
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
