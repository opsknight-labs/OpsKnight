import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getCurrentUser } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
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

    const deviceId = subscription.endpoint;
    const token = JSON.stringify(subscription);

    await prisma.userDevice.deleteMany({
      where: {
        deviceId,
        userId: { not: user.id },
      },
    });

    await prisma.userDevice.upsert({
      where: {
        userId_deviceId: {
          userId: user.id,
          deviceId,
        },
      },
      update: {
        token,
        lastUsed: new Date(),
        userAgent: req.headers.get('user-agent') || undefined,
      },
      create: {
        userId: user.id,
        deviceId,
        token,
        platform: 'web',
        userAgent: req.headers.get('user-agent') || undefined,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
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
  let user;
  try {
    user = await getCurrentUser();
  } catch {
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
        userId: user.id,
        deviceId: endpoint,
      },
    });

    const remainingDevices = await prisma.userDevice.count({
      where: { userId: user.id },
    });

    if (remainingDevices === 0) {
      await prisma.user.update({
        where: { id: user.id },
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
