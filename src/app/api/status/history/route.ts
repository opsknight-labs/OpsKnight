import { NextRequest } from 'next/server';
import { getStatusHistoryResponse } from './handler';
export async function GET(req: NextRequest) {
  return getStatusHistoryResponse(req);
}
