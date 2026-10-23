import type { NextRequest } from 'next/server';
import { groups } from '@/lib/scim/lifecycle/groups';
import { handle } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(() => groups(request, id), request);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(() => groups(request, id), request);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(() => groups(request, id), request);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(() => groups(request, id), request);
}
