import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { statusPageSlugMatches } from '@/lib/status-page-resolver';
import { hashSubscriptionToken } from '@/lib/status-pages/subscription-tokens';

export const dynamic = 'force-dynamic';

function isVerificationExpired(subscription: {
  verificationTokenExpiresAt?: Date | null;
}): boolean {
  if (!subscription.verificationTokenExpiresAt) return false;
  return new Date(subscription.verificationTokenExpiresAt).getTime() < Date.now();
}

export default async function VerifySubscriptionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return renderVerifySubscriptionPage(token);
}

export async function renderVerifySubscriptionPage(token: string, expectedSlug?: string) {
  let status: 'invalid' | 'already_verified' | 'success' | 'error' = 'error';
  let subscription = null;

  try {
    const sub = await prisma.statusPageSubscription.findFirst({
      where: { verificationToken: hashSubscriptionToken(token), unsubscribedAt: null },
      include: {
        statusPage: true,
      },
    });

    if (!sub || !statusPageSlugMatches(sub.statusPage.slug, expectedSlug)) {
      status = 'invalid';
    } else if (
      isVerificationExpired(sub as unknown as { verificationTokenExpiresAt: Date | null })
    ) {
      status = 'invalid';
    } else {
      const prefs = sub.preferences as Record<string, unknown> | null;
      const hasPendingPreferenceChange =
        sub.state === 'ACTIVE' &&
        (prefs as Record<string, unknown> | null)?._pendingPreferences !== undefined;
      if (hasPendingPreferenceChange) {
        // ACTIVE subscriber with a pending preference change must be able to
        // reach the confirmation form even though verified is still true.
        status = 'success';
        subscription = sub;
      } else if (sub.verified) {
        status = 'already_verified';
        subscription = sub;
      } else {
        // GET only displays confirmation; email scanners cannot verify a subscription.
        status = 'success';
        subscription = sub;
      }
    }
  } catch (error) {
    logger.error('Verify error', { component: 'status-verify-page', error });
    status = 'error';
  }

  if (status === 'invalid') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '600px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
            Invalid Verification Link
          </h1>
          <p style={{ color: '#6b7280' }}>This verification link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (status === 'already_verified' && subscription) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '600px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
            Already Verified
          </h1>
          <p style={{ color: '#6b7280' }}>
            Your email address has already been verified for {subscription.statusPage.name} status
            updates.
          </p>
          <a
            href={getStatusPagePublicUrl(subscription.statusPage)}
            style={{
              display: 'inline-block',
              marginTop: '1.5rem',
              padding: '0.75rem 1.5rem',
              background: '#667eea',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '0.5rem',
              fontWeight: '600',
            }}
          >
            View Status Page
          </a>
        </div>
      </div>
    );
  }

  if (status === 'success' && subscription) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#f9fafb',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            maxWidth: '600px',
            background: 'white',
            padding: '3rem',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
            Confirm Email Subscription
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
            Confirm that you want to receive email notifications about incidents and status changes
            for {subscription.statusPage.name}.
          </p>
          <form method="POST" action="/api/status/subscriptions/verify">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="slug" value={expectedSlug || ''} />
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 font-semibold text-white"
            >
              Confirm subscription
            </button>
          </form>
          <a
            href={getStatusPagePublicUrl(subscription.statusPage)}
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              background: '#667eea',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '0.5rem',
              fontWeight: '600',
            }}
          >
            View Status Page
          </a>
        </div>
      </div>
    );
  }

  // Error case
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: '600px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Error</h1>
        <p style={{ color: '#6b7280' }}>
          An error occurred while processing your verification request.
        </p>
      </div>
    </div>
  );
}
