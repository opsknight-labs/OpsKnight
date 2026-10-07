import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function getAgentVersion(): string {
  if (process.env.OPSKNIGHT_AGENT_VERSION?.trim()) {
    return process.env.OPSKNIGHT_AGENT_VERSION.trim();
  }
  if (process.env.npm_package_version?.trim()) {
    return process.env.npm_package_version.trim();
  }
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const versionFile = join(currentDir, 'VERSION');
    const version = readFileSync(versionFile, 'utf8').trim();
    if (version) return version;
  } catch {
    // VERSION file may not be present in dev/test runs
  }
  return '2.0.0';
}
