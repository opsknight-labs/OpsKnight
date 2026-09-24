import { describe, expect, it } from 'vitest';
import {
  getOpsKnightProcessRole,
  getRuntimeResponsibilities,
  getSchedulerOwnership,
  getSchedulerProfile,
} from '@/lib/runtime-role';

describe('runtime process roles', () => {
  it('preserves the integrated runtime by default and processes durable jobs in-process', () => {
    expect(getOpsKnightProcessRole(undefined)).toBe('integrated');
    expect(getRuntimeResponsibilities('integrated')).toEqual({
      startScheduler: true,
      startJobWorker: true,
      schedulerProfile: 'full',
      workerLane: 'all',
    });
  });

  it('separates web, scheduler, and worker responsibilities', () => {
    expect(getRuntimeResponsibilities('web')).toEqual({
      startScheduler: false,
      startJobWorker: false,
      schedulerProfile: null,
      workerLane: null,
    });
    expect(getRuntimeResponsibilities('scheduler')).toEqual({
      startScheduler: true,
      startJobWorker: false,
      schedulerProfile: 'full',
      workerLane: null,
    });
    expect(getRuntimeResponsibilities('worker')).toEqual({
      startScheduler: false,
      startJobWorker: true,
      schedulerProfile: null,
      workerLane: 'all',
    });
    expect(getRuntimeResponsibilities('general-worker').workerLane).toBe('general');
    expect(getRuntimeResponsibilities('critical-worker').workerLane).toBe('critical');
    expect(getRuntimeResponsibilities('bulk-worker').workerLane).toBe('bulk');
    expect(getRuntimeResponsibilities('status-projector').workerLane).toBe('projector');
  });

  it('normalizes configured role names', () => {
    expect(getOpsKnightProcessRole(' Worker ')).toBe('worker');
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
