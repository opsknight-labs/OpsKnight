import { describe, expect, it } from 'vitest';
import { buildBusinessHierarchy } from '@/lib/status-pages/business-hierarchy';

const e = (parentId: string, childId: string) => ({ parentId, childId });

describe('buildBusinessHierarchy', () => {
  it('nests children under parents in page order', () => {
    const h = buildBusinessHierarchy(['a', 'b', 'c'], [e('a', 'c'), e('a', 'b')]);
    expect(h.get('a')?.childIds).toEqual(['b', 'c']);
    expect(h.get('b')?.parentId).toBe('a');
  });
  it('drops cycles, self edges and unknown ids', () => {
    const h = buildBusinessHierarchy(['a', 'b'], [e('a', 'b'), e('b', 'a'), e('a', 'a'), e('x', 'a')]);
    expect(h.get('a')?.parentId).toBeUndefined();
    expect(h.get('b')?.parentId).toBe('a');
  });
  it('bounds depth at 3 levels', () => {
    const h = buildBusinessHierarchy(['a', 'b', 'c', 'd'], [e('a', 'b'), e('b', 'c'), e('c', 'd')]);
    expect(h.get('c')?.parentId).toBe('b');
    expect(h.get('d')?.parentId).toBeUndefined();
  });
  it('keeps one parent per child', () => {
    const h = buildBusinessHierarchy(['a', 'b', 'c'], [e('a', 'c'), e('b', 'c')]);
    expect(h.get('c')?.parentId).toBe('a');
    expect(h.get('b')?.childIds).toEqual([]);
  });
});
