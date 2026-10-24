import { describe, expect, it } from 'vitest';
import {
  getOpsKnightProcessRole,
  shouldRunIngestionConsumer,
  getRuntimeResponsibilities,
  getSchedulerOwnership,
  getSchedulerProfile,
} from '@/lib/runtime-role';

describe('runtime process roles', () => {
  it('centralizes automatic ingestion ownership and the web upgrade fallback', () => {
    expect(shouldRunIngestionConsumer('ingestion-worker', 'postgres')).toBe(true);
    expect(shouldRunIngestionConsumer('integrated', 'postgres')).toBe(true);
    expect(shouldRunIngestionConsumer('web', 'postgres')).toBe(true);
    expect(shouldRunIngestionConsumer('integrated', 'sync')).toBe(false);
    expect(shouldRunIngestionConsumer('ingestion-worker', 'sync')).toBe(false);
  });

  it('preserves the integrated runtime by default and processes durable jobs in-process', () => {
    expect(getOpsKnightProcessRole(undefined)).toBe('integrated');
    expect(getRuntimeResponsibilities('integrated')).toEqual({
      startScheduler: true,
      startJobWorker: true,
      schedulerProfile: 'full',
      workerLane: 'all',
      startIsolatedRunbookWorker: true,
    });
  });

  it('separates web, scheduler, and worker responsibilities', () => {
    expect(getRuntimeResponsibilities('web')).toEqual({
      startScheduler: false,
      startJobWorker: false,
      schedulerProfile: null,
      workerLane: null,
      startIsolatedRunbookWorker: false,
    });
    expect(getRuntimeResponsibilities('scheduler')).toEqual({
      startScheduler: true,
      startJobWorker: false,
      schedulerProfile: 'full',
      workerLane: null,
      startIsolatedRunbookWorker: false,
    });
    expect(getRuntimeResponsibilities('worker')).toEqual({
      startScheduler: false,
      startJobWorker: true,
      schedulerProfile: null,
      workerLane: 'all',
      startIsolatedRunbookWorker: false,
    });
    expect(getRuntimeResponsibilities('general-worker').workerLane).toBe('general');
    expect(getRuntimeResponsibilities('critical-worker').workerLane).toBe('critical');
    expect(getRuntimeResponsibilities('bulk-worker').workerLane).toBe('bulk');
    expect(getRuntimeResponsibilities('status-projector').workerLane).toBe('projector');
  });

  it('normalizes configured role names', () => {
    expect(getOpsKnightProcessRole(' Worker ')).toBe('worker');
  });

  it('keeps ingestion workers independent from downstream notification and runbook lanes', () => {
    expect(getOpsKnightProcessRole('ingestion-worker')).toBe('ingestion-worker');
    expect(getRuntimeResponsibilities('ingestion-worker')).toMatchObject({
      startScheduler: false,
      startJobWorker: false,
      startIsolatedRunbookWorker: false,
    });
  });

  it('fails closed for an unknown role', () => {
    expect(() => getOpsKnightProcessRole('wrkerr')).toThrow(/Invalid OPSKNIGHT_PROCESS_ROLE/);
  });

  it('preserves full scheduler behavior unless maintenance is explicitly selected', () => {
    expect(getSchedulerProfile(undefined)).toBe('full');
    expect(getSchedulerProfile(' Maintenance ')).toBe('maintenance');
    expect(() => getSchedulerProfile('partial')).toThrow(/Invalid OPSKNIGHT_SCHEDULER_PROFILE/);
    expect(getRuntimeResponsibilities('scheduler', 'maintenance').schedulerProfile).toBe(
      'maintenance'
    );
  });

  it('removes every dedicated worker lane from the maintenance scheduler', () => {
    expect(getSchedulerOwnership('maintenance')).toEqual({
      backgroundJobs: false,
      escalations: false,
      notifications: false,
      statusProjection: false,
    });
    expect(getSchedulerOwnership('full')).toEqual({
      backgroundJobs: true,
      escalations: true,
      notifications: true,
      statusProjection: true,
    });
  });
});
