import { jsonOk, jsonError } from '@/lib/api-response';
import { readIntegrationBody } from '@/lib/integrations/request-security';
import { NextRequest } from 'next/server';
import { getAutomationArea, automationAction } from '@/app/(app)/services/[id]/automation/actions';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pageText = req.nextUrl.searchParams.get('page') ?? '1';
    const page = Number(pageText);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      return jsonError('Invalid page', 400);
    return jsonOk(
      await getAutomationArea(id, req.nextUrl.searchParams.get('area') ?? 'overview', page)
    );
  } catch {
    return jsonError('Automation access denied', 403);
  }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Session-authenticated browser API; Server Actions enforce their own origin check.
  const origin = req.headers.get('origin');
  if (!origin || origin !== req.nextUrl.origin) return jsonError('Invalid request origin', 403);
  if (Number(req.headers.get('content-length') ?? 0) > 256 * 1024)
    return jsonError('Request too large', 413);
  try {
    const bodyText = await readIntegrationBody(req, 256 * 1024);
    if (bodyText.length > 256 * 1024) return jsonError('Request too large', 413);
    const { id } = await params;
    const body: unknown = JSON.parse(bodyText);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return jsonError('Invalid request', 400);
    const result = await automationAction({ ...body, serviceId: id });
    return result.ok ? jsonOk(result.data) : jsonError(result.error, result.conflict ? 409 : 400);
  } catch {
    return jsonError('Invalid automation request', 400);
  }
}
