import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { getReviewConfig } from '@/lib/business-services/reviews/config';
import ServiceReviewToggle from './ServiceReviewToggle';

/** Shown only when an admin enabled reviews and the viewer is a responder or admin. */
export default async function MyServiceReview({ userId }: { userId: string }) {
  const [permissions, config] = await Promise.all([getUserPermissions(), getReviewConfig()]);
  if (!config.enabled || !permissions.isResponderOrAbove) return null;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { receiveServiceReviews: true },
  });
  return <ServiceReviewToggle enabled={row?.receiveServiceReviews ?? false} />;
}
