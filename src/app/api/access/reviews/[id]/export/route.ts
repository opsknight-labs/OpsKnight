import { NextResponse } from 'next/server';

import { CAPABILITIES, capabilitiesOf } from '@/lib/authorization';
import { getCurrentUser } from '@/lib/rbac';
import { exportAccessReview } from '@/lib/access/admin';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { jsonApiError } from '@/lib/api-response';
import { describeRequirement } from '@/lib/access/catalog';

export const dynamic = 'force-dynamic';

/** Access review evidence (JSON download) for auditors. Admins and access reviewers only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const capabilities = capabilitiesOf(user);
    if (
      !capabilities.includes(CAPABILITIES.ADMIN_MANAGE) &&
      !capabilities.includes(CAPABILITIES.ACCESS_REVIEW_MANAGE)
    ) {
      const requirement = describeRequirement([
        CAPABILITIES.ADMIN_MANAGE,
        CAPABILITIES.ACCESS_REVIEW_MANAGE,
      ]);
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: `${requirement.summary} to export access reviews.`,
        details: { requiredCapabilities: requirement.anyOf },
      });
    }
    const { id } = await params;
    const evidence = await exportAccessReview(id);
    await logAudit({
      action: 'access_review.exported',
      entityType: 'ACCESS_REVIEW',
      entityId: id,
      actorId: user.id,
    });
    // A file download, not an API envelope.
    return new NextResponse(JSON.stringify(evidence, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="access-review-${id}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return jsonApiError(error);
  }
}
