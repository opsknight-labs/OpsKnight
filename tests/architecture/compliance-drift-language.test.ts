import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PROHIBITED_PHRASES = [
  /compliance\s+score/i,
  /readiness\s*%/i,
  /readiness\s+percent/i,
  /guarantee\s+compliance/i,
  /certifies\s+compliance/i,
  /compliance\s+guarantee/i,
];

describe('Compliance Drift Language & Non-Certification Guard', () => {
  it('prohibits synthetic compliance scores, certification claims, and readiness % in drift code', () => {
    const repositoryRoot = process.cwd();
    const targetDirs = [
      path.join(repositoryRoot, 'src', 'lib', 'compliance', 'drift'),
      path.join(repositoryRoot, 'src', 'lib', 'compliance', 'monitoring'),
      path.join(repositoryRoot, 'src', 'app', 'api', 'compliance', 'drift'),
      path.join(repositoryRoot, 'src', 'app', 'api', 'compliance', 'monitoring'),
    ];

    const violations: Array<{ file: string; line: number; phrase: string; content: string }> = [];

    for (const dir of targetDirs) {
      const files = ts.sys.readDirectory(dir, ['.ts', '.tsx']);
      for (const absolutePath of files) {
        const content = ts.sys.readFile(absolutePath);
        if (content === undefined) continue;

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
                file: path.relative(repositoryRoot, absolutePath).split(path.sep).join('/'),
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
