import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Numeric OS counters only: no process arguments, environment or user data. */
export function parseMacHostPressure(vmStat: string, swapUsage: string) {
  const pageSize = Number(vmStat.match(/page size of (\d+) bytes/)?.[1]);
  const counter = (label: string) => {
    const value = Number(vmStat.match(new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm'))?.[1]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Missing host memory counter');
    return value;
  };
  const swap = swapUsage.match(/\bused = ([\d.]+)([KMG])\b/);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || !swap)
    throw new Error('Missing host memory units');
  const unitPower = swap[2] === 'G' ? 3 : swap[2] === 'M' ? 2 : 1;
  const swapUsedBytes = Number(swap[1]) * 1024 ** unitPower;
  if (!Number.isFinite(swapUsedBytes) || swapUsedBytes < 0)
    throw new Error('Invalid host swap counter');
  return {
    pageSizeBytes: pageSize,
    freeBytes: counter('Pages free') * pageSize,
    compressorBytes: counter('Pages occupied by compressor') * pageSize,
    swapUsedBytes,
    pageins: counter('Pageins'),
    pageouts: counter('Pageouts'),
    swapins: counter('Swapins'),
    swapouts: counter('Swapouts'),
  };
}

export async function captureHostPressure() {
  const capturedAt = new Date().toISOString();
  if (process.platform !== 'darwin')
    return { status: 'UNSUPPORTED' as const, platform: process.platform, capturedAt };
  try {
    const [vm, swap] = await Promise.all([
      exec('vm_stat', [], { timeout: 2000, maxBuffer: 8192 }),
      exec('sysctl', ['vm.swapusage'], { timeout: 2000, maxBuffer: 8192 }),
    ]);
    return {
      status: 'AVAILABLE' as const,
      platform: process.platform,
      capturedAt,
      ...parseMacHostPressure(vm.stdout, swap.stdout),
    };
  } catch {
    return { status: 'UNAVAILABLE' as const, platform: process.platform, capturedAt };
  }
}
