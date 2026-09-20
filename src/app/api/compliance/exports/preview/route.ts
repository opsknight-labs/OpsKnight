import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import {
  exportRequestSchema,
  previewComplianceEvidencePackage,
  UnknownControlIdError,
} from '@/lib/compliance/export';

export async function POST(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_EXPORT);
    await assertCapability(CAPABILITIES.COMPLIANCE_EVIDENCE_READ);

    let body: unknown = {};
    const text = await request.text();
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        return jsonError(
          new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Invalid JSON body' })
        );
      }
    }

    const parsed = exportRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }

    try {
      const preview = await previewComplianceEvidencePackage({
        scope: parsed.data.scope,
        evidenceSelection: parsed.data.evidence,
      });
      return jsonOk(preview);
    } catch (err: unknown) {
      if (err instanceof UnknownControlIdError) {
        return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: err.message }));
      }
      throw err;
    }
  } catch (error: unknown) {
    return jsonError(error);
  }
}
