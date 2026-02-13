/**
 * Test helpers for creating grids from ASCII art template literals.
 */

import { Grid } from "./grid.js";

/**
 * Create a Grid from an ASCII art template literal.
 *
 * Strips the first and last blank lines, removes common leading indent,
 * and sizes the grid to fit the content exactly.
 *
 * Usage:
 *   const grid = gridFrom`
 *     ┌──┐
 *     │  │
 *     └──┘
 *   `;
 */
export function gridFrom(strings: TemplateStringsArray): Grid {
  const raw = strings[0];
  let lines = raw.split("\n");

  // Strip first line if blank
  if (lines.length > 0 && lines[0].trim() === "") {
    lines = lines.slice(1);
  }
  // Strip last line if blank
  if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines = lines.slice(0, -1);
  }

  if (lines.length === 0) {
    return new Grid(1, 1);
  }

  // Find minimum indent (ignoring empty lines)
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^( *)/)![1].length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  // Strip common indent
  const stripped = lines.map((l) => l.slice(minIndent));

  // Size grid to content
  const width = Math.max(...stripped.map((l) => l.length), 1);
  const height = stripped.length;

  const grid = new Grid(width, height);
  for (let r = 0; r < stripped.length; r++) {
    for (let c = 0; c < stripped[r].length; c++) {
      grid.set(c, r, stripped[r][c]);
    }
  }
  return grid;
}
