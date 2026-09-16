import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getPrivacyRequest } from '@/lib/privacy/requests';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.PRIVACY_READ);
    const { id } = await params;

    const request = await getPrivacyRequest(id);
    if (!request) {
      return jsonError(new AppError({ code: 'PRIVACY_REQUEST_NOT_FOUND' }));
    }

    return jsonOk({ request }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to load privacy request', 500);
  }
}
