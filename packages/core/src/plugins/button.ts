/**
 * Button parser plugin.
 *
 * Detects single-line buttons: [ Label ]
 * Requires space after [ and before ].
 *
 * Repair: detects `[ text` missing closing ` ]` and appends it.
 */

import { Grid } from "../grid.js";
import type { ButtonWidget } from "../patterns.js";
import type { ParserPlugin, ParserContext, Candidate, Defect } from "../plugin.js";
import { rectCells } from "../plugin.js";

export class ButtonParserPlugin implements ParserPlugin<ButtonWidget> {
  readonly name = "button";
  readonly priority = 20;

  detect(context: ParserContext): Candidate<ButtonWidget>[] {
    const { grid, isClaimed, key } = context;
    const candidates: Candidate<ButtonWidget>[] = [];

    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        if (isClaimed(c, r)) continue;
        if (grid.get(c, r) !== "[") continue;
        if (grid.get(c + 1, r) !== " ") continue;

        const result = traceButton(grid, c, r);
        if (result) {
          candidates.push({
            widget: result,
            cells: rectCells(result.rect, key),
            confidence: 1.0,
          });
          continue;
        }

        // Repair candidate: [ text with no closing ]
        const partial = tracePartialButton(grid, c, r);
        if (partial) {
          candidates.push(partial.candidate(key));
        }
      }
    }

    return candidates;
  }

  repair(grid: Grid, candidate: Candidate<ButtonWidget>): Grid | null {
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

function traceButton(grid: Grid, startCol: number, startRow: number): ButtonWidget | null {
  let c = startCol + 2;
  let label = "";
  while (c < grid.width) {
    if (grid.get(c, startRow) === " " && grid.get(c + 1, startRow) === "]") {
      const trimmed = label.trim();
      const width = c + 2 - startCol;
      return {
        type: "button",
        label: trimmed,
        rect: { col: startCol, row: startRow, width, height: 1 },
      };
    }
    label += grid.get(c, startRow);
    c++;
  }
  return null;
}

/**
 * Detect a partial button: `[ text` followed by spaces or end-of-row,
 * missing the closing ` ]`.
 */
function tracePartialButton(
  grid: Grid, startCol: number, startRow: number,
): { candidate: (key: (c: number, r: number) => string) => Candidate<ButtonWidget> } | null {
  // Scan for non-space content after "[ "
  let c = startCol + 2;
  let label = "";

  // Max scan distance to avoid false positives
  const maxScan = Math.min(startCol + 40, grid.width);

  while (c < maxScan) {
    const ch = grid.get(c, startRow);

    // Check if text content has ended (space or end of grid)
    const isEnd = ch === " " || c >= grid.width;

    if (isEnd) {
      // Check if the rest of the row is spaces (text truly ended)
      let allSpaces = true;
      for (let check = c; check < grid.width && check < c + 3; check++) {
        if (grid.get(check, startRow) !== " ") { allSpaces = false; break; }
      }
      if (allSpaces && label.trim().length > 0) {
        return buildPartialCandidate(grid, startCol, startRow, c, label.trim());
      }
      // Not the end — could be a space within label
    }

    label += ch;
    c++;
  }

  // Reached max scan distance — check if we have a valid partial
  if (label.trim().length > 0) {
    return buildPartialCandidate(grid, startCol, startRow, c, label.trim());
  }

  return null;
}

function buildPartialCandidate(
  grid: Grid, startCol: number, startRow: number, endCol: number, trimmedLabel: string,
): { candidate: (key: (c: number, r: number) => string) => Candidate<ButtonWidget> } {
  const closingCol = endCol; // space before ]
  const bracketCol = endCol + 1; // ]
  const width = bracketCol + 1 - startCol;

  const defects: Defect[] = [];
  if (grid.get(closingCol, startRow) !== " ") {
    defects.push({
      col: closingCol, row: startRow,
      actual: grid.get(closingCol, startRow), expected: " ",
      description: "Missing closing space",
    });
  }
  if (grid.get(bracketCol, startRow) !== "]") {
    defects.push({
      col: bracketCol, row: startRow,
      actual: grid.get(bracketCol, startRow), expected: "]",
      description: "Missing closing bracket",
    });
  }

  if (defects.length === 0) return null!;

  return {
    candidate: (key) => ({
      widget: {
        type: "button",
        label: trimmedLabel,
        rect: { col: startCol, row: startRow, width, height: 1 },
      },
      cells: rectCells({ col: startCol, row: startRow, width, height: 1 }, key),
      confidence: 0.8,
      defects,
    }),
  };
}
