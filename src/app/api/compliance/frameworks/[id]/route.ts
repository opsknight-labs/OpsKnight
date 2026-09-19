import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import type { ComplianceFramework } from '@/lib/compliance/types';
import {
  getFrameworkSummaryView,
  computeFrameworkMappingFingerprint,
} from '@/lib/compliance/framework-mappings';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const { id } = await params;
    const summary = getFrameworkSummaryView(id as ComplianceFramework);

    if (!summary) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Framework "${id}" not found.`,
      });
    }

    return jsonOk({
      framework: summary,
      mappingFingerprint: computeFrameworkMappingFingerprint(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
