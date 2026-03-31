/**
 * Checkbox parser plugin.
 *
 * Detects checkboxes: [x] Label (checked) or [ ] Label (unchecked).
 * Must run before the button plugin to claim `[ ]` patterns.
 */

import { Grid } from "../grid.js";
import type { CheckboxWidget } from "../patterns.js";
import type { ParserPlugin, ParserContext, Candidate } from "../plugin.js";
import { rectCells } from "../plugin.js";

export class CheckboxParserPlugin implements ParserPlugin<CheckboxWidget> {
  readonly name = "checkbox";
  readonly priority = 15;

  detect(context: ParserContext): Candidate<CheckboxWidget>[] {
    const { grid, isClaimed, key } = context;
    const candidates: Candidate<CheckboxWidget>[] = [];

    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width - 2; c++) {
        if (isClaimed(c, r)) continue;
        if (grid.get(c, r) !== "[") continue;

        const result = traceCheckbox(grid, c, r);
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

  repair(_grid: Grid, _candidate: Candidate<CheckboxWidget>): Grid | null {
    return null;
  }
}

function traceCheckbox(grid: Grid, startCol: number, startRow: number): CheckboxWidget | null {
  // Check for [x] or [ ]
  const second = grid.get(startCol + 1, startRow);
  const third = grid.get(startCol + 2, startRow);

  if (third !== "]") return null;

  let checked: boolean;
  if (second === "x") {
    checked = true;
  } else if (second === " ") {
    checked = false;
  } else {
    return null;
  }

  // Must be followed by a space and then label text
  if (grid.get(startCol + 3, startRow) !== " ") return null;

  // Scan until we hit 2+ consecutive spaces or end of row
  let c = startCol + 4;
  let lastNonSpace = c - 1;
  while (c < grid.width) {
    if (grid.get(c, startRow) !== " ") {
      lastNonSpace = c;
    } else {
      // Check if next char is also space (end of label)
      if (c + 1 >= grid.width || grid.get(c + 1, startRow) === " ") {
        break;
      }
    }
    c++;
  }

  if (lastNonSpace < startCol + 4) return null; // No label text

  const label = extractLabel(grid, startCol + 4, lastNonSpace, startRow);
  const width = lastNonSpace - startCol + 1;

  return {
    type: "checkbox",
    checked,
    label,
    rect: { col: startCol, row: startRow, width, height: 1 },
  };
}

function extractLabel(grid: Grid, startCol: number, endCol: number, row: number): string {
  let label = "";
  for (let c = startCol; c <= endCol; c++) {
    label += grid.get(c, row);
  }
  return label;
}
