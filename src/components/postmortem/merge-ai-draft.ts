import type { ActionItem } from '@/lib/action-items';
import type { PostmortemDraft } from '@/lib/intelligence/drafts/schemas';

export interface DraftableFields {
  summary: string;
  rootCause: string;
  resolution: string;
  lessons: string;
}

/**
 * Merges an AI draft into the editor without destroying anyone's work: only empty text fields are filled,
 * and suggested action items are added after existing ones, skipping titles already present.
 */
export function mergeAiDraft(
  current: DraftableFields,
  existingItems: readonly ActionItem[],
  draft: PostmortemDraft,
  makeId: (index: number) => string
): { fields: Partial<DraftableFields>; addedItems: ActionItem[]; kept: (keyof DraftableFields)[] } {
  const summary = draft.impact ? `${draft.summary}\n\nImpact: ${draft.impact}` : draft.summary;
  const proposed: DraftableFields = { summary, rootCause: draft.rootCause, resolution: draft.resolution, lessons: draft.lessons };
  const fields: Partial<DraftableFields> = {};
  const kept: (keyof DraftableFields)[] = [];
  for (const key of ['summary', 'rootCause', 'resolution', 'lessons'] as const) {
    const value = key === 'summary' ? proposed.summary : key === 'rootCause' ? proposed.rootCause : key === 'resolution' ? proposed.resolution : proposed.lessons;
    const existing = key === 'summary' ? current.summary : key === 'rootCause' ? current.rootCause : key === 'resolution' ? current.resolution : current.lessons;
    if (!value) continue;
    if (existing.trim()) kept.push(key);
    else Object.assign(fields, { [key]: value });
  }
  const titles = new Set(existingItems.map(item => item.title.trim().toLowerCase()));
  const addedItems: ActionItem[] = [];
  for (const item of draft.actionItems) {
    const key = item.title.trim().toLowerCase();
    if (titles.has(key)) continue;
    titles.add(key);
    addedItems.push({
      id: makeId(addedItems.length),
      title: item.title,
      description: item.description,
      status: 'OPEN',
      priority: item.priority,
    });
  }
  return { fields, addedItems, kept };
}
