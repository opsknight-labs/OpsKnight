import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  }

  async remove(attemptId: string) {
    await unlink(this.path(attemptId)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }

  async list(): Promise<SpoolRecord[]> {
    await this.initialize();
    const names = (await readdir(this.directory)).filter(name => /^[a-z0-9]+\.json$/i.test(name));
    const records: SpoolRecord[] = [];
    for (const name of names) {
      records.push(JSON.parse(await readFile(join(this.directory, name), 'utf8')) as SpoolRecord);
    }
    return records;
  }

  async depth() {
    return (await this.list()).length;
  }
}
