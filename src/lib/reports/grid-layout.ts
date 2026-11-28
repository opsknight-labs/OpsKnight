type Placed = { position: { x: number; y: number; w: number; h: number } };

/**
 * Flow layout: places widgets left to right in the given order and wraps to the next row when one
 * does not fit. A widget wider than the grid is narrowed to it. Drag-and-drop and resizing both
 * use this, so no widget ends up starting past the last column.
 */
export function flowLayout<T extends Placed>(widgets: T[], columns: number): T[] {
  let currentX = 0;
  let currentY = 0;
  let rowHeight = 1;

  return widgets.map(widget => {
    const w = Math.min(widget.position.w, columns);
    const h = widget.position.h;

    // If widget doesn't fit in current row, move to next row
    if (currentX + w > columns) {
      currentX = 0;
      currentY += rowHeight;
      rowHeight = 1;
    }

    const position = { x: currentX, y: currentY, w, h };

    // Update row height if this widget is taller
    rowHeight = Math.max(rowHeight, h);

    // Move x position for next widget
    currentX += w;

    return { ...widget, position };
  });
}

/** The reading order the grid renders in: top to bottom, then left to right. */
export function sortByPosition<T extends Placed>(widgets: T[]): T[] {
  return [...widgets].sort((a, b) =>
    a.position.y !== b.position.y ? a.position.y - b.position.y : a.position.x - b.position.x
  );
}
