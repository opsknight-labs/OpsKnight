import prisma from '@/lib/prisma';
import Link from 'next/link';
import { logger } from '@/lib/logger';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function confirmUnsubscribe(formData: FormData) {
  'use server';
  const token = String(formData.get('token') || '');
  if (token) {
    await prisma.statusPageSubscription.updateMany({
      where: { token, unsubscribedAt: null },
      data: { unsubscribedAt: new Date() },
    });
  }
  redirect(`/status/unsubscribe/${encodeURIComponent(token)}?done=1`);
}

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = (await searchParams) ?? {};
  let status: 'invalid' | 'already_unsubscribed' | 'confirm' | 'success' | 'error' = 'error';
  let subscription = null;

  try {
    const sub = await prisma.statusPageSubscription.findUnique({
      where: { token },
      include: {
        statusPage: true,
      },
    });

    if (!sub) {
      status = 'invalid';
    } else if (done === '1' && sub.unsubscribedAt) {
      status = 'success';
      subscription = sub;
    } else if (sub.unsubscribedAt) {
      status = 'already_unsubscribed';
      subscription = sub;
    } else {
      status = done === '1' ? 'success' : 'confirm';
      subscription = sub;
    }
  } catch (error) {
    logger.error('Unsubscribe error', { component: 'status-unsubscribe-page', error });
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
            Invalid Unsubscribe Link
          </h1>
          <p style={{ color: '#6b7280' }}>This unsubscribe link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (status === 'already_unsubscribed' && subscription) {
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

  if (status === 'confirm' && subscription) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
        <section style={{ textAlign: 'center', maxWidth: '600px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
            Unsubscribe from status updates?
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
            Confirm that you no longer want updates from {subscription.statusPage.name}.
          </p>
          <form action={confirmUnsubscribe}>
            <input type="hidden" name="token" value={token} />
            <button type="submit">Confirm unsubscribe</button>
          </form>
        </section>
      </main>
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
            Successfully Unsubscribed
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
            You have been unsubscribed from {subscription.statusPage.name} status updates. You will
            no longer receive email notifications.
          </p>
          <Link
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
          </Link>
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
          An error occurred while processing your unsubscribe request.
        </p>
      </div>
    </div>
  );
}
