/**
 * Text parser plugin.
 *
 * Catch-all: detects contiguous runs of non-space, unclaimed characters
 * on a single row. Runs last (highest priority number).
 */

import { Grid } from "../grid.js";
import type { TextWidget } from "../patterns.js";
import type { ParserPlugin, ParserContext, Candidate } from "../plugin.js";
import { rectCells } from "../plugin.js";

export class TextParserPlugin implements ParserPlugin<TextWidget> {
  readonly name = "text";
  readonly priority = 40;

  detect(context: ParserContext): Candidate<TextWidget>[] {
    const { grid, isClaimed, key } = context;
    const candidates: Candidate<TextWidget>[] = [];

    for (let r = 0; r < grid.height; r++) {
      let textStart = -1;
      for (let c = 0; c <= grid.width; c++) {
        const ch = c < grid.width ? grid.get(c, r) : " ";
        const claimed = c < grid.width && isClaimed(c, r);

        if (ch !== " " && !claimed) {
          if (textStart === -1) textStart = c;
        } else {
          if (textStart !== -1) {
            let content = "";
            for (let tc = textStart; tc < c; tc++) {
              content += grid.get(tc, r);
            }
            const rect = { col: textStart, row: r, width: c - textStart, height: 1 };
            candidates.push({
              widget: { type: "text", content, rect },
              cells: rectCells(rect, key),
              confidence: 1.0,
            });
            textStart = -1;
          }
        }
      }
    }

    return candidates;
  }

  repair(_grid: Grid, _candidate: Candidate<TextWidget>): Grid | null {
    // Text has no repair logic — it's the catch-all.
    return null;
  }
}
