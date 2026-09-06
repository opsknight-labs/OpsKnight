import prisma from '@/lib/prisma';
import Link from 'next/link';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function VerifySubscriptionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let status: 'invalid' | 'already_verified' | 'success' | 'error' = 'error';
  let subscription = null;

  try {
    const sub = await prisma.statusPageSubscription.findFirst({
      where: { verificationToken: token },
      include: {
        statusPage: true,
      },
    });

    if (!sub) {
      status = 'invalid';
    } else if (sub.verified) {
      status = 'already_verified';
      subscription = sub;
    } else {
      // Verify
      await prisma.statusPageSubscription.update({
        where: { id: sub.id },
        data: {
          verified: true,
          verificationToken: null,
        },
      });
      status = 'success';
      subscription = sub;
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
            href="/status"
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
            Email Verified Successfully
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
            Your email address has been verified. You will now receive email notifications about
            incidents and status changes for {subscription.statusPage.name}.
          </p>
          <a
            href="/status"
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
