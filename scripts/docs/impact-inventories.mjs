import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

/**
 * The capability catalogs the documentation-impact gate reads: the current release's, plus the
 * upcoming version's when it has one, so a capability that only exists in the upcoming docs (MCP
 * in v2.2.0) is covered before the release flips. Each catalog maps paths in its own version.
 */
export function loadCapabilityInventories(root, versions) {
  const current = versions.currentRelease || 'v2.0.0';
  const list = [current];
  const upcoming = versions.upcomingVersion;
  if (upcoming && upcoming !== current && existsSync(resolve(root, `docs/${upcoming}/capabilities.yaml`)))
    list.push(upcoming);
  const seen = new Set();
  return list.map(version => {
    const inventory = YAML.parse(readFileSync(resolve(root, `docs/${version}/capabilities.yaml`), 'utf8'));
    // A capability already in the current catalog keeps the current mapping.
    const capabilities = Object.entries(inventory.capabilities ?? {}).filter(([id]) => !seen.has(id));
    for (const [id] of capabilities) seen.add(id);
    return { version, capabilities };
  });
}
