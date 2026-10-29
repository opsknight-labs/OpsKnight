import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { getUserPermissions } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import {
  applyIngestionCommand,
  IngestionCommand,
  ingestionSnapshot,
} from '@/lib/ingestion/operations';
import { readIntegrationBody } from '@/lib/integrations/request-security';

const querySchema = z.object({ receiptId: z.string().uuid().optional() }).strict();

export async function GET(request: NextRequest) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) return jsonError('Authentication required', 401);
  if (!permissions.capabilities.includes('admin.manage'))
    return jsonError('Admin access required', 403);
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return jsonError('Invalid ingestion query', 400);
  try {
    return jsonOk(await ingestionSnapshot(parsed.data.receiptId));
  } catch {
    return jsonError('Ingestion status unavailable', 503);
  }
}

export async function POST(request: NextRequest) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) return jsonError('Authentication required', 401);
  if (!permissions.capabilities.includes('admin.manage'))
    return jsonError('Admin access required', 403);
  let command: z.infer<typeof IngestionCommand>;
  try {
    command = IngestionCommand.parse(JSON.parse(await readIntegrationBody(request)));
  } catch {
    return jsonError('Invalid ingestion command', 400);
  }
  try {
    return jsonOk(await applyIngestionCommand(command, permissions.id));
  } catch {
    return jsonError('Ingestion command could not be applied', 409);
  }
}
