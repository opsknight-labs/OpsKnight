/** Small, total readers for source modules: never throw on an unexpected shape. */

export type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Value at a dotted path ("monitor.name", "alerts.0.labels"), or undefined. */
export function at(data: unknown, path: string): unknown {
  let node: unknown = data;
  for (const part of path.split('.')) {
    if (Array.isArray(node)) node = node[Number(part)];
    else if (isObj(node)) node = node[part];
    else return undefined;
  }
  return node;
}

/** The first non-empty string (or number, as text) among the paths. */
export function str(data: unknown, ...paths: string[]): string | null {
  for (const path of paths) {
    const value = at(data, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function has(data: unknown, ...paths: string[]): boolean {
  return paths.every(path => at(data, path) !== undefined);
}

/** "k:v" tags from an object of labels, skipping keys already shown elsewhere. */
export function labelTags(labels: unknown, skip: string[] = []): string[] {
  if (!isObj(labels)) return [];
  return Object.entries(labels)
    .filter(([k, v]) => !skip.includes(k) && (typeof v === 'string' || typeof v === 'number'))
    .map(([k, v]) => `${k}:${v}`);
}
