/**
 * Decides whether a benchmark run on this host can be judged at all.
 *
 * The ingestion A/B gate compares milliseconds; on a shared machine another build, typecheck or test run
 * moves both arms by more than the contract allows. A run is VALID only if
 *   - the 1-minute load average was below `maxStartLoad1` when it started and never rose above
 *     `maxPeakLoad1` at any sample (a start below the limit says nothing about what joined in later),
 *   - no other heavy process (compiler, test runner, build, another load test, headless browser) was
 *     seen at any sample, and
 *   - the host never stalled: no gap longer than `maxGapSec` between two samples.
 * The benchmark's own load counts toward the peak (it adds about 0.3 to 1.2 on an 8-core laptop), so a run
 * has to start well below the limit to stay valid. An invalid run is never a pass and never a fail: it is
 * discarded and repeated.
 *
 * Sampling runs in a worker thread, so a busy benchmark event loop neither delays the samples nor is
 * delayed by them, and a gap really is the host (or the whole process) standing still.
 */
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { Worker } from 'node:worker_threads';

export const HOST_VALIDITY_RULE = {
  maxStartLoad1: 4,
  maxPeakLoad1: 4,
  maxGapSec: 15,
  sampleEverySec: 3,
} as const;

export const HEAVY_PROCESS_PATTERN =
  /(^|[\s/])tsc( |$)|vitest|next build|ts-node.*tests\/load|playwright|chrome-headless-shell/;

const SHELL_COMMAND = /^(\S*\/)?(sh|bash|zsh|dash|fish)( |$)/;

export interface HostSample {
  /** Unix seconds. */
  at: number;
  load1: number;
  otherHeavy: string[];
}

export interface HostValidation {
  rule: string;
  maxStartLoad1: number;
  maxPeakLoad1: number;
  startLoad1: number | null;
  peakLoad1: number | null;
  maxSampleGapSec: number | null;
  sampleCount: number;
  otherHeavyProcesses: string[];
  valid: boolean;
  reasons: string[];
  samples: HostSample[];
}

interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

