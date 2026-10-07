import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function getAgentVersion(): string {
  let version = '2.0.0';
  if (process.env.OPSKNIGHT_AGENT_VERSION?.trim()) {
    version = process.env.OPSKNIGHT_AGENT_VERSION.trim();
  } else if (process.env.npm_package_version?.trim()) {
    version = process.env.npm_package_version.trim();
  } else {
    try {
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const versionFile = join(currentDir, 'VERSION');
      const fileContent = readFileSync(versionFile, 'utf8').trim();
      if (fileContent) version = fileContent;
    } catch {
      // VERSION file may not be present in dev/test runs
    }
  }
  return version.replace(/^v/, '');
}
