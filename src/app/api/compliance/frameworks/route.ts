import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import {
  getAllFrameworks,
  getFrameworkSummaryView,
  computeFrameworkMappingFingerprint,
} from '@/lib/compliance/framework-mappings';

export async function GET() {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const frameworks = getAllFrameworks();
    const summaries = frameworks.map(f => getFrameworkSummaryView(f.id)!);
    const mappingFingerprint = computeFrameworkMappingFingerprint();

    return jsonOk({
      frameworks: summaries,
      mappingFingerprint,
    });
  } catch (error) {
    return jsonError(error);
  }
}
