import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryRollupMetrics } from '@/lib/metric-rollup';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
    default: {
        incidentMetricRollup: {
            findMany: vi.fn(),
        },
        service: {
            findMany: vi.fn(),
        },
        incident: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
        incidentEvent: {
            count: vi.fn(),
        },
        alert: {
            count: vi.fn(),
        },
    },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock retention policy
vi.mock('@/lib/retention-policy', () => ({
    getRetentionPolicy: vi.fn().mockResolvedValue({
        incidentRetentionDays: 730,
        alertRetentionDays: 365,
        logRetentionDays: 90,
        metricsRetentionDays: 365,
        realTimeWindowDays: 90,
    }),
}));

describe('metric-rollup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('queryRollupMetrics', () => {
        it('returns zero metrics when no rollups exist', async () => {
            const { default: prisma } = await import('@/lib/prisma');
            vi.mocked(prisma.incidentMetricRollup.findMany).mockResolvedValue([]);

            const start = new Date('2025-01-01');
            const end = new Date('2025-01-31');

            const result = await queryRollupMetrics(start, end);

            expect(result.totalIncidents).toBe(0);
            expect(result.resolvedIncidents).toBe(0);
            expect(result.avgMtta).toBeNull();
            expect(result.avgMttr).toBeNull();
            expect(result.rollupCount).toBe(0);
        });

        it('aggregates metrics from multiple rollups correctly', async () => {
            const { default: prisma } = await import('@/lib/prisma');

            vi.mocked(prisma.incidentMetricRollup.findMany).mockResolvedValue([
                {
                    totalIncidents: 10,
                    resolvedIncidents: 8,
                    mttaSum: BigInt(6000000), // 10 incidents * 10 min avg * 60000 ms/min
                    mttaCount: 10,
                    mttrSum: BigInt(72000000), // 8 incidents * 150 min avg * 60000 ms/min
                    mttrCount: 8,
                    ackSlaMet: 8,
                    ackSlaBreached: 2,
                    resolveSlaMet: 6,
                    resolveSlaBreached: 2,
                    afterHoursCount: 3,
                },
                {
                    totalIncidents: 15,
                    resolvedIncidents: 12,
                    mttaSum: BigInt(9000000), // 15 incidents * 10 min avg * 60000 ms/min
                    mttaCount: 15,
                    mttrSum: BigInt(108000000), // 12 incidents * 150 min avg * 60000 ms/min
                    mttrCount: 12,
                    ackSlaMet: 12,
                    ackSlaBreached: 3,
                    resolveSlaMet: 10,
                    resolveSlaBreached: 2,
                    afterHoursCount: 5,
                },
            ] as any);

            const start = new Date('2025-01-01');
            const end = new Date('2025-01-31');

            const result = await queryRollupMetrics(start, end);

            expect(result.totalIncidents).toBe(25);
            expect(result.resolvedIncidents).toBe(20);
            // MTTA: (6000000 + 9000000) / 25 / 60000 = 10 minutes
            expect(result.avgMtta).toBeCloseTo(10, 0);
            // MTTR: (72000000 + 108000000) / 20 / 60000 = 150 minutes
            expect(result.avgMttr).toBeCloseTo(150, 0);
            expect(result.rollupCount).toBe(2);
        });

        it('calculates SLA compliance percentages correctly', async () => {
            const { default: prisma } = await import('@/lib/prisma');

            vi.mocked(prisma.incidentMetricRollup.findMany).mockResolvedValue([
                {
                    totalIncidents: 100,
                    resolvedIncidents: 90,
                    mttaSum: BigInt(0),
                    mttaCount: 0,
                    mttrSum: BigInt(0),
                    mttrCount: 0,
                    ackSlaMet: 80,
                    ackSlaBreached: 20,
                    resolveSlaMet: 70,
                    resolveSlaBreached: 20,
                    afterHoursCount: 25,
                },
            ] as any);

            const result = await queryRollupMetrics(new Date('2025-01-01'), new Date('2025-01-31'));

            // Ack compliance: 80 / (80 + 20) = 80%
            expect(result.ackCompliance).toBeCloseTo(80, 0);
            // Resolve compliance: 70 / (70 + 20) = 77.8%
            expect(result.resolveCompliance).toBeCloseTo(77.78, 1);
            // After hours rate: 25 / 100 = 25%
            expect(result.afterHoursRate).toBeCloseTo(25, 0);
        });

        it('respects service filter', async () => {
            const { default: prisma } = await import('@/lib/prisma');
            vi.mocked(prisma.incidentMetricRollup.findMany).mockResolvedValue([]);

            await queryRollupMetrics(new Date(), new Date(), { serviceId: 'svc-123' });

            expect(prisma.incidentMetricRollup.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        serviceId: 'svc-123',
                    }),
                })
            );
        });
    });
});
