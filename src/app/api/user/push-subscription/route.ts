import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const authOptions = await getAuthOptions();
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const subscription = await req.json();
    const { endpoint, keys } = subscription || {};
    if (!endpoint || typeof endpoint !== 'string' || !keys?.p256dh || !keys?.auth) {
      return new NextResponse(
        'Invalid PushSubscription payload: missing endpoint or cryptographic keys',
        { status: 400 }
      );
    }

    // Store subscription
    // We use endpoint as deviceId (it's unique per browser)
    const deviceId = subscription.endpoint;
    const token = JSON.stringify(subscription);

    await prisma.userDevice.upsert({
      where: {
        userId_deviceId: {
          userId: session.user.id,
          deviceId: deviceId,
        },
      },
      update: {
        token: token,
        lastUsed: new Date(),
        userAgent: req.headers.get('user-agent') || undefined,
      },
      create: {
        userId: session.user.id,
        deviceId: deviceId,
        token: token,
        platform: 'web',
        userAgent: req.headers.get('user-agent') || undefined,
      },
    });

    // Also enable push notifications for user if not already
    await prisma.user.update({
      where: { id: session.user.id },
      data: { pushNotificationsEnabled: true },
    });

    return new NextResponse(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Failed to save subscription', { error });
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authOptions = await getAuthOptions();
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    let endpoint = '';
    try {
      const body = await req.json();
      endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    } catch {
      endpoint = '';
    }

    if (!endpoint) {
      return new NextResponse('Invalid subscription', { status: 400 });
    }

    await prisma.userDevice.deleteMany({
      where: {
        userId: session.user.id,
        deviceId: endpoint,
      },
    });

    const remainingDevices = await prisma.userDevice.count({
      where: { userId: session.user.id },
    });

    if (remainingDevices === 0) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { pushNotificationsEnabled: false },
      });
    }

    return new NextResponse(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Failed to delete subscription', { error });
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
