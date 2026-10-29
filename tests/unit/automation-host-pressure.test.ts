import { expect, it } from 'vitest';
import { parseMacHostPressure } from '../load/helpers/automation-host-pressure';

const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free: 100.
Pages occupied by compressor: 200.
Pageins: 300.
Pageouts: 400.
Swapins: 500.
Swapouts: 600.`;

it('normalizes swap units and page counters without confusing compressed pages with bytes', () => {
  expect(
    parseMacHostPressure(vm, 'vm.swapusage: total = 8192.00M used = 7416.88M free = 775.12M')
  ).toEqual({
    pageSizeBytes: 16384,
    freeBytes: 1638400,
    compressorBytes: 3276800,
    swapUsedBytes: 7416.88 * 1024 ** 2,
    pageins: 300,
    pageouts: 400,
    swapins: 500,
    swapouts: 600,
  });
  expect(parseMacHostPressure(vm, 'used = 1.5G').swapUsedBytes).toBe(1.5 * 1024 ** 3);
  expect(parseMacHostPressure(vm, 'used = 128K').swapUsedBytes).toBe(128 * 1024);
});

it('rejects incomplete observations instead of interpreting missing counters as zero', () => {
  expect(() => parseMacHostPressure(vm.replace('Swapins: 500.', ''), 'used = 1M')).toThrow(
    'counter'
  );
  expect(() => parseMacHostPressure(vm, 'used = unknown')).toThrow('units');
  expect(() => parseMacHostPressure('', 'used = 1M')).toThrow('units');
});
