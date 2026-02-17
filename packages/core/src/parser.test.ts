import { describe, it, expect } from "vitest";
import { Grid } from "./grid.js";
import { detectWidgets, widgetAt, widgetsInside } from "./parser.js";
import { renderWidget } from "./render.js";
import type { Widget, BoxWidget, ButtonWidget, LineWidget, TextWidget } from "./patterns.js";
import type { ParserPlugin, ParserContext, Candidate } from "./plugin.js";
import { rectCells } from "./plugin.js";
import { TextParserPlugin } from "./plugins/text.js";
import { gridFrom } from "./test-helpers.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function boxes(widgets: Widget[]): BoxWidget[] {
  return widgets.filter((w): w is BoxWidget => w.type === "box");
}
function buttons(widgets: Widget[]): ButtonWidget[] {
  return widgets.filter((w): w is ButtonWidget => w.type === "button");
}
function lines(widgets: Widget[]): LineWidget[] {
  return widgets.filter((w): w is LineWidget => w.type === "line");
}
function texts(widgets: Widget[]): TextWidget[] {
  return widgets.filter((w): w is TextWidget => w.type === "text");
}

// ─── Integration: Multi-widget combinations ────────────────────────────────

describe("multi-widget combinations", () => {
  it("B2: nested boxes both detected", () => {
    const g = gridFrom`
      ┌──────────┐
      │ ┌──────┐ │
      │ │      │ │
      │ └──────┘ │
      └──────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(2);
    // Outer box
    const outer = boxes(w).find((b) => b.rect.width === 12)!;
    expect(outer).toBeDefined();
    // Inner box
    const inner = boxes(w).find((b) => b.rect.width === 8)!;
    expect(inner).toBeDefined();
    expect(inner.rect.col).toBeGreaterThan(outer.rect.col);
  });

  it("B3: adjacent boxes with space between", () => {
    const g = gridFrom`
      ┌──┐ ┌──┐
      │  │ │  │
      └──┘ └──┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(2);
  });

  it("B4: adjacent boxes touching edges", () => {
    const g = gridFrom`
      ┌──┐┌──┐
      │  ││  │
      └──┘└──┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(2);
  });

  it("B5: box containing a button", () => {
    const g = gridFrom`
      ┌────────────┐
      │            │
      │ [ Submit ] │
      │            │
      └────────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(buttons(w)).toHaveLength(1);
  });

  it("B6: box interior with horizontal line", () => {
    const g = gridFrom`
      ┌────────┐
      │        │
      │ ────── │
      │        │
      └────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(lines(w)).toHaveLength(1);
  });

  it("F3: box edges not detected as separate lines", () => {
    const g = gridFrom`
      ┌────┐
      │    │
      └────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(lines(w)).toHaveLength(0);
  });

  it("F4: free-standing line adjacent to box detected", () => {
    const g = gridFrom`
      ┌──┐
      │  │ ────
      └──┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(lines(w)).toHaveLength(1);
  });

  it("G5: text adjacent to box → only text outside is detected", () => {
    const g = gridFrom`
      ┌──┐ hello
      │  │
      └──┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(texts(w)).toHaveLength(1);
    expect(texts(w)[0].content).toBe("hello");
  });
});

// ─── Priority and Claiming ─────────────────────────────────────────────────

