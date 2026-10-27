import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { checkAlertFlapping } from '@/lib/flapping';

afterAll(() => prisma.$disconnect());

it('filters the service before limiting key history and observes the caller transaction', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.pathname).toMatch(/^\/ingestion_test_/);
  const services = await Promise.all(
    [0, 1].map(() => prisma.service.create({ data: { name: `Owned flapping ${randomUUID()}` } }))
  );
  const key = randomUUID();
  const cappedKey = randomUUID();
  const now = Date.now();
  try {
    await prisma.alert.createMany({
      data: [
        ...Array.from({ length: 30 }, (_, i) => ({
          serviceId: services[1].id,
          dedupKey: key,
          status: 'TRIGGERED',
          createdAt: new Date(now - i * 10),
          payload: {},
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          serviceId: services[0].id,
          dedupKey: key,
          status: i % 2 ? 'RESOLVED' : 'TRIGGERED',
          createdAt: new Date(now - 10000 - i * 1000),
          payload: {},
        })),
        ...Array.from({ length: 25 }, (_, i) => ({
          serviceId: services[0].id,
          dedupKey: cappedKey,
          status: i < 20 || i % 2 === 0 ? 'TRIGGERED' : 'RESOLVED',
          createdAt: new Date(now - 10000 - i * 1000),
          payload: {},
        })),
        {
          serviceId: services[0].id,
          dedupKey: key,
          status: 'RESOLVED',
          createdAt: new Date(now - 3600000),
          payload: {},
        },
      ],
    });
    expect(await checkAlertFlapping(key, services[0].id)).toEqual({
      isFlapping: true,
      transitionCount: 5,
    });
    expect(await checkAlertFlapping(cappedKey, services[0].id)).toEqual({
      isFlapping: false,
      transitionCount: 0,
    });
    expect(await checkAlertFlapping(randomUUID(), services[0].id)).toEqual({
      isFlapping: false,
      transitionCount: 0,
    });
    await prisma.$transaction(async tx => {
      await tx.alert.create({
        data: {
          serviceId: services[0].id,
          dedupKey: key,
          status: 'RESOLVED',
          createdAt: new Date(now + 1),
          payload: {},
        },
      });
      expect(await checkAlertFlapping(key, services[0].id, undefined, tx)).toEqual({
        isFlapping: true,
        transitionCount: 6,
      });
    });
  } finally {
    await prisma.service.deleteMany({ where: { id: { in: services.map(service => service.id) } } });
  }
});
