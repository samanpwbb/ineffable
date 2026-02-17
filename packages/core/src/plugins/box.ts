/**
 * Box parser plugin.
 *
 * Detects rectangular boxes drawn with Unicode box-drawing characters:
 *   ┌──┐
 *   │  │
 *   └──┘
 *
 * Minimum size: 3x3. Only border cells are claimed, leaving the
 * interior available for child widgets.
 *
 * Repair: scans for any corner character and infers the implied box.
 * Fills missing corners and edge gaps when confidence >= threshold.
 */

import { Grid } from "../grid.js";
import type { BoxWidget, Rect } from "../patterns.js";
import { BOX_CHARS } from "../patterns.js";
import type { ParserPlugin, ParserContext, Candidate, Defect } from "../plugin.js";
import { borderCells } from "../plugin.js";

export class BoxParserPlugin implements ParserPlugin<BoxWidget> {
  readonly name = "box";
  readonly priority = 10;

  detect(context: ParserContext): Candidate<BoxWidget>[] {
    const { grid, isClaimed, key } = context;
    const candidates: Candidate<BoxWidget>[] = [];

    // First pass: detect fully valid boxes (starting from ┌)
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        if (isClaimed(c, r)) continue;
        if (grid.get(c, r) !== BOX_CHARS.topLeft) continue;

        const result = traceBox(grid, c, r);
        if (result) {
          candidates.push({
            widget: result,
            cells: borderCells(result.rect, key),
            confidence: 1.0,
          });
        }
      }
    }

    // Second pass: detect partial boxes from any corner character
    const validRects = new Set(
      candidates.map((c) => rectKey(c.widget.rect)),
    );

    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        if (isClaimed(c, r)) continue;
        const ch = grid.get(c, r);
        if (!isCorner(ch)) continue;

        const inferred = inferBoxFromCorner(grid, c, r, ch);
        for (const rect of inferred) {
          const rk = rectKey(rect);
          if (validRects.has(rk)) continue; // Already detected as valid

          const { confidence, defects } = scoreBox(grid, rect);
          if (confidence >= 0.5 && defects.length > 0) {
            validRects.add(rk);
            candidates.push({
              widget: { type: "box", rect },
              cells: borderCells(rect, key),
              confidence,
              defects,
            });
          }
        }
      }
    }

    return candidates;
  }

  repair(grid: Grid, candidate: Candidate<BoxWidget>): Grid | null {
    if (!candidate.defects?.length) return null;

    const repaired = grid.clone();
    for (const defect of candidate.defects) {
      // Only repair cells that are currently spaces (don't overwrite content)
      if (repaired.get(defect.col, defect.row) === " ") {
        repaired.set(defect.col, defect.row, defect.expected);
      }
    }
    return repaired;
  }
}

// ─── Valid box tracing (unchanged from original) ────────────────────────────

function traceBox(grid: Grid, startCol: number, startRow: number): BoxWidget | null {
  let c = startCol + 1;
  while (c < grid.width && grid.get(c, startRow) === BOX_CHARS.horizontal) c++;
  if (grid.get(c, startRow) !== BOX_CHARS.topRight) return null;
  const width = c - startCol + 1;
  if (width < 3) return null;

  let r = startRow + 1;
  while (r < grid.height && grid.get(startCol, r) === BOX_CHARS.vertical) r++;
  if (grid.get(startCol, r) !== BOX_CHARS.bottomLeft) return null;
  const height = r - startRow + 1;
  if (height < 3) return null;

  if (grid.get(startCol + width - 1, startRow + height - 1) !== BOX_CHARS.bottomRight) return null;

  for (let bc = startCol + 1; bc < startCol + width - 1; bc++) {
    if (grid.get(bc, startRow + height - 1) !== BOX_CHARS.horizontal) return null;
  }
  for (let br = startRow + 1; br < startRow + height - 1; br++) {
    if (grid.get(startCol + width - 1, br) !== BOX_CHARS.vertical) return null;
  }

  return {
    type: "box",
    rect: { col: startCol, row: startRow, width, height },
  };
}

// ─── Repair: corner-based inference ─────────────────────────────────────────

