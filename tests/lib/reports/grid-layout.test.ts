import { describe, expect, it } from 'vitest';
import { flowLayout, sortByPosition } from '@/lib/reports/grid-layout';

type Box = { id: string; position: { x: number; y: number; w: number; h: number } };
const box = (id: string, x: number, y: number, w: number, h: number): Box => ({
  id,
  position: { x, y, w, h },
});
const cells = (items: Box[]) =>
  items.map(
    item => `${item.id}:${item.position.x},${item.position.y},${item.position.w},${item.position.h}`
  );

describe('flowLayout', () => {
  it('wraps a widget that no longer fits onto the next row instead of starting past the last column', () => {
    // A widget at x=3 widened to 4 columns used to render as "grid-column 4 / span 4".
    const widened = [box('a', 0, 0, 3, 1), box('b', 3, 0, 4, 1)];
    expect(cells(flowLayout(widened, 4))).toEqual(['a:0,0,3,1', 'b:0,1,4,1']);
  });

  it('starts the next row under the tallest widget of the previous one', () => {
    const items = [box('a', 0, 0, 2, 2), box('b', 2, 0, 2, 1), box('c', 0, 0, 3, 1)];
    expect(cells(flowLayout(items, 4))).toEqual(['a:0,0,2,2', 'b:2,0,2,1', 'c:0,2,3,1']);
  });

  it('narrows a widget wider than the grid to the grid', () => {
    expect(cells(flowLayout([box('a', 0, 0, 4, 1)], 3))).toEqual(['a:0,0,3,1']);
  });
});

describe('sortByPosition', () => {
  it('orders top to bottom, then left to right, without changing the input', () => {
    const input = [box('c', 0, 1, 1, 1), box('b', 2, 0, 1, 1), box('a', 0, 0, 1, 1)];
    expect(sortByPosition(input).map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(input.map(item => item.id)).toEqual(['c', 'b', 'a']);
  });
});
