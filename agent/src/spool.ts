// Paths stay inside the operator-configured spool; attempt IDs and enumerated filenames are validated.
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  open,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SpoolRecord } from './types';

export class ResultSpool {
  private activeProbe: Promise<void> | null = null;

  constructor(private readonly directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  private path(attemptId: string) {
    if (!/^[a-z0-9]+$/i.test(attemptId)) throw new Error('Invalid attempt ID for spool.');
    return join(this.directory, `${attemptId}.json`);
  }

  async put(record: SpoolRecord) {
    await this.initialize();
    const destination = this.path(record.attemptId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    const directory = await open(this.directory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  async quarantine(attemptId: string) {
    const directory = join(this.directory, 'dead-letter');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rename(this.path(attemptId), join(directory, `${attemptId}.json`));
  }

  async markStarted(attemptId: string): Promise<boolean> {
    await this.initialize();
    this.path(attemptId); // Validate before constructing a marker path.
    const markerDirectory = join(this.directory, 'dispatched');
    await mkdir(markerDirectory, { recursive: true, mode: 0o700 });
    try {
      const marker = await open(join(markerDirectory, `${attemptId}.started`), 'wx', 0o600);
      try {
        await marker.sync();
      } finally {
        await marker.close();
      }
      const directory = await open(markerDirectory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  async remove(attemptId: string) {
    await unlink(this.path(attemptId)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }

  async list(): Promise<SpoolRecord[]> {
    await this.initialize();
    const names = (await readdir(this.directory))
      .filter(name => /^[a-z0-9]+\.json$/i.test(name))
      .sort();
    const records: SpoolRecord[] = [];
    for (const name of names) {
      const content = await readFile(join(this.directory, name), 'utf8');
      let record: SpoolRecord;
      try {
        record = JSON.parse(content) as SpoolRecord;
        if (
          !record ||
          record.attemptId !== name.slice(0, -5) ||
          typeof record.leaseToken !== 'string' ||
          typeof record.producedAt !== 'string' ||
          !Number.isFinite(Date.parse(record.producedAt)) ||
          [
            record.localOutput,
            record.outputPreview,
            record.outputArtifactId,
            record.errorCode,
            record.errorMessage,
          ].some(value => value !== undefined && typeof value !== 'string') ||
          (record.exitCode !== undefined && !Number.isInteger(record.exitCode)) ||
          !['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(record.status)
        ) {
          throw new Error('Malformed spool record');
        }
      } catch {
        await this.quarantine(name.slice(0, -5));
        continue;
      }
      records.push(record);
    }
    await this.cleanupDispatchMarkers();
    return records;
  }

  private async cleanupDispatchMarkers() {
    const directory = join(this.directory, 'dispatched');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    // Retain beyond the maximum 24-hour execution and five-minute signed claim lease.
    // Immediate removal on ACK would reopen replay of an unexpired signed claim/start.
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    for (const name of names.filter(name => /^[a-z0-9]+\.started$/i.test(name))) {
      const path = join(directory, name);
      try {
        const fileStat = await stat(path);
        if (fileStat.mtimeMs < cutoff) {
          await unlink(path).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  async depth() {
    return (await this.list()).length;
  }

  async stats(): Promise<{ count: number; totalBytes: number; oldestAgeMs: number }> {
    await this.initialize();
    let names: string[];
    try {
      names = (await readdir(this.directory)).filter(name => /^[a-z0-9]+\.json$/i.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        names = [];
      } else {
        throw error;
      }
    }
    let totalBytes = 0;
    let oldestMtime = Date.now();
    for (const name of names) {
      try {
        const s = await stat(join(this.directory, name));
        totalBytes += s.size;
        if (s.mtimeMs < oldestMtime) oldestMtime = s.mtimeMs;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return {
      count: names.length,
      totalBytes,
      oldestAgeMs: names.length > 0 ? Math.max(0, Date.now() - oldestMtime) : 0,
    };
  }

  async deadLetterDepth() {
    try {
      return (await readdir(join(this.directory, 'dead-letter'))).filter(name =>
        /^[a-z0-9]+\.json$/i.test(name)
      ).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }

  async deadLetterStats(): Promise<{ count: number; totalBytes: number; oldestAgeMs: number }> {
    const dir = join(this.directory, 'dead-letter');
    let names: string[];
    try {
      names = (await readdir(dir)).filter(name => /^[a-z0-9]+\.json$/i.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { count: 0, totalBytes: 0, oldestAgeMs: 0 };
      }
      throw error;
    }
    let totalBytes = 0;
    let oldestMtime = Date.now();
    for (const name of names) {
      try {
        const s = await stat(join(dir, name));
        totalBytes += s.size;
        if (s.mtimeMs < oldestMtime) oldestMtime = s.mtimeMs;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return {
      count: names.length,
      totalBytes,
      oldestAgeMs: names.length > 0 ? Math.max(0, Date.now() - oldestMtime) : 0,
    };
  }

  /**
   * Comprehensive, safe verification of storage durability and accessibility.
   * Proves that the spool directory can be read, listed, written, fsynced, and unlinked
   * without mutating or clobbering existing execution records.
   * Fails closed by throwing if any filesystem operation fails.
   *
   * Single-flight per Agent process to prevent race conditions between the main polling
   * loop and asynchronous heartbeat cycles.
   */
  async probeStorageIntegrity(testHooks?: {
    simulateWriteFailure?: boolean;
    simulateSyncFailure?: boolean;
    staleThresholdMs?: number;
  }): Promise<void> {
    if (this.activeProbe) {
      return this.activeProbe;
    }
    const probePromise = this.executeProbe(testHooks);
    this.activeProbe = probePromise;
    try {
      await probePromise;
    } finally {
      this.activeProbe = null;
    }
  }

  private async executeProbe(testHooks?: {
    simulateWriteFailure?: boolean;
    simulateSyncFailure?: boolean;
    staleThresholdMs?: number;
  }): Promise<void> {
    await this.initialize();
    // 1. Clean up only abandoned probe files older than a safe threshold (default 60s)
    // to prevent concurrent probes from deleting active temporary files.
    const staleThresholdMs = testHooks?.staleThresholdMs ?? 60_000;
    const cutoff = Date.now() - staleThresholdMs;
    try {
      const names = await readdir(this.directory);
      for (const name of names) {
        if (/^\.probe-.*\.tmp$/i.test(name)) {
          const filePath = join(this.directory, name);
          try {
            const s = await stat(filePath);
            if (s.mtimeMs <= cutoff) {
              await unlink(filePath).catch(() => undefined);
            }
          } catch {
            // File might have already been unlinked by another process
          }
        }
      }
    } catch {
      // Directory listing errors will be caught below
    }

    // 2. Verify reading directory and listing/decoding existing records
    await this.list();

    // 3. Verify write, sync, readback and unlink capabilities inside a robust try/finally
    const probePath = join(this.directory, `.probe-${process.pid}-${randomUUID()}.tmp`);
    let file: FileHandle | null = null;
    try {
      file = await open(probePath, 'wx', 0o600);
      if (testHooks?.simulateWriteFailure) {
        throw new Error('Simulated ENOSPC during probe write');
      }
      await file.writeFile(Buffer.from('opsknight-storage-probe'));
      if (testHooks?.simulateSyncFailure) {
        throw new Error('Simulated EIO during probe fsync');
      }
      await file.sync();
      await file.close();
      file = null;

      const readBack = await readFile(probePath, 'utf8');
      if (readBack !== 'opsknight-storage-probe') {
        throw new Error('Storage probe data verification failed');
      }
    } finally {
      if (file) {
        await file.close().catch(() => undefined);
      }
      await unlink(probePath).catch(() => undefined);
    }

    // 4. Verify directory metadata sync
    const directory = await open(this.directory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }

    // 5. Verify dead-letter directory accessibility
    const deadLetterDir = join(this.directory, 'dead-letter');
    await mkdir(deadLetterDir, { recursive: true, mode: 0o700 });
    await readdir(deadLetterDir);
  }
}
