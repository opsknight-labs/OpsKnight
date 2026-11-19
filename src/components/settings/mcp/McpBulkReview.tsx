'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  bulkReviewOperations,
  type BulkReviewResult,
} from '@/app/(app)/settings/integrations/mcp/approvals/actions';
import { reviewMessage } from '@/app/(app)/settings/integrations/mcp/approvals/review-result';

/** The row checkboxes live in the table and join this form through its id. */
export const MCP_BULK_REVIEW_FORM = 'mcp-bulk-review';

function summary(result: BulkReviewResult) {
  const verb = result.decision === 'approve' ? 'Approved' : 'Rejected';
  const done = `${verb} ${result.done} request${result.done === 1 ? '' : 's'}.`;
  if (!result.skipped.length) return done;
  // One reason is enough to act on; the skipped rows stay in the queue with their own pages.
  return `${done} ${result.skipped.length} left unchanged: ${reviewMessage(result.skipped[0].code)}`;
}

/** Approve or reject the ticked configuration changes in one step. */
export default function McpBulkReview() {
  const [result, action, pending] = useActionState(bulkReviewOperations, null);
  const [empty, setEmpty] = useState(false);
  return (
    <form
      id={MCP_BULK_REVIEW_FORM}
      action={action}
      onSubmit={event => {
        const ticked = document.querySelectorAll(
          `input[form="${MCP_BULK_REVIEW_FORM}"]:checked`
        ).length;
        setEmpty(ticked === 0);
        if (ticked === 0) event.preventDefault();
      }}
      className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center md:px-6"
    >
      <div className="flex gap-2">
        <Button
          type="submit"
          name="decision"
          value="approve"
          size="sm"
          disabled={pending}
          title="Only medium-risk changes can be approved together"
        >
          Approve selected
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          size="sm"
          variant="outline"
          disabled={pending}
        >
          Reject selected
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {empty
          ? 'Tick at least one request first.'
          : result
            ? summary(result)
            : 'Approving together works for medium-risk changes only; open a high-risk change to approve it.'}
      </p>
    </form>
  );
}