function isCorner(ch: string): boolean {
  return ch === BOX_CHARS.topLeft || ch === BOX_CHARS.topRight ||
         ch === BOX_CHARS.bottomLeft || ch === BOX_CHARS.bottomRight;
}

/**
 * Given a corner character at (col, row), infer possible box rects.
 * Scans along edges (with 1-char gap tolerance) to find the opposing corner(s).
 */
function inferBoxFromCorner(
  grid: Grid, col: number, row: number, ch: string,
): Rect[] {
  const results: Rect[] = [];

  if (ch === BOX_CHARS.topLeft) {
    // Scan right for width, down for height
    const w = scanRight(grid, col, row);
    const h = scanDown(grid, col, row);
    if (w >= 3 && h >= 3) results.push({ col, row, width: w, height: h });
  } else if (ch === BOX_CHARS.topRight) {
    // Scan left for width, down for height
    const w = scanLeft(grid, col, row);
    const h = scanDown(grid, col, row);
    if (w >= 3 && h >= 3) results.push({ col: col - w + 1, row, width: w, height: h });
  } else if (ch === BOX_CHARS.bottomLeft) {
    // Scan right for width, up for height
    const w = scanRight(grid, col, row);
    const h = scanUp(grid, col, row);
    if (w >= 3 && h >= 3) results.push({ col, row: row - h + 1, width: w, height: h });
  } else if (ch === BOX_CHARS.bottomRight) {
    // Scan left for width, up for height
    const w = scanLeft(grid, col, row);
    const h = scanUp(grid, col, row);
    if (w >= 3 && h >= 3) results.push({ col: col - w + 1, row: row - h + 1, width: w, height: h });
  }

  return results;
}

/** Scan right from (col, row) along ─ chars (allowing 1 gap), return total width including start. */
function scanRight(grid: Grid, col: number, row: number): number {
  let c = col + 1;
  let gaps = 0;
  while (c < grid.width) {
    const ch = grid.get(c, row);
    if (ch === BOX_CHARS.horizontal) { c++; continue; }
    if (ch === BOX_CHARS.topRight || ch === BOX_CHARS.bottomRight) return c - col + 1;
    // Allow one gap if next char continues the edge
    if (ch === " " && gaps === 0 && isHorizOrCornerRight(grid.get(c + 1, row))) {
      gaps++;
      c++;
      continue;
    }
    break;
  }
  // If we stopped at a corner-like character, return width
  const endCh = grid.get(c, row);
  if (endCh === BOX_CHARS.topRight || endCh === BOX_CHARS.bottomRight) return c - col + 1;
  return 0;
}

/** Scan left from (col, row) along ─ chars (allowing 1 gap), return total width including start. */
function scanLeft(grid: Grid, col: number, row: number): number {
  let c = col - 1;
  let gaps = 0;
  while (c >= 0) {
    const ch = grid.get(c, row);
    if (ch === BOX_CHARS.horizontal) { c--; continue; }
    if (ch === BOX_CHARS.topLeft || ch === BOX_CHARS.bottomLeft) return col - c + 1;
    if (ch === " " && gaps === 0 && isHorizOrCornerLeft(grid.get(c - 1, row))) {
      gaps++;
      c--;
      continue;
    }
    break;
  }
  const endCh = grid.get(c, row);
  if (endCh === BOX_CHARS.topLeft || endCh === BOX_CHARS.bottomLeft) return col - c + 1;
  return 0;
}

/** Scan down from (col, row) along │ chars (allowing 1 gap), return total height including start. */
function scanDown(grid: Grid, col: number, row: number): number {
  let r = row + 1;
  let gaps = 0;
  while (r < grid.height) {
    const ch = grid.get(col, r);
    if (ch === BOX_CHARS.vertical) { r++; continue; }
    if (ch === BOX_CHARS.bottomLeft || ch === BOX_CHARS.bottomRight) return r - row + 1;
    if (ch === " " && gaps === 0 && isVertOrCornerBottom(grid.get(col, r + 1))) {
      gaps++;
      r++;
      continue;
    }
    break;
  }
  const endCh = grid.get(col, r);
  if (endCh === BOX_CHARS.bottomLeft || endCh === BOX_CHARS.bottomRight) return r - row + 1;
  return 0;
}

