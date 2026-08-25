import { describe, expect, it } from 'vitest';
import { getOpsKnightProcessRole, getRuntimeResponsibilities } from '@/lib/runtime-role';

describe('runtime process roles', () => {
  it('preserves the existing integrated runtime by default', () => {
    expect(getOpsKnightProcessRole(undefined)).toBe('integrated');
    expect(getRuntimeResponsibilities('integrated')).toEqual({
      startScheduler: true,
      startJobWorker: false,
    });
  });

  it('separates web, scheduler, and worker responsibilities', () => {
    expect(getRuntimeResponsibilities('web')).toEqual({
      startScheduler: false,
      startJobWorker: false,
    });
    expect(getRuntimeResponsibilities('scheduler')).toEqual({
      startScheduler: true,
      startJobWorker: false,
    });
    expect(getRuntimeResponsibilities('worker')).toEqual({
      startScheduler: false,
      startJobWorker: true,
    });
  });

  it('normalizes configured role names', () => {
    expect(getOpsKnightProcessRole(' Worker ')).toBe('worker');
  });

  it('fails closed for an unknown role', () => {
    expect(() => getOpsKnightProcessRole('wrkerr')).toThrow(/Invalid OPSKNIGHT_PROCESS_ROLE/);
  });
});
