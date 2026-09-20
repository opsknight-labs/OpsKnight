import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getComplianceMonitoringStatus } from '@/lib/compliance/monitoring/status';

export async function GET(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const status = await getComplianceMonitoringStatus();

    return jsonOk(status);
  } catch (err: unknown) {
    return jsonError(err);
  }
}
