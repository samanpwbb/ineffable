/**
 * Canvas renderer — draws the character grid onto an HTML5 canvas.
 * Each character maps to a fixed-size cell in a monospace grid.
 */

import { Grid, Rect } from "@ineffable/core";

export type HandleCorner = "nw" | "ne" | "sw" | "se";

const CELL_WIDTH = 10;
const CELL_HEIGHT = 18;
const FONT_SIZE = 14;
const FONT_FAMILY = "'Space Mono', monospace";
const TEXT_COLOR = "#fff";
const BG_COLOR = "#000";
const GRID_LINE_COLOR = "#111";
const SELECTION_BORDER_COLOR = "#f5c542";
const HANDLE_SIZE = 5; // px, each side of the square
const HANDLE_HIT_RADIUS = 6; // px, hit detection radius

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  readonly cellWidth = CELL_WIDTH;
  readonly cellHeight = CELL_HEIGHT;

  constructor(private canvas: HTMLCanvasElement, private grid: Grid) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.grid.width * CELL_WIDTH;
    const h = this.grid.height * CELL_HEIGHT;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  pixelToGrid(px: number, py: number): { col: number; row: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = px - rect.left;
    const y = py - rect.top;
    return {
      col: Math.floor(x / CELL_WIDTH),
      row: Math.floor(y / CELL_HEIGHT),
    };
  }

  render(selection: Rect | null, showHandles = false): void {
    const g = this.grid;
    const w = g.width * CELL_WIDTH;
    const h = g.height * CELL_HEIGHT;

    // Clear
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, w, h);

    // Subtle grid lines
    this.ctx.strokeStyle = GRID_LINE_COLOR;
    this.ctx.lineWidth = 0.5;
    for (let c = 0; c <= g.width; c++) {
      this.ctx.beginPath();
      this.ctx.moveTo(c * CELL_WIDTH, 0);
      this.ctx.lineTo(c * CELL_WIDTH, h);
      this.ctx.stroke();
    }
    for (let r = 0; r <= g.height; r++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, r * CELL_HEIGHT);
      this.ctx.lineTo(w, r * CELL_HEIGHT);
      this.ctx.stroke();
    }

    // Draw characters (white on black)
    this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    this.ctx.fillStyle = TEXT_COLOR;
    this.ctx.textBaseline = "top";
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        const ch = g.get(c, r);
        if (ch !== " ") {
          const x = c * CELL_WIDTH + 1;
          const y = r * CELL_HEIGHT + 2;
          this.ctx.fillText(ch, x, y);
        }
      }
    }

    // Selection highlight
    if (selection) {
      const sx = selection.col * CELL_WIDTH;
      const sy = selection.row * CELL_HEIGHT;
      const sw = selection.width * CELL_WIDTH;
      const sh = selection.height * CELL_HEIGHT;

      this.ctx.strokeStyle = SELECTION_BORDER_COLOR;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 3]);
      this.ctx.strokeRect(sx, sy, sw, sh);
      this.ctx.setLineDash([]);

      // Drag handles at corners
      if (showHandles) {
        this.ctx.fillStyle = SELECTION_BORDER_COLOR;
        const half = Math.floor(HANDLE_SIZE / 2);
        const corners = [
          [sx, sy],                 // nw
          [sx + sw, sy],            // ne
          [sx, sy + sh],            // sw
          [sx + sw, sy + sh],       // se
        ];
        for (const [cx, cy] of corners) {
          this.ctx.fillRect(cx - half, cy - half, HANDLE_SIZE, HANDLE_SIZE);
        }
      }
    }
  }

  /** Returns which corner handle the pixel coordinate is over, or null. */
  getHandleAt(px: number, py: number, selection: Rect): HandleCorner | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = px - rect.left;
    const y = py - rect.top;

    const sx = selection.col * CELL_WIDTH;
    const sy = selection.row * CELL_HEIGHT;
    const sw = selection.width * CELL_WIDTH;
    const sh = selection.height * CELL_HEIGHT;

    const corners: [number, number, HandleCorner][] = [
      [sx, sy, "nw"],
      [sx + sw, sy, "ne"],
      [sx, sy + sh, "sw"],
      [sx + sw, sy + sh, "se"],
    ];

    for (const [cx, cy, corner] of corners) {
      if (Math.abs(x - cx) <= HANDLE_HIT_RADIUS && Math.abs(y - cy) <= HANDLE_HIT_RADIUS) {
        return corner;
      }
    }
    return null;
  }

  setGrid(grid: Grid): void {
    this.grid = grid;
  }
}
