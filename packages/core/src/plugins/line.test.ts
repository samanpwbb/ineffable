import { describe, it, expect } from "vitest";
import { Grid } from "../grid.js";
import { detectWidgets } from "../parser.js";
import { renderWidget } from "../render.js";
import type { Widget, LineWidget, TextWidget } from "../patterns.js";
import type { DetectResult } from "../plugin.js";
import { gridFrom } from "../test-helpers.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectWithRepair(grid: Grid, threshold = 0.7): DetectResult {
  return detectWidgets(grid, { repair: true, repairThreshold: threshold });
}

function lines(widgets: Widget[]): LineWidget[] {
  return widgets.filter((w): w is LineWidget => w.type === "line");
}
function texts(widgets: Widget[]): TextWidget[] {
  return widgets.filter((w): w is TextWidget => w.type === "text");
}

// ─── E: Line Detection ─────────────────────────────────────────────────────

describe("line detection", () => {
  it("E1: horizontal line of length 2", () => {
    const g = gridFrom`
      ──
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0].direction).toBe("horizontal");
    expect(lines(w)[0].rect.width).toBe(2);
  });

  it("E2: horizontal line of length 20", () => {
    const g = gridFrom`
      ────────────────────
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0].rect.width).toBe(20);
  });

  it("E3: vertical line of length 2", () => {
    const g = gridFrom`
      │
      │
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0].direction).toBe("vertical");
    expect(lines(w)[0].rect.height).toBe(2);
  });

  it("E4: vertical line of length 5", () => {
    const g = gridFrom`
      │
      │
      │
      │
      │
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0].rect.height).toBe(5);
  });

  it("E5: horizontal and vertical lines both detected", () => {
    const g = gridFrom`
      ──────
      │
      │
    `;
    const w = detectWidgets(g);
    const hLines = lines(w).filter((l) => l.direction === "horizontal");
    const vLines = lines(w).filter((l) => l.direction === "vertical");
    expect(hLines).toHaveLength(1);
    expect(vLines).toHaveLength(1);
  });
});

// ─── F: Line Edge Cases (single-widget) ────────────────────────────────────

describe("line edge cases", () => {
  it("F1: single ─ character → not a line", () => {
    const g = gridFrom`
      ─
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(0);
    // Falls through to text
    expect(texts(w)).toHaveLength(1);
  });

  it("F2: single │ character → not a line", () => {
    const g = gridFrom`
      │
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(0);
    expect(texts(w)).toHaveLength(1);
  });
});

// ─── I: Line Round-Trip Tests ──────────────────────────────────────────────

describe("line round-trips", () => {
  it("I4: horizontal line round-trip", () => {
    const original: LineWidget = {
      type: "line",
      direction: "horizontal",
      rect: { col: 3, row: 2, width: 8, height: 1 },
    };
    const g = new Grid(20, 5);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const l = lines(w);
    expect(l).toHaveLength(1);
    expect(l[0].rect).toEqual(original.rect);
    expect(l[0].direction).toBe("horizontal");
  });

  it("I5: vertical line round-trip", () => {
    const original: LineWidget = {
      type: "line",
      direction: "vertical",
      rect: { col: 0, row: 0, width: 1, height: 5 },
    };
    const g = new Grid(5, 10);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const l = lines(w);
    expect(l).toHaveLength(1);
    expect(l[0].rect).toEqual(original.rect);
    expect(l[0].direction).toBe("vertical");
  });
});

// ─── L: Line Repair Tests ──────────────────────────────────────────────────

describe("line repair", () => {
  it("L1: repairs 1-char gap in horizontal line", () => {
    const g = gridFrom`
      ── ──
    `;
    // Without repair: two separate lines
    const noRepair = detectWidgets(g);
    expect(lines(noRepair)).toHaveLength(2);

    // With repair: merged into one line
    const result = detectWithRepair(g);
    expect(lines(result.widgets)).toHaveLength(1);
    expect(lines(result.widgets)[0].rect.width).toBe(5);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("L2: repairs 1-char gap in vertical line", () => {
    const g = gridFrom`
      │
      │

      │
      │
    `;
    // Without repair: two separate vertical lines
    const noRepair = detectWidgets(g);
    expect(lines(noRepair)).toHaveLength(2);

    // With repair: merged into one line
    const result = detectWithRepair(g);
    expect(lines(result.widgets)).toHaveLength(1);
    expect(lines(result.widgets)[0].rect.height).toBe(5);
  });

  it("L3: does NOT repair isolated single ─", () => {
    const g = gridFrom`
      ─
    `;
    const result = detectWithRepair(g);
    expect(lines(result.widgets)).toHaveLength(0);
  });

  it("L4: does NOT repair isolated single │", () => {
    const g = gridFrom`
      │
    `;
    const result = detectWithRepair(g);
    expect(lines(result.widgets)).toHaveLength(0);
  });

  it("L5: already-valid line unchanged by repair", () => {
    const g = gridFrom`
      ──────
    `;
    const result = detectWithRepair(g);
    expect(lines(result.widgets)).toHaveLength(1);
    expect(result.repairs).toHaveLength(0);
  });
});
