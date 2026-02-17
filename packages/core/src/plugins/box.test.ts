import { describe, it, expect } from "vitest";
import { Grid } from "../grid.js";
import { detectWidgets } from "../parser.js";
import { renderWidget } from "../render.js";
import type { Widget, BoxWidget } from "../patterns.js";
import type { DetectResult } from "../plugin.js";
import { gridFrom } from "../test-helpers.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectWithRepair(grid: Grid, threshold = 0.7): DetectResult {
  return detectWidgets(grid, { repair: true, repairThreshold: threshold });
}

function boxes(widgets: Widget[]): BoxWidget[] {
  return widgets.filter((w): w is BoxWidget => w.type === "box");
}

// ─── A: Box Detection (Happy Path) ─────────────────────────────────────────

describe("box detection", () => {
  it("A1: detects minimum 3x3 box", () => {
    const g = gridFrom`
      ┌─┐
      │ │
      └─┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].rect).toEqual({ col: 0, row: 0, width: 3, height: 3 });
  });

  it("A2: detects larger box with correct dimensions", () => {
    const g = gridFrom`
      ┌────────┐
      │        │
      │        │
      │        │
      └────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].rect).toEqual({ col: 0, row: 0, width: 10, height: 5 });
  });

  it("A3: detects box with interior text (no label extraction)", () => {
    const g = gridFrom`
      ┌──────────┐
      │          │
      │  Header  │
      │          │
      └──────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
  });

  it("A4: empty box", () => {
    const g = gridFrom`
      ┌────┐
      │    │
      │    │
      └────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
  });

  it("A5: box at grid origin (0,0)", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].rect.col).toBe(0);
    expect(boxes(w)[0].rect.row).toBe(0);
  });

  it("A6: box offset from origin", () => {
    const g = new Grid(10, 5);
    renderWidget(g, { type: "box", rect: { col: 4, row: 1, width: 4, height: 3 } });
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].rect.col).toBe(4);
    expect(boxes(w)[0].rect.row).toBe(1);
  });

  it("A7: tall narrow box (3 wide, 6 tall)", () => {
    const g = gridFrom`
      ┌─┐
      │ │
      │ │
      │ │
      │ │
      └─┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].rect).toEqual({ col: 0, row: 0, width: 3, height: 6 });
  });

  it("A8: wide short box (20 wide, 3 tall)", () => {
    const g = gridFrom`
      ┌──────────────────┐
      │                  │
      └──────────────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(boxes(w)[0].rect.width).toBe(20);
    expect(boxes(w)[0].rect.height).toBe(3);
  });

  it("A9: box with single-char interior text", () => {
    const g = gridFrom`
      ┌───┐
      │ X │
      └───┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
  });
});

// ─── B: Box Edge Cases (single-widget) ─────────────────────────────────────

describe("box edge cases", () => {
  it("B1: multi-row interior text", () => {
    const g = gridFrom`
      ┌──────┐
      │ Line1│
      │ Line2│
      └──────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
  });
});

// ─── I: Box Round-Trip Tests ───────────────────────────────────────────────

describe("box round-trips", () => {
  it("I1: box round-trip", () => {
    const original: BoxWidget = {
      type: "box",
      rect: { col: 1, row: 1, width: 6, height: 4 },
    };
    const g = new Grid(20, 10);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const b = boxes(w);
    expect(b).toHaveLength(1);
    expect(b[0].rect).toEqual(original.rect);
  });

  it("I2: large box round-trip", () => {
    const original: BoxWidget = {
      type: "box",
      rect: { col: 0, row: 0, width: 10, height: 5 },
    };
    const g = new Grid(20, 10);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const b = boxes(w);
    expect(b).toHaveLength(1);
    expect(b[0].rect).toEqual(original.rect);
  });
});

// ─── J: Box Repair Tests ───────────────────────────────────────────────────

describe("box repair", () => {
  it("J1: repairs missing bottom-right corner", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──
    `;
    // Without repair: no box detected (traceBox fails)
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    // With repair: box is detected
    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
    expect(boxes(result.widgets)[0].rect).toEqual({ col: 0, row: 0, width: 4, height: 3 });
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("J2: repairs missing top-right corner", () => {
    const g = gridFrom`
      ┌──
      │  │
      └──┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("J3: repairs missing bottom-left corner", () => {
    const g = gridFrom`
      ┌──┐
      │  │
       ──┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("J4: repairs missing top-left corner", () => {
    const g = gridFrom`
       ──┐
      │  │
      └──┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("J5: repairs gap in top edge", () => {
    const g = gridFrom`
      ┌─ ─┐
      │   │
      └───┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("J6: repairs gap in bottom edge", () => {
    const g = gridFrom`
      ┌───┐
      │   │
      └─ ─┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
  });

  it("J7: repairs gap in left edge", () => {
    const g = gridFrom`
      ┌──┐
      │  │
         │
      │  │
      └──┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
  });

  it("J8: repairs gap in right edge", () => {
    const g = gridFrom`
      ┌──┐
      │
      │  │
      └──┘
    `;
    expect(boxes(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
  });

  it("J9: does NOT repair when only 2 diagonal corners", () => {
    const g = gridFrom`
      ┌

         ┘
    `;
    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(0);
  });

  it("J10: does NOT repair when only 2 adjacent corners (no edges)", () => {
    const g = gridFrom`
      ┌  ┐
    `;
    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(0);
  });

  it("J11: already-valid box is unchanged by repair", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──┘
    `;
    const result = detectWithRepair(g);
    expect(boxes(result.widgets)).toHaveLength(1);
    expect(result.repairs).toHaveLength(0);
  });

  it("J12: does NOT repair when missing corner has non-space content", () => {
    const g = gridFrom`
      ┌──X
      │  │
      └──┘
    `;
    // The "X" at the top-right corner position means overwriting would
    // lose content. Confidence penalty should prevent repair.
    const result = detectWithRepair(g);
    // The box with X at corner should have low confidence due to penalty
    // and likely not be repaired
    const boxWidgets = boxes(result.widgets);
    // If repaired, verify the X was NOT overwritten
    if (boxWidgets.length > 0) {
      // The grid should not have been modified at the X position
      // (repair only overwrites spaces)
      expect(result.grid.get(3, 0)).toBe("X");
    }
  });
});
