/**
 * Parser orchestrator.
 *
 * Iterates registered parser plugins in priority order to detect
 * widgets from a Grid. Each plugin returns candidates; the orchestrator
 * manages the shared claim set and assembles the final widget list.
 *
 * Backward-compatible: `detectWidgets(grid)` returns `Widget[]`.
 * With options: `detectWidgets(grid, options)` returns `DetectResult`.
 */

import { Grid } from "./grid.js";
import { Widget, Rect } from "./patterns.js";
import type { ParserContext, DetectOptions, DetectResult, Defect } from "./plugin.js";
import { DEFAULT_PLUGINS } from "./plugins/index.js";

/** Detect all widgets in a grid. */
export function detectWidgets(grid: Grid): Widget[];
export function detectWidgets(grid: Grid, options: DetectOptions): DetectResult;
export function detectWidgets(grid: Grid, options?: DetectOptions): Widget[] | DetectResult {
  const plugins = [...(options?.plugins ?? DEFAULT_PLUGINS)].sort(
    (a, b) => a.priority - b.priority,
  );

  let workingGrid = grid;
  const allRepairs: Defect[] = [];

  // Repair pass: detect partial candidates, repair on cloned grid, re-detect
  if (options?.repair) {
    const threshold = options.repairThreshold ?? 0.7;
    const ctx = createContext(workingGrid);
    let didRepair = false;
    let cloned: Grid | null = null;

    for (const plugin of plugins) {
      const candidates = plugin.detect(ctx);
      for (const candidate of candidates) {
        if (candidate.confidence >= 1.0) {
          // Accept valid candidates and claim so later plugins see them
          ctx.claim(candidate.cells);
        } else if (candidate.confidence >= threshold && candidate.defects?.length) {
          if (!cloned) cloned = workingGrid.clone();
          const repaired = plugin.repair(cloned, candidate);
          if (repaired) {
            cloned = repaired;
            didRepair = true;
            allRepairs.push(...(candidate.defects ?? []));
          }
        }
      }
    }

    if (didRepair && cloned) {
      workingGrid = cloned;
    }
  }

  // Main detection pass
  const ctx = createContext(workingGrid);
  const widgets: Widget[] = [];

  for (const plugin of plugins) {
    const candidates = plugin.detect(ctx);
    for (const candidate of candidates) {
      if (candidate.confidence >= 1.0) {
        widgets.push(candidate.widget);
        ctx.claim(candidate.cells);
      }
    }
  }

  if (!options) return widgets;
  return { widgets, grid: workingGrid, repairs: allRepairs };
}

/** Find the widget at a specific grid coordinate. Returns the smallest (most specific) match. */
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

// ─── Internal ───────────────────────────────────────────────────────────────

function createContext(grid: Grid): ParserContext {
  const claimed = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;
  return {
    grid,
    isClaimed: (col, row) => claimed.has(key(col, row)),
    claim: (cells) => { for (const cell of cells) claimed.add(cell); },
    key,
  };
}
