// Whether the runbook builder holds edits that are not in the saved draft. The builder and the
// Publish button are separate client islands, so this tiny store lets the button see the state.
let dirty = false;
const listeners = new Set<() => void>();

export function setRunbookBuilderDirty(next: boolean): void {
  if (dirty === next) return;
  dirty = next;
  listeners.forEach(listener => listener());
}

export function subscribeRunbookBuilderDirty(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getRunbookBuilderDirty = (): boolean => dirty;
