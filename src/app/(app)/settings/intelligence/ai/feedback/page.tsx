import { forbidden } from 'next/navigation';
import { MessageSquareWarning } from 'lucide-react';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { actorHasCapability } from '@/lib/authorization-policy';
import {
  FEEDBACK_REVIEW_STATUSES,
  listFeedbackForReview,
  type FeedbackReviewStatus,
} from '@/lib/intelligence/assistant/feedback';
import type { RouteSearchParams } from '@/lib/intelligence/settings/routes';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import IntelligenceSubNav from '@/components/settings/layout/IntelligenceSubNav';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui';
import FeedbackReviewList from './FeedbackReviewList';
import { getAiSettings } from '@/lib/intelligence/ai/settings';
import {
  dismissFeedbackAction,
  feedbackEvalCaseAction,
  learnFromFeedbackAction,
  markFeedbackLearnedAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Recent 👍/👎 on Squire answers, for intelligence administrators to turn into knowledge or eval cases. */
export default async function SquireFeedbackPage({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/ai/feedback');
  const actor = await getCurrentAuthorizationActor();
  if (!actorHasCapability(actor, CAPABILITIES.INTELLIGENCE_MANAGE)) forbidden();
  const requested = one((await searchParams)?.status) ?? 'NEW';
  const status = (FEEDBACK_REVIEW_STATUSES as readonly string[]).includes(requested)
    ? (requested as FeedbackReviewStatus)
    : undefined;
  const [rows, settings] = await Promise.all([
    listFeedbackForReview(actor, { status, limit: 100 }),
    getAiSettings(),
  ]);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        eyebrow="AIOps Intelligence"
        title="Squire feedback"
        description="What people rated, and why. Teach Squire a service fact, keep a case for the evaluation suite, or dismiss it."
        icon={MessageSquareWarning}
        trail={[{ label: 'Assistant', href: '/settings/intelligence/ai' }, { label: 'Feedback' }]}
      />
      <IntelligenceSubNav />
      <SettingsSection
        title="Recent feedback"
        description="Newest first. Who rated an answer is never shown, and the question is kept only as a digest."
        contentClassName="p-0"
        action={
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Status
              <select name="status" defaultValue={status ?? 'ALL'} className={selectClass}>
                <option value="NEW">New</option>
                <option value="LEARNED">Learned</option>
                <option value="DISMISSED">Dismissed</option>
                <option value="ALL">Any</option>
              </select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </form>
        }
      >
        {rows.length > 0 ? (
          <FeedbackReviewList
            key={status ?? 'ALL'}
            rows={rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))}
            actions={{
              learn: learnFromFeedbackAction,
              evalCase: feedbackEvalCaseAction,
              dismiss: dismissFeedbackAction,
              markLearned: markFeedbackLearnedAction,
            }}
            assistantName={settings.squireName}
          />
        ) : (
          <EmptyState
            title="No feedback here"
            description="Ratings appear when people use 👍 or 👎 under a Squire answer."
          />
        )}
      </SettingsSection>
    </div>
  );
}
