import { NextRequest } from 'next/server';
import { z } from 'zod';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { evaluateControls } from '@/lib/compliance/evaluation';

const evaluateSchema = z.object({
  controlIds: z.array(z.string().min(1)).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await assertCapability(CAPABILITIES.COMPLIANCE_EVALUATE);

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

    const parsed = evaluateSchema.safeParse(body);
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

    const result = await evaluateControls({
      controlIds: parsed.data.controlIds,
      trigger: 'API',
      actor: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });

    return jsonOk(result);
  } catch (error: unknown) {
    return jsonError(error);
  }
}
