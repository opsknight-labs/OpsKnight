import { NextRequest, NextResponse } from 'next/server';
import { getLogBuffer } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';

function toNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  // Require ADMIN authentication to view logs
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = toNumber(searchParams.get('limit'), 200);
  const rawEntries = getLogBuffer(limit);

  const entries = rawEntries.map(entry => ({
    ...entry,
    error: entry.error
      ? {
          message: entry.error.message,
          name: entry.error.name,
        }
      : undefined,
  }));

  return NextResponse.json({ success: true, data: entries });
}
