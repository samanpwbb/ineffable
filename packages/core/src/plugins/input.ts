/**
 * Input field parser plugin.
 *
 * Detects input fields: [____________]
 * Brackets containing 2 or more underscores with no other characters.
 * Must run before the button plugin since both start with `[`.
 */

import { Grid } from "../grid.js";
import type { InputWidget } from "../patterns.js";
import type { ParserPlugin, ParserContext, Candidate } from "../plugin.js";
import { rectCells } from "../plugin.js";

export class InputParserPlugin implements ParserPlugin<InputWidget> {
  readonly name = "input";
  readonly priority = 16;

  detect(context: ParserContext): Candidate<InputWidget>[] {
    const { grid, isClaimed, key } = context;
    const candidates: Candidate<InputWidget>[] = [];

    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        if (isClaimed(c, r)) continue;
        if (grid.get(c, r) !== "[") continue;

        const result = traceInput(grid, c, r);
        if (result) {
          candidates.push({
            widget: result,
            cells: rectCells(result.rect, key),
            confidence: 1.0,
          });
        }
      }
    }

    return candidates;
  }

  repair(_grid: Grid, _candidate: Candidate<InputWidget>): Grid | null {
    return null;
  }
}

function traceInput(grid: Grid, startCol: number, startRow: number): InputWidget | null {
  // First char after [ must be underscore
  let c = startCol + 1;
  if (c >= grid.width || grid.get(c, startRow) !== "_") return null;

  // Scan underscores
  let underscoreCount = 0;
  while (c < grid.width) {
    const ch = grid.get(c, startRow);
    if (ch === "_") {
      underscoreCount++;
      c++;
    } else if (ch === "]") {
      break;
    } else {
      return null; // Non-underscore, non-bracket character — not an input
    }
  }

  if (c >= grid.width || grid.get(c, startRow) !== "]") return null;
  if (underscoreCount < 2) return null;

  const width = c - startCol + 1;
  return {
    type: "input",
    rect: { col: startCol, row: startRow, width, height: 1 },
  };
}
