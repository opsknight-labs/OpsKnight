import prisma from '@/lib/prisma';
import Link from 'next/link';
import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let subscription = null;

  try {
    subscription = await prisma.statusPageSubscription.findUnique({
      where: { token },
      include: {
        statusPage: true,
      },
    });
  } catch (error) {
    logger.error('Unsubscribe fetch error', { component: 'status-unsubscribe-page', error });
  }

  if (!subscription) {
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
            Invalid Unsubscribe Link
          </h1>
          <p style={{ color: '#6b7280' }}>This unsubscribe link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (subscription.unsubscribedAt) {
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
            Already Unsubscribed
          </h1>
          <p style={{ color: '#6b7280' }}>
            You have already unsubscribed from {subscription.statusPage.name} status updates.
          </p>
        </div>
      </div>
    );
  }

  // Server action for processing unsubscription
  async function performUnsubscribe() {
    'use server';
    try {
      await prisma.statusPageSubscription.update({
        where: { token },
        data: { unsubscribedAt: new Date() },
      });
      revalidatePath(`/status/unsubscribe/${token}`);
    } catch (err) {
      logger.error('Unsubscribe mutation error', { err });
    }
  }

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
          borderRadius: '0.75rem',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
          border: '1px solid #e5e7eb',
        }}
      >
        <h1
          style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', color: '#111827' }}
        >
          Confirm Unsubscribe
        </h1>
        <p style={{ color: '#4b5563', marginBottom: '2rem', lineHeight: 1.5 }}>
          Are you sure you want to stop receiving status updates for{' '}
          <strong>{subscription.statusPage.name}</strong> ({subscription.email})?
        </p>

        <form action={performUnsubscribe}>
          <button
            type="submit"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              background: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Unsubscribe from Updates
          </button>
        </form>

        <div style={{ marginTop: '1.5rem' }}>
          <Link
            href="/status"
            style={{
              color: '#6b7280',
              fontSize: '0.875rem',
              textDecoration: 'underline',
            }}
          >
            Cancel and Return to Status Page
          </Link>
        </div>
      </div>
    </div>
  );
}
