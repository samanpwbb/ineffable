/**
 * Pattern-matching parser: detects widgets from a Grid.
 * Priority order: box, button, line, text.
 */

import { Grid } from "./grid.js";
import {
  Widget,
  BOX_CHARS,
  BOX_CORNERS,
  BUTTON_CHARS,
  LINE_CHARS,
  Rect,
} from "./patterns.js";

/** Detect all widgets in a grid. */
export function detectWidgets(grid: Grid): Widget[] {
  const widgets: Widget[] = [];
  // Track which cells are "claimed" by a detected widget
  const claimed = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;

  // 1. Detect boxes
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      if (claimed.has(key(c, r))) continue;
      if (grid.get(c, r) !== BOX_CHARS.topLeft) continue;

      const box = traceBox(grid, c, r);
      if (box) {
        widgets.push(box);
        claimBorder(claimed, box.rect, key);
      }
    }
  }

  // 2. Detect buttons
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      if (claimed.has(key(c, r))) continue;
      if (grid.get(c, r) !== "[") continue;
      if (grid.get(c + 1, r) !== " ") continue;

      const btn = traceButton(grid, c, r);
      if (btn) {
        widgets.push(btn);
        claimRect(claimed, btn.rect, key);
      }
    }
  }

  // 3. Detect lines
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      if (claimed.has(key(c, r))) continue;

      if (grid.get(c, r) === LINE_CHARS.horizontal) {
        const hLine = traceHorizontalLine(grid, c, r, claimed, key);
        if (hLine) {
          widgets.push(hLine);
          claimRect(claimed, hLine.rect, key);
        }
      } else if (grid.get(c, r) === LINE_CHARS.vertical) {
        const vLine = traceVerticalLine(grid, c, r, claimed, key);
        if (vLine) {
          widgets.push(vLine);
          claimRect(claimed, vLine.rect, key);
        }
      }
    }
  }

  // 5. Detect text (anything unclaimed and non-space)
  for (let r = 0; r < grid.height; r++) {
    let textStart = -1;
    for (let c = 0; c <= grid.width; c++) {
      const ch = c < grid.width ? grid.get(c, r) : " ";
      const isClaimed = c < grid.width && claimed.has(key(c, r));

      if (ch !== " " && !isClaimed) {
        if (textStart === -1) textStart = c;
      } else {
        if (textStart !== -1) {
          let content = "";
          for (let tc = textStart; tc < c; tc++) {
            content += grid.get(tc, r);
          }
          widgets.push({
            type: "text",
            content,
            rect: { col: textStart, row: r, width: c - textStart, height: 1 },
          });
          for (let tc = textStart; tc < c; tc++) {
            claimed.add(key(tc, r));
          }
          textStart = -1;
        }
      }
    }
  }

  return widgets;
}

/** Find the widget at a specific grid coordinate, if any. Returns the smallest (most specific) match. */
export function widgetAt(widgets: Widget[], col: number, row: number): Widget | null {
  let best: Widget | null = null;
  let bestArea = Infinity;
  for (const w of widgets) {
    const r = w.rect;
    if (col >= r.col && col < r.col + r.width && row >= r.row && row < r.row + r.height) {
      const area = r.width * r.height;
      if (area < bestArea) {
        best = w;
        bestArea = area;
      }
    }
  }
  return best;
}

/** Find all widgets whose rects are strictly contained within the given rect. */
export function widgetsInside(widgets: Widget[], container: Rect): Widget[] {
  return widgets.filter((w) => {
    const wr = w.rect;
    return (
      wr.col > container.col &&
      wr.row > container.row &&
      wr.col + wr.width < container.col + container.width &&
      wr.row + wr.height < container.row + container.height
    );
  });
}

// --- Tracing helpers ---

function claimRect(claimed: Set<string>, rect: Rect, key: (c: number, r: number) => string): void {
  for (let r = rect.row; r < rect.row + rect.height; r++) {
    for (let c = rect.col; c < rect.col + rect.width; c++) {
      claimed.add(key(c, r));
    }
  }
}

function claimBorder(claimed: Set<string>, rect: Rect, key: (c: number, r: number) => string): void {
  const { col, row, width, height } = rect;
  // Top and bottom edges
  for (let c = col; c < col + width; c++) {
    claimed.add(key(c, row));
    claimed.add(key(c, row + height - 1));
  }
  // Left and right edges (excluding corners already claimed)
  for (let r = row + 1; r < row + height - 1; r++) {
    claimed.add(key(col, r));
    claimed.add(key(col + width - 1, r));
  }
}

function traceBox(grid: Grid, startCol: number, startRow: number): Widget | null {
  // Find top-right corner
  let c = startCol + 1;
  while (c < grid.width && grid.get(c, startRow) === BOX_CHARS.horizontal) c++;
  if (grid.get(c, startRow) !== BOX_CHARS.topRight) return null;
  const width = c - startCol + 1;
  if (width < 3) return null;

  // Find bottom-left corner
  let r = startRow + 1;
  while (r < grid.height && grid.get(startCol, r) === BOX_CHARS.vertical) r++;
  if (grid.get(startCol, r) !== BOX_CHARS.bottomLeft) return null;
  const height = r - startRow + 1;
  if (height < 3) return null;

  // Verify bottom-right corner
  if (grid.get(startCol + width - 1, startRow + height - 1) !== BOX_CHARS.bottomRight) return null;

  // Verify bottom edge
  for (let bc = startCol + 1; bc < startCol + width - 1; bc++) {
    if (grid.get(bc, startRow + height - 1) !== BOX_CHARS.horizontal) return null;
  }

  // Verify right edge
  for (let br = startRow + 1; br < startRow + height - 1; br++) {
    if (grid.get(startCol + width - 1, br) !== BOX_CHARS.vertical) return null;
  }

  return {
    type: "box",
    rect: { col: startCol, row: startRow, width, height },
  };
}

function traceButton(grid: Grid, startCol: number, startRow: number): Widget | null {
  // Pattern: [ Label ]
  // Already verified grid[startCol] === "[" and grid[startCol+1] === " "
  let c = startCol + 2;
  let label = "";
  while (c < grid.width) {
    if (grid.get(c, startRow) === " " && grid.get(c + 1, startRow) === "]") {
      // Found closing " ]"
      if (label.length === 0) return null;
      const width = c + 2 - startCol;
      return {
        type: "button",
        label,
        rect: { col: startCol, row: startRow, width, height: 1 },
      };
    }
    label += grid.get(c, startRow);
    c++;
  }
  return null;
}

function traceHorizontalLine(
  grid: Grid,
  startCol: number,
  startRow: number,
  claimed: Set<string>,
  key: (c: number, r: number) => string
): Widget | null {
  let c = startCol;
  while (c < grid.width && grid.get(c, startRow) === LINE_CHARS.horizontal && !claimed.has(key(c, startRow))) {
    c++;
  }
  const length = c - startCol;
  if (length < 2) return null;
  return {
    type: "line",
    direction: "horizontal",
    rect: { col: startCol, row: startRow, width: length, height: 1 },
  };
}

function traceVerticalLine(
  grid: Grid,
  startCol: number,
  startRow: number,
  claimed: Set<string>,
  key: (c: number, r: number) => string
): Widget | null {
  let r = startRow;
  while (r < grid.height && grid.get(startCol, r) === LINE_CHARS.vertical && !claimed.has(key(startCol, r))) {
    r++;
  }
  const length = r - startRow;
  if (length < 2) return null;
  return {
    type: "line",
    direction: "vertical",
    rect: { col: startCol, row: startRow, width: 1, height: length },
  };
}
