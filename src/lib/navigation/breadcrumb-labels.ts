/**
 * Client registry of entity names for breadcrumbs, keyed by the entity's path
 * (`/services/abc` → "Checkout API"). Filled from what pages already render (their heading),
 * so the shell never queries the database for names. Lives for the browser tab session.
 */

const MAX_LABEL_LENGTH = 120;
const MAX_ENTRIES = 200;

let labels: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

export function setBreadcrumbLabel(path: string, label: string): void {
  const clean = label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
  if (!path || !clean || labels.get(path) === clean) return;
  const next = new Map(labels);
  next.delete(path);
  next.set(path, clean);
  // Oldest entries go first once the registry is full.
  while (next.size > MAX_ENTRIES) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  labels = next;
  listeners.forEach(listener => listener());
}

export function getBreadcrumbLabels(): ReadonlyMap<string, string> {
  return labels;
}

export function subscribeBreadcrumbLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