export function parsePs(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

/** Heavy processes that are not this benchmark: its ancestors and descendants are its own cost. */
export function otherHeavyProcesses(rows: ProcessRow[], selfPid: number): string[] {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const own = new Set<number>([selfPid]);
  for (let at = byPid.get(selfPid); at && at.ppid > 1 && !own.has(at.ppid); at = byPid.get(at.ppid))
    own.add(at.ppid);
  // Descendants of this process only: a sibling under the same shell is someone else's work.
  const mine = new Set<number>([selfPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (mine.has(row.ppid) && !mine.has(row.pid)) {
        mine.add(row.pid);
        grew = true;
      }
  }
  return (
    rows
      .filter(row => !own.has(row.pid) && !mine.has(row.pid))
      .filter(row => HEAVY_PROCESS_PATTERN.test(row.command))
      .filter(row => !/^(ps|grep|sed|awk) /.test(row.command))
      // A shell whose command line merely mentions a compiler or test runner (a wrapper script waiting for
      // the machine lock, say) is not that tool: when the tool runs it is listed as a process of its own.
      .filter(row => !SHELL_COMMAND.test(row.command))
      .map(row => row.command.slice(0, 160))
  );
}

export function judgeHostSamples(
  samples: HostSample[],
  rule: { maxStartLoad1: number; maxPeakLoad1: number; maxGapSec: number } = HOST_VALIDITY_RULE
): HostValidation {
  const reasons: string[] = [];
  if (samples.length < 3) reasons.push('too few host samples');
  const start = samples[0]?.load1 ?? null;
  const peak = samples.length ? Math.max(...samples.map(sample => sample.load1)) : null;
  if (start === null || !(start < rule.maxStartLoad1))
    reasons.push(
      `1-minute load at start ${start === null ? 'unknown' : Number(start.toFixed(2))} is not below ${rule.maxStartLoad1}`
    );
  else if (peak !== null && peak > rule.maxPeakLoad1)
    reasons.push(
      `1-minute load peaked at ${Number(peak.toFixed(2))} during the run, above ${rule.maxPeakLoad1}`
    );
  let maxGap: number | null = null;
  for (let index = 1; index < samples.length; index += 1)
    maxGap = Math.max(maxGap ?? 0, samples[index].at - samples[index - 1].at);
  if (maxGap !== null && maxGap > rule.maxGapSec)
    reasons.push(`host stalled: ${maxGap} s between samples`);
  const heavy = [...new Set(samples.flatMap(sample => sample.otherHeavy))].sort();
  if (heavy.length)
    reasons.push(
      `${heavy.length} other heavy process(es): ${heavy
        .slice(0, 5)
        .map(command => command.slice(0, 100))
        .join(' ; ')}`
    );
  return {
    rule:
      `valid iff the 1-minute load is below ${rule.maxStartLoad1} at the start and never above ${rule.maxPeakLoad1} at any ` +
      `sample, no other heavy process is seen at any sample and no gap between samples exceeds ${rule.maxGapSec} s`,
    maxStartLoad1: rule.maxStartLoad1,
    maxPeakLoad1: rule.maxPeakLoad1,
    startLoad1: start,
    peakLoad1: peak,
    maxSampleGapSec: maxGap,
    sampleCount: samples.length,
    otherHeavyProcesses: heavy,
    valid: reasons.length === 0,
    reasons,
    samples,
  };
}

export function sampleHost(selfPid: number = process.pid): HostSample {
  let otherHeavy: string[] = [];
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    otherHeavy = otherHeavyProcesses(parsePs(output), selfPid);
  } catch {
    // Without `ps` only load and stalls are judged.
  }
  return { at: Math.round(Date.now() / 1000), load1: loadavg()[0], otherHeavy };
}

/** Waits until the 1-minute load is below the limit and no other heavy process runs. Returns what it saw. */
export async function waitForQuietHost(
  maxWaitMs: number,
  log: (line: string) => void = console.log
): Promise<{ waitedMs: number; quiet: boolean; last: HostSample }> {
  const started = Date.now();
  for (;;) {
    const last = sampleHost();
    const quiet = last.load1 < HOST_VALIDITY_RULE.maxStartLoad1 && last.otherHeavy.length === 0;
    const waitedMs = Date.now() - started;
    if (quiet || waitedMs >= maxWaitMs) return { waitedMs, quiet, last };
    log(
      `host not quiet (load ${last.load1.toFixed(2)}, ${last.otherHeavy.length} heavy process(es)); waiting`
    );
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
}

const SAMPLER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { execFileSync } = require('node:child_process');
const { loadavg } = require('node:os');
const samples = [];
const sample = () => {
  let ps = '';
  try { ps = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 16777216 }); } catch {}
  samples.push({ at: Math.round(Date.now() / 1000), load1: loadavg()[0], ps });
};
sample();
const timer = setInterval(sample, workerData.everyMs);
parentPort.on('message', () => { clearInterval(timer); sample(); parentPort.postMessage(samples); });
`;

/** Samples the host from now until `stop()`, which returns the verdict. */
export function watchHost(): { stop: () => Promise<HostValidation> } {
  const worker = new Worker(SAMPLER_SOURCE, {
    eval: true,
    workerData: { everyMs: HOST_VALIDITY_RULE.sampleEverySec * 1000 },
  });
  worker.unref();
  return {
    stop: () =>
      new Promise<HostValidation>(resolve => {
        const fail = () => resolve(judgeHostSamples([]));
        worker.once('error', fail);
        worker.once('message', (raw: Array<{ at: number; load1: number; ps: string }>) => {
          void worker.terminate();
          resolve(
            judgeHostSamples(
              raw.map(row => ({
                at: row.at,
                load1: row.load1,
                otherHeavy: otherHeavyProcesses(parsePs(row.ps), process.pid),
              }))
            )
          );
        });
        worker.postMessage('stop');
      }),
  };
}
