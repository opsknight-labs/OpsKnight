import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import {
  exportRequestSchema,
  exportComplianceEvidencePackage,
  EvidenceExportLimitExceededError,
  UnknownControlIdError,
} from '@/lib/compliance/export';

export async function POST(request: NextRequest) {
  try {
    // Both COMPLIANCE_EXPORT and COMPLIANCE_EVIDENCE_READ are strictly required
    const user = await assertCapability(CAPABILITIES.COMPLIANCE_EXPORT);
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

    const evidenceSelection = parsed.data
      .evidence as unknown as import('@/lib/compliance/export').EvidenceSelection;

    await emitAuditEvent({
      action: 'COMPLIANCE_EVIDENCE_EXPORT_STARTED',
      source: 'API',
      target: { type: 'COMPLIANCE_EVALUATION', id: 'compliance-export-package' },
      actor: { type: 'USER', id: user.id, email: user.email, name: user.name },
      metadata: {
        scopeType: parsed.data.scope.type,
        framework: parsed.data.scope.type === 'FRAMEWORK' ? parsed.data.scope.framework : null,
        evidenceMode: String(parsed.data.evidence.mode),
      },
    });

    try {
      const result = await exportComplianceEvidencePackage({
        scope: parsed.data.scope,
        evidenceSelection,
        userId: user.id,
      });

      await emitAuditEvent({
        action: 'COMPLIANCE_EVIDENCE_EXPORT_COMPLETED',
        source: 'API',
        target: { type: 'COMPLIANCE_EVALUATION', id: result.packageId },
        actor: { type: 'USER', id: user.id, email: user.email, name: user.name },
        metadata: {
          packageId: result.packageId,
          scopeType: parsed.data.scope.type,
          framework: parsed.data.scope.type === 'FRAMEWORK' ? parsed.data.scope.framework : null,
          controlCount: result.counts.controls,
          evidenceMode: String(parsed.data.evidence.mode),
          evidenceCount: result.counts.evidence,
          integrityMismatches: result.counts.integrityMismatches,
          manifestSha256: result.manifestResult.manifestSha256,
        },
      });

      return new Response(new Uint8Array(result.zipBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    } catch (err: unknown) {
      await emitAuditEvent({
        action: 'COMPLIANCE_EVIDENCE_EXPORT_FAILED',
        source: 'API',
        target: { type: 'COMPLIANCE_EVALUATION', id: 'compliance-export-failed' },
        actor: { type: 'USER', id: user.id, email: user.email, name: user.name },
        metadata: {
          scopeType: parsed.data.scope.type,
          error:
            err instanceof EvidenceExportLimitExceededError
              ? 'LIMIT_EXCEEDED'
              : err instanceof UnknownControlIdError
                ? 'UNKNOWN_CONTROL'
                : 'EXPORT_FAILED',
        },
      });

      if (err instanceof EvidenceExportLimitExceededError || err instanceof UnknownControlIdError) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: err.message,
          })
        );
      }

      throw err;
    }
  } catch (error: unknown) {
    return jsonError(error);
  }
}
