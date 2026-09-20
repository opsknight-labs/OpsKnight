import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getComplianceControlCenterData } from '@/lib/compliance/control-center';

export async function GET() {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const data = await getComplianceControlCenterData();

    return jsonOk(data, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
