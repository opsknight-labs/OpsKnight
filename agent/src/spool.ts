// Paths stay inside the operator-configured spool; attempt IDs and enumerated filenames are validated.
/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdir, readdir, readFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SpoolRecord } from './types';

export class ResultSpool {
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
      records.push(JSON.parse(await readFile(join(this.directory, name), 'utf8')) as SpoolRecord);
    }
    return records;
  }

  async depth() {
    return (await this.list()).length;
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
}
