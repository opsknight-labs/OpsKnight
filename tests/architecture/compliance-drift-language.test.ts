import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROHIBITED_PHRASES = [
  /compliance\s+score/i,
  /readiness\s*%/i,
  /readiness\s+percent/i,
  /guarantee\s+compliance/i,
  /certifies\s+compliance/i,
  /compliance\s+guarantee/i,
];

const REPO_ROOT = path.resolve(process.cwd());

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  const resolvedDir = path.resolve(REPO_ROOT, dir);
  if (!resolvedDir.startsWith(REPO_ROOT) || !fs.existsSync(resolvedDir)) return fileList;
  const files = fs.readdirSync(resolvedDir);
  for (const file of files) {
    const filePath = path.resolve(resolvedDir, file);
    if (!filePath.startsWith(REPO_ROOT)) continue;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanDirectory(filePath, fileList);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('Compliance Drift Language & Non-Certification Guard', () => {
  it('prohibits synthetic compliance scores, certification claims, and readiness % in drift code', () => {
    const targetDirs = [
      path.resolve(process.cwd(), 'src/lib/compliance/drift'),
      path.resolve(process.cwd(), 'src/lib/compliance/monitoring'),
      path.resolve(process.cwd(), 'src/app/api/compliance/drift'),
      path.resolve(process.cwd(), 'src/app/api/compliance/monitoring'),
    ];

    const violations: Array<{ file: string; line: number; phrase: string; content: string }> = [];

    for (const dir of targetDirs) {
      const files = scanDirectory(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((lineText, index) => {
          // Exclude comments that explicitly mention prohibitions or disclaimers
          if (
            lineText.includes('PROHIBITED') ||
            lineText.includes('Non-Certification') ||
            lineText.includes('disclaimer')
          ) {
            return;
          }

          for (const regex of PROHIBITED_PHRASES) {
            if (regex.test(lineText)) {
              violations.push({
                file: path.relative(process.cwd(), file),
                line: index + 1,
                phrase: regex.source,
                content: lineText.trim(),
              });
            }
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });
});
