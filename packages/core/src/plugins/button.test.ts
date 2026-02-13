import { describe, it, expect } from "vitest";
import { Grid } from "../grid.js";
import { detectWidgets } from "../parser.js";
import type { Widget, BoxWidget, ButtonWidget, TextWidget } from "../patterns.js";
import type { DetectResult } from "../plugin.js";
import { renderWidget } from "../render.js";
import { gridFrom } from "../test-helpers.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectWithRepair(grid: Grid, threshold = 0.7): DetectResult {
  return detectWidgets(grid, { repair: true, repairThreshold: threshold });
}

function boxes(widgets: Widget[]): BoxWidget[] {
  return widgets.filter((w): w is BoxWidget => w.type === "box");
}
function buttons(widgets: Widget[]): ButtonWidget[] {
  return widgets.filter((w): w is ButtonWidget => w.type === "button");
}
function texts(widgets: Widget[]): TextWidget[] {
  return widgets.filter((w): w is TextWidget => w.type === "text");
}

// ─── C: Button Detection ────────────────────────────────────────────────────

describe("button detection", () => {
  it("C1: simple button", () => {
    const g = gridFrom`
      [ Submit ]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0].label).toBe("Submit");
  });

  it("C2: button with long label", () => {
    const g = gridFrom`
      [ Click Here Please ]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0].label).toBe("Click Here Please");
  });

  it("C3: button with single character", () => {
    const g = gridFrom`
      [ X ]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0].label).toBe("X");
  });

  it("C4: multiple buttons on same row", () => {
    const g = gridFrom`
      [ OK ] [ Cancel ]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(2);
    expect(buttons(w)[0].label).toBe("OK");
    expect(buttons(w)[1].label).toBe("Cancel");
  });

  it("C5: button at start of line (col 0)", () => {
    const g = gridFrom`
      [ Go ]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0].rect.col).toBe(0);
  });
});

// ─── D: Button Edge Cases ───────────────────────────────────────────────────

describe("button edge cases", () => {
  it("D1: missing closing bracket → not detected as button", () => {
    const g = gridFrom`
      [ Submit
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(0);
    // Should fall through to text
    expect(texts(w).length).toBeGreaterThan(0);
  });

  it("D2: no space after opening bracket → not detected as button", () => {
    const g = gridFrom`
      [Submit ]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(0);
  });

  it("D3: no space before closing bracket → not detected as button", () => {
    const g = gridFrom`
      [ Submit]
    `;
    const w = detectWidgets(g);
    expect(buttons(w)).toHaveLength(0);
  });

  it("D4: empty button label → not detected", () => {
    const g = gridFrom`
      [    ]
    `;
    const w = detectWidgets(g);
    // "[ " starts, then it finds "  ]" but label after trim is empty
    expect(buttons(w)).toHaveLength(0);
  });

  it("D5: button inside a box is detected", () => {
    const g = gridFrom`
      ┌──────────────┐
      │ [ Save ]     │
      └──────────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0].label).toBe("Save");
  });
});

// ─── I: Button Round-Trip ──────────────────────────────────────────────────

describe("button round-trips", () => {
  it("I3: button round-trip", () => {
    const original: ButtonWidget = {
      type: "button",
      label: "Click",
      rect: { col: 2, row: 0, width: 9, height: 1 },
    };
    const g = new Grid(20, 5);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const b = buttons(w);
    expect(b).toHaveLength(1);
    expect(b[0].label).toBe("Click");
    expect(b[0].rect).toEqual(original.rect);
  });
});

// ─── K: Button Repair Tests ────────────────────────────────────────────────

describe("button repair", () => {
  it("K1: repairs missing closing bracket", () => {
    // Grid needs trailing space for the ` ]` to be written
    const g = new Grid(12, 1);
    g.writeString(0, 0, "[ Submit");
    expect(buttons(detectWidgets(g))).toHaveLength(0);

    const result = detectWithRepair(g);
    expect(buttons(result.widgets)).toHaveLength(1);
    expect(buttons(result.widgets)[0].label).toBe("Submit");
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("K2: does NOT repair when no label content", () => {
    const g = gridFrom`
      [
    `;
    const result = detectWithRepair(g);
    expect(buttons(result.widgets)).toHaveLength(0);
  });

  it("K3: already-valid button unchanged by repair", () => {
    const g = gridFrom`
      [ OK ]
    `;
    const result = detectWithRepair(g);
    expect(buttons(result.widgets)).toHaveLength(1);
    expect(result.repairs).toHaveLength(0);
  });
});

