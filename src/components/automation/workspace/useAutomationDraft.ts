'use client';
/* eslint-disable security/detect-object-injection -- Rule positions are bounds-checked local array indices. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import {
  emptySnapshot,
  snapshotSchema,
  type Field,
  type Rule,
  type Snapshot,
} from '@/lib/automation/contract';
import { notify } from '@/lib/toast';
import { draftStorageKey } from './constants';

export type SaveState =
  'Saved' | 'Unsaved' | 'Saving…' | 'Conflict detected' | 'Save failed — retry' | 'Offline';

export type UndoEntry = { label: string; restore: (current: Snapshot) => Snapshot };

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Browser storage is an optional recovery aid. */
  }
}

export function usesField(rule: Rule, key: string) {
  return (
    rule.conditions.some(condition => condition.fieldKey === key) ||
    rule.actions.some(action => action.type === 'SET_CONTEXT' && action.fieldKey === key)
  );
}

/**
 * Owns the editable draft: optimistic edits, debounced autosave with revision checks,
 * local recovery copies, conflict handling and undo.
 */
export function useAutomationDraft({
  serviceId,
  ownerId,
  canEdit,
  onError,
}: {
  serviceId: string;
  ownerId: string | null;
  canEdit: boolean;
  onError: (message: string) => void;
}) {
  const storageKey = ownerId ? draftStorageKey(ownerId, serviceId) : null;
  const [draft, setDraft] = useState<Snapshot>(emptySnapshot);
  const draftRef = useRef<Snapshot>(emptySnapshot);
  const revision = useRef(0);
  const initialized = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const persistedGeneration = useRef(0);
  const generation = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>('Saved');
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [localCopy, setLocalCopy] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    removeStorage(`automation-draft:${serviceId}`);
    const recoveryCopy = readStorage(storageKey);
    const timer = window.setTimeout(() => setLocalCopy(recoveryCopy), 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, serviceId]);
  const [undo, setUndo] = useState<UndoEntry | null>(null);

  const edit = useCallback((next: Snapshot) => {
    generation.current++;
    initialized.current = true;
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setSaveState('Unsaved');
  }, []);

  /** Adopts the server draft until the user starts editing; throws on integrity failure. */
  const receiveServerDraft = useCallback(
    (serverDraft: { snapshot: unknown; revision: number }, includesSnapshot: boolean) => {
      if (initialized.current) return;
      revision.current = serverDraft.revision;
      if (!includesSnapshot) return;
      const parsed = snapshotSchema.safeParse(serverDraft.snapshot);
      if (!parsed.success)
        throw new Error('Stored draft failed integrity validation and cannot be rendered');
      draftRef.current = parsed.data;
      setDraft(parsed.data);
      initialized.current = true;
    },
    []
  );

  const markPersisted = useCallback(
    (savedGeneration: number, nextRevision: number) => {
      revision.current = nextRevision;
      persistedGeneration.current = savedGeneration;
      if (savedGeneration === generation.current) {
        setDirty(false);
        setSaveState('Saved');
        setLocalCopy(null);
        if (storageKey) removeStorage(storageKey);
      } else setSaveState('Unsaved');
    },
    [storageKey]
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (conflict || !initialized.current) return false;
    const work = (async () => {
      setSaveState('Saving…');
      const savedGeneration = generation.current;
      try {
        const response = await automationAction({
          action: 'save',
          serviceId,
          snapshot: draftRef.current,
          expectedRevision: revision.current,
        });
        if (!response.ok) {
          setConflict(!!response.conflict);
          setSaveState(
            response.conflict
              ? 'Conflict detected'
              : navigator.onLine
                ? 'Save failed — retry'
                : 'Offline'
          );
          onError(response.error);
          return false;
        }
        markPersisted(savedGeneration, (response.data as { revision: number }).revision);
        return true;
      } catch (err) {
        setSaveState(navigator.onLine ? 'Save failed — retry' : 'Offline');
        onError(err instanceof Error ? err.message : 'Save failed');
        return false;
      }
    })();
    saving.current = work;
    try {
      return await work;
    } finally {
      if (saving.current === work) saving.current = null;
    }
  }, [serviceId, conflict, onError, markPersisted]);

  /** Waits for in-flight saves and persists every pending edit before a server command. */
  const flush = useCallback(async () => {
    if (saving.current && !(await saving.current)) return false;
    while (initialized.current && persistedGeneration.current < generation.current) {
      if (!(await save())) return false;
    }
    return true;
  }, [save]);

  useEffect(() => {
    if (
      !dirty ||
      conflict ||
      !canEdit ||
      saveState === 'Offline' ||
      saveState === 'Save failed — retry'
    )
      return;
    const timer = setTimeout(() => {
      void save();
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict, canEdit, save, saveState]);

  useEffect(() => {
    if (!storageKey || !initialized.current || !dirty) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* Browser storage may be unavailable; in-memory edits remain available. */
    }
  }, [draft, dirty, storageKey]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);

  const keepMineAfterConflict = useCallback(
    async (remoteRevision: number) => {
      const savedGeneration = generation.current;
      try {
        const response = await automationAction({
          action: 'save',
          serviceId,
          snapshot: draftRef.current,
          expectedRevision: remoteRevision,
        });
        if (!response.ok) {
          onError(response.error);
          return false;
        }
        setConflict(false);
        onError('');
        markPersisted(savedGeneration, (response.data as { revision: number }).revision);
        return true;
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Save failed');
        return false;
      }
    },
    [serviceId, onError, markPersisted]
  );

  /** Drops local edits so the next draft-area load adopts the server copy. */
  const discardForServerCopy = useCallback(() => {
    setConflict(false);
    setDirty(false);
    setSaveState('Saved');
    onError('');
    initialized.current = false;
    persistedGeneration.current = generation.current;
  }, [onError]);

  const restoreLocalCopy = useCallback(() => {
    if (!localCopy) return;
    try {
      edit(snapshotSchema.parse(JSON.parse(localCopy)));
      setLocalCopy(null);
    } catch {
      onError('Recovery copy is invalid');
    }
  }, [localCopy, edit, onError]);

  const dismissLocalCopy = useCallback(() => {
    if (storageKey) removeStorage(storageKey);
    setLocalCopy(null);
  }, [storageKey]);

  const updateRule = useCallback(
    (id: string, update: Partial<Rule>) => {
      const current = draftRef.current;
      edit({
        ...current,
        rules: current.rules.map(rule => (rule.id === id ? { ...rule, ...update } : rule)),
      });
    },
    [edit]
  );

  const updateField = useCallback(
    (key: string, update: Partial<Field>) => {
      const current = draftRef.current;
      edit({
        ...current,
        fields: current.fields.map(field => (field.key === key ? { ...field, ...update } : field)),
      });
    },
    [edit]
  );

  const move = useCallback(
    (index: number, direction: number) => {
      const rules = [...draftRef.current.rules],
        target = index + direction;
      if (target < 0 || target >= rules.length || rules[index].phase !== rules[target].phase)
        return;
      [rules[index], rules[target]] = [rules[target], rules[index]];
      edit({ ...draftRef.current, rules });
    },
    [edit]
  );

  const removeRule = useCallback(
    (rule: Rule) => {
      const current = draftRef.current;
      const index = current.rules.findIndex(candidate => candidate.id === rule.id);
      setUndo({
        label: `${rule.name} deleted`,
        restore: latest => ({
          ...latest,
          rules: [...latest.rules.slice(0, index), rule, ...latest.rules.slice(index)],
        }),
      });
      notify.info(`Rule "${rule.name}" deleted`, {
        id: `automation:rule:${rule.id}:delete`,
      });
      edit({ ...current, rules: current.rules.filter(candidate => candidate.id !== rule.id) });
    },
    [edit]
  );

  const removeField = useCallback(
    (field: Field) => {
      const current = draftRef.current;
      const index = current.fields.findIndex(candidate => candidate.key === field.key);
      const affected = current.rules.filter(rule => usesField(rule, field.key));
      setUndo({
        label: `${field.label} removed; affected rules disabled`,
        restore: latest => ({
          ...latest,
          fields: [...latest.fields.slice(0, index), field, ...latest.fields.slice(index)],
          rules: latest.rules.map(rule => affected.find(a => a.id === rule.id) ?? rule),
        }),
      });
      edit({
        ...current,
        fields: current.fields.filter(candidate => candidate.key !== field.key),
        rules: current.rules.map(rule =>
          affected.some(a => a.id === rule.id)
            ? {
                ...rule,
                enabled: false,
                conditions: rule.conditions.filter(c => c.fieldKey !== field.key),
                actions: rule.actions.filter(
                  a => !(a.type === 'SET_CONTEXT' && a.fieldKey === field.key)
                ),
              }
            : rule
        ),
      });
    },
    [edit]
  );

  const applyUndo = useCallback(() => {
    if (!undo) return;
    edit(undo.restore(draftRef.current));
    setUndo(null);
    notify.success('Change undone', { id: 'automation:undo:applied' });
  }, [undo, edit]);

  const isInitialized = useCallback(() => initialized.current, []);

  return {
    draft,
    saveState,
    dirty,
    conflict,
    localCopy,
    undo,
    revision,
    edit,
    save,
    flush,
    isInitialized,
    receiveServerDraft,
    keepMineAfterConflict,
    discardForServerCopy,
    restoreLocalCopy,
    dismissLocalCopy,
    updateRule,
    updateField,
    move,
    removeRule,
    removeField,
    applyUndo,
  };
}
