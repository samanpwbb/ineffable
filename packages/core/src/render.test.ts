import { describe, it, expect } from "vitest";
import { Grid } from "./grid.js";
import { renderWidget } from "./render.js";
import { BOX_CHARS, LINE_CHARS } from "./patterns.js";

describe("renderWidget", () => {
  describe("box", () => {
    it("renders a 3x3 box", () => {
      const g = new Grid(5, 5);
      renderWidget(g, {
        type: "box",
        rect: { col: 0, row: 0, width: 3, height: 3 },
      });
      expect(g.get(0, 0)).toBe(BOX_CHARS.topLeft);
      expect(g.get(1, 0)).toBe(BOX_CHARS.horizontal);
      expect(g.get(2, 0)).toBe(BOX_CHARS.topRight);
      expect(g.get(0, 1)).toBe(BOX_CHARS.vertical);
      expect(g.get(1, 1)).toBe(" ");
      expect(g.get(2, 1)).toBe(BOX_CHARS.vertical);
      expect(g.get(0, 2)).toBe(BOX_CHARS.bottomLeft);
      expect(g.get(1, 2)).toBe(BOX_CHARS.horizontal);
      expect(g.get(2, 2)).toBe(BOX_CHARS.bottomRight);
    });

    it("renders a box with a centered label", () => {
      const g = new Grid(10, 5);
      renderWidget(g, {
        type: "box",
        label: "Hi",
        rect: { col: 0, row: 0, width: 8, height: 5 },
      });
      // Label "Hi" centered on row 2 (midpoint of height 5)
      // Inner width = 6, pad = floor((6-2)/2) = 2
      expect(g.get(3, 2)).toBe("H");
      expect(g.get(4, 2)).toBe("i");
    });
  });

  describe("button", () => {
    it("renders a button", () => {
      const g = new Grid(20, 1);
      renderWidget(g, {
        type: "button",
        label: "OK",
        rect: { col: 0, row: 0, width: 6, height: 1 },
      });
      expect(g.get(0, 0)).toBe("[");
      expect(g.get(1, 0)).toBe(" ");
      expect(g.get(2, 0)).toBe("O");
      expect(g.get(3, 0)).toBe("K");
      expect(g.get(4, 0)).toBe(" ");
      expect(g.get(5, 0)).toBe("]");
    });
  });

  describe("text", () => {
    it("renders text at position", () => {
      const g = new Grid(20, 1);
      renderWidget(g, {
        type: "text",
        content: "Hello",
        rect: { col: 3, row: 0, width: 5, height: 1 },
      });
      expect(g.get(3, 0)).toBe("H");
      expect(g.get(7, 0)).toBe("o");
    });
  });

  describe("line", () => {
    it("renders a horizontal line", () => {
      const g = new Grid(10, 1);
      renderWidget(g, {
        type: "line",
        direction: "horizontal",
        rect: { col: 1, row: 0, width: 5, height: 1 },
      });
      for (let c = 1; c < 6; c++) {
        expect(g.get(c, 0)).toBe(LINE_CHARS.horizontal);
      }
      expect(g.get(0, 0)).toBe(" ");
      expect(g.get(6, 0)).toBe(" ");
    });

    it("renders a vertical line", () => {
      const g = new Grid(1, 10);
      renderWidget(g, {
        type: "line",
        direction: "vertical",
        rect: { col: 0, row: 2, width: 1, height: 4 },
      });
      for (let r = 2; r < 6; r++) {
        expect(g.get(0, r)).toBe(LINE_CHARS.vertical);
      }
      expect(g.get(0, 1)).toBe(" ");
      expect(g.get(0, 6)).toBe(" ");
    });
  });
});
