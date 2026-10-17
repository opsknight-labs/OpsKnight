import { NextRequest } from 'next/server';
import { getStatusResponse } from './handler';
export async function GET(req: NextRequest) {
  return getStatusResponse(req);
}
