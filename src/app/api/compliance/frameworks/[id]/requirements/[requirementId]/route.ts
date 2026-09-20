import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import type { ComplianceFramework } from '@/lib/compliance/types';
import {
  getFramework,
  getFrameworkRequirementDetailView,
} from '@/lib/compliance/framework-mappings';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; requirementId: string }> }
) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const { id, requirementId } = await params;
    const framework = getFramework(id as ComplianceFramework);

    if (!framework) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Framework "${id}" not found.`,
      });
    }

    const detailView = await getFrameworkRequirementDetailView(requirementId);

    if (!detailView || detailView.requirement.framework !== (id as ComplianceFramework)) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Requirement "${requirementId}" not found in framework "${id}".`,
      });
    }

    return jsonOk({
      requirement: detailView,
    });
  } catch (error) {
    return jsonError(error);
  }
}
