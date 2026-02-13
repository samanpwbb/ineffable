/**
 * Parser plugin interface.
 *
 * Each widget type implements this interface to encapsulate its
 * detection, validation, and repair logic.
 */

import { Grid } from "./grid.js";
import type { Widget, Rect } from "./patterns.js";

/**
 * A potential widget found during scanning. May be fully valid
 * (confidence 1.0) or partial (an "almost-widget" that can be repaired).
 */
export interface Candidate<W extends Widget = Widget> {
  /** The widget that would result if this candidate is accepted/repaired. */
  widget: W;
  /**
   * Cells this candidate occupies — used for claiming.
   * For boxes: border cells only (interior remains available for children).
   * For other types: full rect.
   */
  cells: ReadonlySet<string>;
  /**
   * Confidence that this is a real widget, 0 to 1.
   * 1.0 = perfectly formed. < 1.0 = partial match needing repair.
   */
  confidence: number;
  /** What's wrong, if confidence < 1.0. */
  defects?: Defect[];
}

/** A single defect in a partial candidate. */
export interface Defect {
  col: number;
  row: number;
  /** Character currently at this position. */
  actual: string;
  /** Character that should be at this position. */
  expected: string;
  description: string;
}

/**
 * Context provided to each plugin during detection.
 * Wraps the grid and the shared claim set.
 */
export interface ParserContext {
  readonly grid: Grid;
  /** Check if a cell is already claimed by a higher-priority plugin. */
  isClaimed(col: number, row: number): boolean;
  /** Claim a set of cells (called by the orchestrator after accepting a candidate). */
  claim(cells: ReadonlySet<string>): void;
  /** Build a cell key from coordinates. */
  key(col: number, row: number): string;
}

/**
 * Interface every parser plugin must implement.
 */
export interface ParserPlugin<W extends Widget = Widget> {
  /** Unique name, e.g. "box", "button", "line", "text". */
  readonly name: string;
  /** Priority for detection ordering (lower = runs first). */
  readonly priority: number;

  /**
   * Scan the grid for candidates (both valid and partial).
   * Must not mutate the context's claim set.
   */
  detect(context: ParserContext): Candidate<W>[];

  /**
   * Attempt to repair a partial candidate on a cloned grid.
   * Returns the repaired grid, or null if repair is not possible.
   */
  repair(grid: Grid, candidate: Candidate<W>): Grid | null;
}

/** Result of detection with options. */
export interface DetectResult {
  widgets: Widget[];
  /** Original grid, or a repaired clone if repairs were applied. */
  grid: Grid;
  /** List of repairs applied (empty if none). */
  repairs: Defect[];
}

/** Options for detectWidgets. */
export interface DetectOptions {
  /** Enable repair of partial matches. Default: false. */
  repair?: boolean;
  /** Minimum confidence to attempt repair. Default: 0.7. */
  repairThreshold?: number;
  /** Override the built-in plugins. */
  plugins?: ParserPlugin[];
}

// ─── Helpers for plugins ────────────────────────────────────────────────────

/** Build the set of border cells for a rect (corners + edges, not interior). */
export function borderCells(
  rect: Rect,
  key: (c: number, r: number) => string,
): Set<string> {
  const cells = new Set<string>();
  const { col, row, width, height } = rect;
  for (let c = col; c < col + width; c++) {
    cells.add(key(c, row));
    cells.add(key(c, row + height - 1));
  }
  for (let r = row + 1; r < row + height - 1; r++) {
    cells.add(key(col, r));
    cells.add(key(col + width - 1, r));
  }
  return cells;
}

/** Build the set of all cells in a rect. */
export function rectCells(
  rect: Rect,
  key: (c: number, r: number) => string,
): Set<string> {
  const cells = new Set<string>();
  for (let r = rect.row; r < rect.row + rect.height; r++) {
    for (let c = rect.col; c < rect.col + rect.width; c++) {
      cells.add(key(c, r));
    }
  }
  return cells;
}
