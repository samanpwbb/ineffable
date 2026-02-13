/**
 * Line parser plugin.
 *
 * Detects horizontal (──) and vertical (││) line runs of 2+ characters
 * that aren't already claimed by boxes.
 *
 * Repair: fills 1-char gaps between adjacent line segments.
 */

import { Grid } from "../grid.js";
import type { LineWidget } from "../patterns.js";
import { LINE_CHARS } from "../patterns.js";
import type { ParserPlugin, ParserContext, Candidate, Defect } from "../plugin.js";
import { rectCells } from "../plugin.js";

export class LineParserPlugin implements ParserPlugin<LineWidget> {
  readonly name = "line";
  readonly priority = 30;

  detect(context: ParserContext): Candidate<LineWidget>[] {
    const { grid, isClaimed, key } = context;
    const candidates: Candidate<LineWidget>[] = [];
    const localClaimed = new Set<string>();

    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        if (isClaimed(c, r) || localClaimed.has(key(c, r))) continue;

        if (grid.get(c, r) === LINE_CHARS.horizontal) {
          const result = traceHorizontal(grid, c, r, isClaimed, localClaimed, key);
          if (result) {
            const cells = rectCells(result.rect, key);
            candidates.push({ widget: result, cells, confidence: 1.0 });
            for (const cell of cells) localClaimed.add(cell);
          }
        } else if (grid.get(c, r) === LINE_CHARS.vertical) {
          const result = traceVertical(grid, c, r, isClaimed, localClaimed, key);
          if (result) {
            const cells = rectCells(result.rect, key);
            candidates.push({ widget: result, cells, confidence: 1.0 });
            for (const cell of cells) localClaimed.add(cell);
          }
        }
      }
    }

    // Repair candidates: look for 1-char gaps between line segments
    const gapCandidates = detectGaps(grid, isClaimed, localClaimed, key);
    candidates.push(...gapCandidates);

    return candidates;
  }

  repair(grid: Grid, candidate: Candidate<LineWidget>): Grid | null {
    if (!candidate.defects?.length) return null;

    const repaired = grid.clone();
    for (const defect of candidate.defects) {
      if (repaired.get(defect.col, defect.row) === " ") {
        repaired.set(defect.col, defect.row, defect.expected);
      }
    }
    return repaired;
  }
}

function traceHorizontal(
  grid: Grid,
  startCol: number,
  startRow: number,
  isClaimed: (c: number, r: number) => boolean,
  localClaimed: Set<string>,
  key: (c: number, r: number) => string,
): LineWidget | null {
  let c = startCol;
  while (
    c < grid.width &&
    grid.get(c, startRow) === LINE_CHARS.horizontal &&
    !isClaimed(c, startRow) &&
    !localClaimed.has(key(c, startRow))
  ) {
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

function traceVertical(
  grid: Grid,
  startCol: number,
  startRow: number,
  isClaimed: (c: number, r: number) => boolean,
  localClaimed: Set<string>,
  key: (c: number, r: number) => string,
): LineWidget | null {
  let r = startRow;
  while (
    r < grid.height &&
    grid.get(startCol, r) === LINE_CHARS.vertical &&
    !isClaimed(startCol, r) &&
    !localClaimed.has(key(startCol, r))
  ) {
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

/**
 * Detect 1-char gaps between horizontal or vertical line segments.
 * e.g., `── ──` → the space at the gap becomes a repair candidate
 * for a merged line spanning the full width.
 */
function detectGaps(
  grid: Grid,
  isClaimed: (c: number, r: number) => boolean,
  localClaimed: Set<string>,
  key: (c: number, r: number) => string,
): Candidate<LineWidget>[] {
  const candidates: Candidate<LineWidget>[] = [];

  // Horizontal gaps: ─ <space> ─
  for (let r = 0; r < grid.height; r++) {
    for (let c = 1; c < grid.width - 1; c++) {
      if (isClaimed(c, r) || localClaimed.has(key(c, r))) continue;
      if (grid.get(c, r) !== " ") continue;
      if (grid.get(c - 1, r) === LINE_CHARS.horizontal && grid.get(c + 1, r) === LINE_CHARS.horizontal) {
        if (isClaimed(c - 1, r) || isClaimed(c + 1, r)) continue;

        // Find full extent of the merged line
        let left = c - 1;
        while (left > 0 && grid.get(left - 1, r) === LINE_CHARS.horizontal && !isClaimed(left - 1, r)) left--;
        let right = c + 1;
        while (right < grid.width - 1 && grid.get(right + 1, r) === LINE_CHARS.horizontal && !isClaimed(right + 1, r)) right++;

        const rect = { col: left, row: r, width: right - left + 1, height: 1 };
        candidates.push({
          widget: { type: "line", direction: "horizontal", rect },
          cells: rectCells(rect, key),
          confidence: 0.85,
          defects: [{
            col: c, row: r,
            actual: " ", expected: LINE_CHARS.horizontal,
            description: "Gap in horizontal line",
          }],
        });
      }
    }
  }

  // Vertical gaps: │ <space> │
  for (let c = 0; c < grid.width; c++) {
    for (let r = 1; r < grid.height - 1; r++) {
      if (isClaimed(c, r) || localClaimed.has(key(c, r))) continue;
      if (grid.get(c, r) !== " ") continue;
      if (grid.get(c, r - 1) === LINE_CHARS.vertical && grid.get(c, r + 1) === LINE_CHARS.vertical) {
        if (isClaimed(c, r - 1) || isClaimed(c, r + 1)) continue;

        let top = r - 1;
        while (top > 0 && grid.get(c, top - 1) === LINE_CHARS.vertical && !isClaimed(c, top - 1)) top--;
        let bottom = r + 1;
        while (bottom < grid.height - 1 && grid.get(c, bottom + 1) === LINE_CHARS.vertical && !isClaimed(c, bottom + 1)) bottom++;

        const rect = { col: c, row: top, width: 1, height: bottom - top + 1 };
        candidates.push({
          widget: { type: "line", direction: "vertical", rect },
          cells: rectCells(rect, key),
          confidence: 0.85,
          defects: [{
            col: c, row: r,
            actual: " ", expected: LINE_CHARS.vertical,
            description: "Gap in vertical line",
          }],
        });
      }
    }
  }

  return candidates;
}
