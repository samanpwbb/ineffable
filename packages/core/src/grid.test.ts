import { describe, it, expect } from "vitest";
import { Grid } from "./grid.js";
import { gridFrom } from "./test-helpers.js";

describe("Grid", () => {
  it("initializes with spaces", () => {
    const g = new Grid(3, 2);
    expect(g.get(0, 0)).toBe(" ");
    expect(g.get(2, 1)).toBe(" ");
  });

  it("returns space for out-of-bounds reads", () => {
    const g = new Grid(3, 2);
    expect(g.get(-1, 0)).toBe(" ");
    expect(g.get(3, 0)).toBe(" ");
    expect(g.get(0, -1)).toBe(" ");
    expect(g.get(0, 2)).toBe(" ");
  });

  it("set and get round-trip", () => {
    const g = new Grid(5, 5);
    g.set(2, 3, "X");
    expect(g.get(2, 3)).toBe("X");
  });

  it("ignores out-of-bounds writes", () => {
    const g = new Grid(3, 3);
    g.set(-1, 0, "X");
    g.set(3, 0, "X");
    // Should not throw
    expect(g.get(0, 0)).toBe(" ");
  });

  it("writeString writes horizontally", () => {
    const g = new Grid(10, 1);
    g.writeString(2, 0, "hello");
    expect(g.get(2, 0)).toBe("h");
    expect(g.get(6, 0)).toBe("o");
  });

  it("fillRect fills a region", () => {
    const g = new Grid(5, 5);
    g.fillRect(1, 1, 3, 2, "#");
    expect(g.get(1, 1)).toBe("#");
    expect(g.get(3, 2)).toBe("#");
    expect(g.get(0, 0)).toBe(" ");
  });

  it("clearRect sets to spaces", () => {
    const g = new Grid(5, 5);
    g.fillRect(0, 0, 5, 5, "X");
    g.clearRect(1, 1, 2, 2);
    expect(g.get(0, 0)).toBe("X");
    expect(g.get(1, 1)).toBe(" ");
    expect(g.get(2, 2)).toBe(" ");
  });

  it("clone creates a deep copy", () => {
    const g = new Grid(3, 3);
    g.set(0, 0, "A");
    const copy = g.clone();
    copy.set(0, 0, "B");
    expect(g.get(0, 0)).toBe("A");
    expect(copy.get(0, 0)).toBe("B");
  });

  it("toString serializes and trims", () => {
    const g = new Grid(5, 3);
    g.writeString(0, 0, "hi");
    const text = g.toString();
    expect(text).toBe("hi\n");
  });

  it("fromString round-trips", () => {
    const input = "hello\nworld\n";
    const g = Grid.fromString(input, 10, 5);
    expect(g.get(0, 0)).toBe("h");
    expect(g.get(4, 1)).toBe("d");
  });

  it("fromString strips comment lines", () => {
    const input = "# comment\n# another\nhello\n";
    const g = Grid.fromString(input, 10, 5);
    expect(g.comments).toEqual(["# comment", "# another"]);
    expect(g.get(0, 0)).toBe("h");
  });

  it("toString preserves comments", () => {
    const input = "# comment\nhello\n";
    const g = Grid.fromString(input, 10, 5);
    const text = g.toString();
    expect(text).toContain("# comment");
    expect(text).toContain("hello");
  });
});

describe("gridFrom helper", () => {
  it("creates grid from template literal", () => {
    const g = gridFrom`
      AB
      CD
    `;
    expect(g.width).toBe(2);
    expect(g.height).toBe(2);
    expect(g.get(0, 0)).toBe("A");
    expect(g.get(1, 1)).toBe("D");
  });

  it("preserves spaces in content", () => {
    const g = gridFrom`
      A B
    `;
    expect(g.width).toBe(3);
    expect(g.get(1, 0)).toBe(" ");
  });
});
