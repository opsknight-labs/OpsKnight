import { NextRequest } from 'next/server';
import { subscribeToStatusPage } from './handler';
export async function POST(req: NextRequest) {
  return subscribeToStatusPage(req);
}
