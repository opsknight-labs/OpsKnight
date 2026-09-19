import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { complianceControls } from '@/lib/compliance/controls';
import { getControlFrameworkMappingsView } from '@/lib/compliance/framework-mappings';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const { id } = await params;
    const control = complianceControls.find(c => c.id === id);

    if (!control) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Control "${id}" not found.`,
      });
    }

    const mappings = getControlFrameworkMappingsView(id);

    return jsonOk({
      controlId: id,
      controlTitle: control.title,
      mappings,
    });
  } catch (error) {
    return jsonError(error);
  }
}