/** Scan up from (col, row) along │ chars (allowing 1 gap), return total height including start. */
function scanUp(grid: Grid, col: number, row: number): number {
  let r = row - 1;
  let gaps = 0;
  while (r >= 0) {
    const ch = grid.get(col, r);
    if (ch === BOX_CHARS.vertical) { r--; continue; }
    if (ch === BOX_CHARS.topLeft || ch === BOX_CHARS.topRight) return row - r + 1;
    if (ch === " " && gaps === 0 && isVertOrCornerTop(grid.get(col, r - 1))) {
      gaps++;
      r--;
      continue;
    }
    break;
  }
  const endCh = grid.get(col, r);
  if (endCh === BOX_CHARS.topLeft || endCh === BOX_CHARS.topRight) return row - r + 1;
  return 0;
}

function isHorizOrCornerRight(ch: string): boolean {
  return ch === BOX_CHARS.horizontal || ch === BOX_CHARS.topRight || ch === BOX_CHARS.bottomRight;
}
function isHorizOrCornerLeft(ch: string): boolean {
  return ch === BOX_CHARS.horizontal || ch === BOX_CHARS.topLeft || ch === BOX_CHARS.bottomLeft;
}
function isVertOrCornerBottom(ch: string): boolean {
  return ch === BOX_CHARS.vertical || ch === BOX_CHARS.bottomLeft || ch === BOX_CHARS.bottomRight;
}
function isVertOrCornerTop(ch: string): boolean {
  return ch === BOX_CHARS.vertical || ch === BOX_CHARS.topLeft || ch === BOX_CHARS.topRight;
}

// ─── Confidence scoring ─────────────────────────────────────────────────────

function scoreBox(grid: Grid, rect: Rect): { confidence: number; defects: Defect[] } {
  const defects: Defect[] = [];
  const { col, row, width, height } = rect;

  // Expected border characters
  const corners: { c: number; r: number; expected: string }[] = [
    { c: col, r: row, expected: BOX_CHARS.topLeft },
    { c: col + width - 1, r: row, expected: BOX_CHARS.topRight },
    { c: col, r: row + height - 1, expected: BOX_CHARS.bottomLeft },
    { c: col + width - 1, r: row + height - 1, expected: BOX_CHARS.bottomRight },
  ];

  const totalChars = 2 * width + 2 * height - 4;
  let present = 0;

  for (const corner of corners) {
    if (grid.get(corner.c, corner.r) === corner.expected) {
      present++;
    } else {
      defects.push({
        col: corner.c, row: corner.r,
        actual: grid.get(corner.c, corner.r),
        expected: corner.expected,
        description: `Missing ${corner.expected} corner`,
      });
    }
  }

  // Top and bottom edges
  for (let c = col + 1; c < col + width - 1; c++) {
    for (const edgeRow of [row, row + height - 1]) {
      if (grid.get(c, edgeRow) === BOX_CHARS.horizontal) {
        present++;
      } else {
        defects.push({
          col: c, row: edgeRow,
          actual: grid.get(c, edgeRow),
          expected: BOX_CHARS.horizontal,
          description: "Missing horizontal edge",
        });
      }
    }
  }

  // Left and right edges
  for (let r = row + 1; r < row + height - 1; r++) {
    for (const edgeCol of [col, col + width - 1]) {
      if (grid.get(edgeCol, r) === BOX_CHARS.vertical) {
        present++;
      } else {
        defects.push({
          col: edgeCol, row: r,
          actual: grid.get(edgeCol, r),
          expected: BOX_CHARS.vertical,
          description: "Missing vertical edge",
        });
      }
    }
  }

  let confidence = present / totalChars;

  // Penalty: overwriting non-space characters is risky
  for (const d of defects) {
    if (d.actual !== " ") {
      confidence -= 0.1;
    }
  }

  return { confidence: Math.max(0, confidence), defects };
}

function rectKey(rect: Rect): string {
  return `${rect.col},${rect.row},${rect.width},${rect.height}`;
}
