import { z } from 'zod';

// A typo in a review must fail closed rather than silently changing exposure.
export const operationReviewSchema = z
  .object({
    status: z.enum([
      'CURATED',
      'DISCOVERABLE',
      'APPROVAL_REQUIRED',
      'UNSUPPORTED_WITH_REASON',
      'DENIED_WITH_REASON',
    ]),
    risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']),
    reason: z.string().trim().min(1),
    tool: z.string().trim().min(1).nullable(),
    routeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    contractSha256: z.string().regex(/^[a-f0-9]{64}$/),
    resourceFilter: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    actions: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((review, ctx) => {
    const exposed = review.status === 'CURATED' || review.status === 'DISCOVERABLE';
    if (exposed && !['R0', 'R1'].includes(review.risk))
      ctx.addIssue({
        code: 'custom',
        message: 'Sensitive operations require a separate reviewed workflow.',
      });
    // Approval-gated operations are never callable generically or through a named tool.
    if (review.status === 'APPROVAL_REQUIRED' && review.risk !== 'R2')
      ctx.addIssue({
        code: 'custom',
        message: 'Only sensitive configuration (R2) has an independent approval workflow.',
      });
    if ((review.status === 'CURATED') !== (review.tool !== null))
      ctx.addIssue({ code: 'custom', message: 'Only curated operations declare a named tool.' });
    if (new Set(review.actions).size !== review.actions.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate authorization action.' });
  });

export type OperationReview = z.infer<typeof operationReviewSchema>;
