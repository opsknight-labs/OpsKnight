/* eslint-disable security/detect-non-literal-fs-filename -- All paths are generated inside this test's private temporary directory. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { EventEmitter } from 'node:events';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// These production consumers use different minimatch APIs. Exercise their real
// globbing after the security override rather than checking a version string.
describe('patched production glob dependencies', () => {
  it('preserves Workbox, filelist and archive globbing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opsknight-glob-compat-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'nested', 'match.json'), '{}');
      writeFileSync(join(root, 'nested', 'exclude.txt'), 'excluded');
      const workboxRequire = createRequire(require.resolve('workbox-build/package.json'));
      const glob = workboxRequire('glob') as {
        sync: (pattern: string, options: { cwd: string }) => string[];
      };
      expect(glob.sync('**/*.json', { cwd: root })).toEqual(['nested/match.json']);

      const { FileList } = require('filelist') as {
        FileList: new () => { include: (pattern: string) => void; toArray: () => string[] };
      };
      const list = new FileList();
      list.include(join(root, '**', '*.json'));
      expect(list.toArray()).toEqual([join(root, 'nested', 'match.json')]);

      const readdirGlob = require('readdir-glob') as (
        directory: string,
        options: { pattern: string }
      ) => EventEmitter;
      const matches = await new Promise<string[]>((resolve, reject) => {
        const files: string[] = [];
        readdirGlob(root, { pattern: '**/*.json' })
          .on('match', (match: { relative: string }) => files.push(match.relative))
          .on('error', reject)
          .on('end', () => resolve(files));
      });
      expect(matches).toEqual(['nested/match.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('round-trips an Excel export through the real archive implementation', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Incidents').addRow(['Incident', 'Status']);
    workbook.getWorksheet('Incidents')!.addRow(['INC-1', 'RESOLVED']);
    const bytes = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(bytes);
    expect(restored.getWorksheet('Incidents')!.getRow(2).values).toEqual([
      undefined,
      'INC-1',
      'RESOLVED',
    ]);
  });
});
