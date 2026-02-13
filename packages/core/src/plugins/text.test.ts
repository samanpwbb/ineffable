import { describe, it, expect } from "vitest";
import { Grid } from "../grid.js";
import { detectWidgets } from "../parser.js";
import { renderWidget } from "../render.js";
import type { Widget, BoxWidget, TextWidget } from "../patterns.js";
import { gridFrom } from "../test-helpers.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function texts(widgets: Widget[]): TextWidget[] {
  return widgets.filter((w): w is TextWidget => w.type === "text");
}

// ─── G: Text Detection ─────────────────────────────────────────────────────

describe("text detection", () => {
  it("G1: simple word", () => {
    const g = gridFrom`
      Hello
    `;
    const w = detectWidgets(g);
    expect(texts(w)).toHaveLength(1);
    expect(texts(w)[0].content).toBe("Hello");
  });

  it("G2: multi-word text splits on spaces (current behavior)", () => {
    // The current parser splits text at space boundaries.
    // "Hello World" becomes two separate text widgets.
    const g = gridFrom`
      Hello World
    `;
    const w = detectWidgets(g);
    expect(texts(w)).toHaveLength(2);
    expect(texts(w)[0].content).toBe("Hello");
    expect(texts(w)[1].content).toBe("World");
  });

  it("G3: multiple runs on same row → separate text widgets", () => {
    // "foo" and "bar" separated by multiple spaces
    const g = new Grid(20, 1);
    g.writeString(0, 0, "foo");
    g.writeString(10, 0, "bar");
    const w = detectWidgets(g);
    const t = texts(w);
    expect(t).toHaveLength(2);
    expect(t[0].content).toBe("foo");
    expect(t[1].content).toBe("bar");
  });

  it("G4: text on multiple rows → separate text widgets", () => {
    const g = gridFrom`
      Line1
      Line2
    `;
    const w = detectWidgets(g);
    const t = texts(w);
    expect(t).toHaveLength(2);
    expect(t[0].content).toBe("Line1");
    expect(t[1].content).toBe("Line2");
  });

  it("G6: lone box-drawing char not forming box → text", () => {
    const g = gridFrom`
      ┌
    `;
    const w = detectWidgets(g);
    expect(w.filter((w) => w.type === "box")).toHaveLength(0);
    expect(texts(w)).toHaveLength(1);
    expect(texts(w)[0].content).toBe("┌");
  });
});

// ─── I: Text Round-Trip Tests ──────────────────────────────────────────────

describe("text round-trips", () => {
  it("I6: text round-trip (single word)", () => {
    const original: TextWidget = {
      type: "text",
      content: "Hello",
      rect: { col: 5, row: 3, width: 5, height: 1 },
    };
    const g = new Grid(30, 10);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const t = texts(w);
    expect(t).toHaveLength(1);
    expect(t[0].content).toBe("Hello");
    expect(t[0].rect).toEqual(original.rect);
  });

  it("I6b: multi-word text splits on parse (current behavior)", () => {
    // Text with spaces splits into separate widgets on re-parse
    const original: TextWidget = {
      type: "text",
      content: "Hello World",
      rect: { col: 0, row: 0, width: 11, height: 1 },
    };
    const g = new Grid(20, 5);
    renderWidget(g, original);
    const w = detectWidgets(g);
    const t = texts(w);
    expect(t).toHaveLength(2);
    expect(t[0].content).toBe("Hello");
    expect(t[1].content).toBe("World");
  });
});