describe("priority and claiming", () => {
  it("H1: box border ─ chars not detected as lines", () => {
    const g = gridFrom`
      ┌────┐
      │    │
      └────┘
    `;
    const w = detectWidgets(g);
    expect(lines(w)).toHaveLength(0);
  });

  it("H2: box interior text detected as text widget", () => {
    // The parser only claims box BORDER cells, not interior.
    // So interior text is detected as a separate text widget.
    const g = gridFrom`
      ┌────────┐
      │ Title  │
      └────────┘
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(texts(w)).toHaveLength(1);
    expect(texts(w)[0].content).toBe("Title");
  });

  it("H3: all widget types detected correctly together", () => {
    const g = gridFrom`
      ┌──────┐
      │ Box  │   Hello
      └──────┘
      [ OK ]     ──────
    `;
    const w = detectWidgets(g);
    expect(boxes(w)).toHaveLength(1);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0].label).toBe("OK");
    expect(lines(w)).toHaveLength(1);
    // "Hello" outside and "Box" inside (unclaimed interior) both show as text
    const t = texts(w);
    expect(t).toHaveLength(2);
    expect(t.some((tw) => tw.content === "Hello")).toBe(true);
    expect(t.some((tw) => tw.content === "Box")).toBe(true);
  });

  it("H4: no cell is double-claimed", () => {
    const g = gridFrom`
      ┌──────────┐
      │ [ Save ] │
      │ ──────── │
      │ Title    │
      └──────────┘
    `;
    const w = detectWidgets(g);
    // Verify no widget rects overlap (except box contains children)
    const nonBoxWidgets = w.filter((w) => w.type !== "box");
    for (let i = 0; i < nonBoxWidgets.length; i++) {
      for (let j = i + 1; j < nonBoxWidgets.length; j++) {
        const a = nonBoxWidgets[i].rect;
        const b = nonBoxWidgets[j].rect;
        const overlapX = a.col < b.col + b.width && a.col + a.width > b.col;
        const overlapY = a.row < b.row + b.height && a.row + a.height > b.row;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});

// ─── Complex Round-Trip ────────────────────────────────────────────────────

describe("complex round-trips", () => {
  it("I7: complex diagram round-trip", () => {
    const originals: Widget[] = [
      { type: "box", rect: { col: 0, row: 0, width: 12, height: 5 } },
      { type: "button", label: "OK", rect: { col: 14, row: 0, width: 6, height: 1 } },
      { type: "line", direction: "horizontal", rect: { col: 0, row: 6, width: 20, height: 1 } },
      { type: "text", content: "Footer", rect: { col: 0, row: 8, width: 6, height: 1 } },
    ];
    const g = new Grid(30, 12);
    for (const w of originals) {
      renderWidget(g, w);
    }
    const detected = detectWidgets(g);
    expect(boxes(detected)).toHaveLength(1);
    expect(buttons(detected)).toHaveLength(1);
    expect(buttons(detected)[0].label).toBe("OK");
    expect(lines(detected)).toHaveLength(1);
    expect(texts(detected)).toHaveLength(1);
    expect(texts(detected)[0].content).toBe("Footer");
  });
});

// ─── widgetAt / widgetsInside ──────────────────────────────────────────────

describe("widgetAt", () => {
  it("returns the widget at a position", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──┘
    `;
    const w = detectWidgets(g);
    expect(widgetAt(w, 0, 0)?.type).toBe("box");
    expect(widgetAt(w, 1, 1)?.type).toBe("box");
  });

  it("returns null for empty position", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──┘
    `;
    const w = detectWidgets(g);
    expect(widgetAt(w, 10, 10)).toBeNull();
  });

  it("returns smallest widget at overlapping position", () => {
    const g = gridFrom`
      ┌──────────┐
      │ ┌──────┐ │
      │ │      │ │
      │ └──────┘ │
      └──────────┘
    `;
    const w = detectWidgets(g);
    // Click on inner box border
    const inner = boxes(w).find((b) => b.rect.width === 8)!;
    const found = widgetAt(w, inner.rect.col, inner.rect.row);
    expect(found).toBe(inner);
  });
});

describe("widgetsInside", () => {
  it("finds widgets strictly inside a container", () => {
    const g = gridFrom`
      ┌──────────────┐
      │ [ Save ]     │
      │ hello        │
      └──────────────┘
    `;
    const w = detectWidgets(g);
    const box = boxes(w)[0];
    const inside = widgetsInside(w, box.rect);
    expect(inside.length).toBeGreaterThanOrEqual(1);
    // Button should be inside
    expect(inside.some((iw) => iw.type === "button")).toBe(true);
  });
});

// ─── M: Plugin System Tests ────────────────────────────────────────────────

describe("plugin system", () => {
  it("M1: default plugins detect all widget types", () => {
    const g = gridFrom`
      ┌──┐
      │  │  [ OK ]  ────  Hello
      └──┘
    `;
    const w = detectWidgets(g);
    expect(w.some((w) => w.type === "box")).toBe(true);
    expect(w.some((w) => w.type === "button")).toBe(true);
    expect(w.some((w) => w.type === "line")).toBe(true);
    expect(w.some((w) => w.type === "text")).toBe(true);
  });

  it("M2: custom plugin is called and produces widgets", () => {
    const customPlugin: ParserPlugin<TextWidget> = {
      name: "custom",
      priority: 5, // Higher priority than box
      detect(context: ParserContext): Candidate<TextWidget>[] {
        const { grid, key } = context;
        // Detect any "!" as a custom widget
        const candidates: Candidate<TextWidget>[] = [];
        for (let r = 0; r < grid.height; r++) {
          for (let c = 0; c < grid.width; c++) {
            if (grid.get(c, r) === "!") {
              const rect = { col: c, row: r, width: 1, height: 1 };
              candidates.push({
                widget: { type: "text", content: "!", rect },
                cells: rectCells(rect, key),
                confidence: 1.0,
              });
            }
          }
        }
        return candidates;
      },
      repair() { return null; },
    };

    const g = gridFrom`
      ! Hello !
    `;
    const result = detectWidgets(g, { plugins: [customPlugin] });
    expect(result.widgets).toHaveLength(2);
    expect(result.widgets.every((w) => w.type === "text" && (w as TextWidget).content === "!")).toBe(true);
  });

  it("M3: plugins execute in priority order regardless of registration order", () => {
    const order: string[] = [];

    const pluginA: ParserPlugin = {
      name: "a",
      priority: 20,
      detect() { order.push("a"); return []; },
      repair() { return null; },
    };
    const pluginB: ParserPlugin = {
      name: "b",
      priority: 10,
      detect() { order.push("b"); return []; },
      repair() { return null; },
    };
    const pluginC: ParserPlugin = {
      name: "c",
      priority: 30,
      detect() { order.push("c"); return []; },
      repair() { return null; },
    };

    const g = new Grid(5, 5);
    detectWidgets(g, { plugins: [pluginA, pluginC, pluginB] });
    expect(order).toEqual(["b", "a", "c"]);
  });

  it("M4: custom plugin claims cells, preventing later plugins from matching", () => {
    // A custom plugin that claims all cells containing "H"
    const claimH: ParserPlugin<TextWidget> = {
      name: "claim-h",
      priority: 1,
      detect(context: ParserContext): Candidate<TextWidget>[] {
        const { grid, key } = context;
        const candidates: Candidate<TextWidget>[] = [];
        for (let r = 0; r < grid.height; r++) {
          for (let c = 0; c < grid.width; c++) {
            if (grid.get(c, r) === "H") {
              const rect = { col: c, row: r, width: 1, height: 1 };
              candidates.push({
                widget: { type: "text", content: "claimed-H", rect },
                cells: rectCells(rect, key),
                confidence: 1.0,
              });
            }
          }
        }
        return candidates;
      },
      repair() { return null; },
    };

    const g = gridFrom`
      Hello
    `;
    const result = detectWidgets(g, { plugins: [claimH, new TextParserPlugin()] });
    // "H" claimed by custom plugin, "ello" detected by text plugin
    const textWidgets = result.widgets.filter((w) => w.type === "text") as TextWidget[];
    expect(textWidgets.some((t) => t.content === "claimed-H")).toBe(true);
    expect(textWidgets.some((t) => t.content === "ello")).toBe(true);
    // "Hello" should NOT appear as a single widget
    expect(textWidgets.some((t) => t.content === "Hello")).toBe(false);
  });

  it("M5: detectWidgets with options returns DetectResult", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──┘
    `;
    const result = detectWidgets(g, {});
    expect(result).toHaveProperty("widgets");
    expect(result).toHaveProperty("grid");
    expect(result).toHaveProperty("repairs");
    expect(Array.isArray(result.widgets)).toBe(true);
    expect(Array.isArray(result.repairs)).toBe(true);
  });

  it("M6: detectWidgets without options returns Widget[]", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──┘
    `;
    const result = detectWidgets(g);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("type");
    // Should NOT have DetectResult shape
    expect(result).not.toHaveProperty("grid");
  });

  it("M7: repair threshold is respected", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──
    `;
    // Very high threshold: no repair
    const strict = detectWidgets(g, { repair: true, repairThreshold: 0.99 });
    expect(strict.widgets.filter((w) => w.type === "box")).toHaveLength(0);

    // Normal threshold: repairs
    const normal = detectWidgets(g, { repair: true, repairThreshold: 0.7 });
    expect(normal.widgets.filter((w) => w.type === "box")).toHaveLength(1);
  });
});

// ─── Repair threshold ──────────────────────────────────────────────────────

describe("repair threshold", () => {
  it("respects custom threshold", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──
    `;
    // With very high threshold, should not repair
    const strict = detectWidgets(g, { repair: true, repairThreshold: 0.99 });
    expect(boxes(strict.widgets)).toHaveLength(0);

    // With default threshold, should repair
    const normal = detectWidgets(g, { repair: true });
    expect(boxes(normal.widgets)).toHaveLength(1);
  });

  it("repair disabled by default", () => {
    const g = gridFrom`
      ┌──┐
      │  │
      └──
    `;
    // No options → no repair
    const widgets = detectWidgets(g);
    expect(boxes(widgets)).toHaveLength(0);
  });
});
