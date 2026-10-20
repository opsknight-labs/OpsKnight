import { createHash } from 'crypto';
import { LIMITS, type CompiledSnapshot } from './contract';
type CachedCompiledVersion = CompiledSnapshot & { versionNumber: number };
const versions = new Map<string, CachedCompiledVersion>();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)])
    );
  return value;
}
export const checksum = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function getCachedCompiledVersion(id: string) {
  const cached = versions.get(id);
  if (cached) {
    versions.delete(id);
    versions.set(id, cached);
  }
  return cached;
}
export function loadCompiledVersion(version: {
  id: string;
  compiledSnapshot: unknown;
  checksum: string;
  versionNumber: number;
}): CachedCompiledVersion {
  const cached = versions.get(version.id);
  if (cached) {
    versions.delete(version.id);
    versions.set(version.id, cached);
    return cached;
  }
  if (checksum(version.compiledSnapshot) !== version.checksum) throw new Error('VERSION_INVALID');
  const compiled = version.compiledSnapshot as CompiledSnapshot;
  if (
    compiled.schemaVersion !== 1 ||
    !Array.isArray(compiled.fields) ||
    !Array.isArray(compiled.rules)
  )
    throw new Error('VERSION_INVALID');
  const entry = { ...compiled, versionNumber: version.versionNumber };
  versions.set(version.id, entry);
  if (versions.size > LIMITS.cache) versions.delete(versions.keys().next().value!);
  return entry;
}
