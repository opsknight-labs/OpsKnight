import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  return NextResponse.json({
    data: {
      serverTime: now.toISOString(),
      epochMs: now.getTime(),
    },
  });
}
