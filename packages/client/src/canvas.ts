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
const GRID_LINE_COLOR = "#555";
const SELECTION_BORDER_COLOR = "#f5c542";
const MARQUEE_FILL = "rgba(245, 197, 66, 0.2)";
const MARQUEE_BORDER = "rgba(245, 197, 66, 0.4)";
const HOVER_BORDER_COLOR = "#888";
const BOUNDING_BOX_COLOR = "rgba(245, 197, 66, 0.6)";
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

  render(
    selections: Rect[],
    showHandles = false,
    lineDirection?: "horizontal" | "vertical",
    cursor?: { col: number; row: number; visible: boolean } | null,
    hoverRect?: Rect | null,
    marquee?: Rect | null,
    boundingBox?: Rect | null,
    hoverHandles?: { lineDirection?: "horizontal" | "vertical" } | null,
  ): void {
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

    // Hover highlight (drawn before selection so selection renders on top)
    if (hoverRect) {
      const isSelected = selections.some(
        s => s.col === hoverRect.col && s.row === hoverRect.row &&
             s.width === hoverRect.width && s.height === hoverRect.height
      );
      if (!isSelected) {
        const hx = hoverRect.col * CELL_WIDTH;
        const hy = hoverRect.row * CELL_HEIGHT;
        const hw = hoverRect.width * CELL_WIDTH;
        const hh = hoverRect.height * CELL_HEIGHT;
        this.ctx.strokeStyle = HOVER_BORDER_COLOR;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(hx, hy, hw, hh);

        // Resize handles on hovered widget
        if (hoverHandles) {
          this.ctx.fillStyle = HOVER_BORDER_COLOR;
          const half = Math.floor(HANDLE_SIZE / 2);
          const handles = getHandlePositions(hx, hy, hw, hh, hoverHandles.lineDirection);
          for (const [handleX, handleY] of handles) {
            this.ctx.fillRect(handleX - half, handleY - half, HANDLE_SIZE, HANDLE_SIZE);
          }
        }
      }
    }

    // Selection highlights
    for (const sel of selections) {
      const sx = sel.col * CELL_WIDTH;
      const sy = sel.row * CELL_HEIGHT;
      const sw = sel.width * CELL_WIDTH;
      const sh = sel.height * CELL_HEIGHT;

      this.ctx.strokeStyle = SELECTION_BORDER_COLOR;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 3]);
      this.ctx.strokeRect(sx, sy, sw, sh);
      this.ctx.setLineDash([]);

      // Drag handles (only for single selection)
      if (showHandles && selections.length === 1) {
        this.ctx.fillStyle = SELECTION_BORDER_COLOR;
        const half = Math.floor(HANDLE_SIZE / 2);
        const handles = getHandlePositions(sx, sy, sw, sh, lineDirection);
        for (const [hx, hy] of handles) {
          this.ctx.fillRect(hx - half, hy - half, HANDLE_SIZE, HANDLE_SIZE);
        }
      }
    }

    // Bounding box around multi-selection
    if (boundingBox && selections.length > 1) {
      const bx = boundingBox.col * CELL_WIDTH;
      const by = boundingBox.row * CELL_HEIGHT;
      const bw = boundingBox.width * CELL_WIDTH;
      const bh = boundingBox.height * CELL_HEIGHT;
      this.ctx.strokeStyle = BOUNDING_BOX_COLOR;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 3]);
      this.ctx.strokeRect(bx, by, bw, bh);
      this.ctx.setLineDash([]);
    }

    // Marquee (box-select preview)
    if (marquee) {
      const mx = marquee.col * CELL_WIDTH;
      const my = marquee.row * CELL_HEIGHT;
      const mw = marquee.width * CELL_WIDTH;
      const mh = marquee.height * CELL_HEIGHT;
      this.ctx.fillStyle = MARQUEE_FILL;
      this.ctx.fillRect(mx, my, mw, mh);
      this.ctx.strokeStyle = MARQUEE_BORDER;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 3]);
      this.ctx.strokeRect(mx, my, mw, mh);
      this.ctx.setLineDash([]);
    }

    // Text editing cursor
    if (cursor?.visible) {
      const cx = cursor.col * CELL_WIDTH;
      const cy = cursor.row * CELL_HEIGHT + 2;
      this.ctx.strokeStyle = SELECTION_BORDER_COLOR;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      this.ctx.moveTo(cx + 0.5, cy);
      this.ctx.lineTo(cx + 0.5, cy + FONT_SIZE);
      this.ctx.stroke();
    }
  }

  /** Returns which handle the pixel coordinate is over, or null. */
  getHandleAt(px: number, py: number, selection: Rect, lineDirection?: "horizontal" | "vertical"): HandleCorner | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = px - rect.left;
    const y = py - rect.top;

    const sx = selection.col * CELL_WIDTH;
    const sy = selection.row * CELL_HEIGHT;
    const sw = selection.width * CELL_WIDTH;
    const sh = selection.height * CELL_HEIGHT;

    const handles = getHandlePositions(sx, sy, sw, sh, lineDirection);
    for (const [hx, hy, corner] of handles) {
      if (Math.abs(x - hx) <= HANDLE_HIT_RADIUS && Math.abs(y - hy) <= HANDLE_HIT_RADIUS) {
        return corner;
      }
    }
    return null;
  }

  setGrid(grid: Grid): void {
    this.grid = grid;
  }
}

/** Compute handle positions. For lines, only return 2 endpoint handles. */
function getHandlePositions(
  sx: number, sy: number, sw: number, sh: number,
  lineDirection?: "horizontal" | "vertical"
): [number, number, HandleCorner][] {
  if (lineDirection === "horizontal") {
    // Left and right endpoints, vertically centered
    const midY = sy + sh / 2;
    return [
      [sx, midY, "nw"],
      [sx + sw, midY, "ne"],
    ];
  }
  if (lineDirection === "vertical") {
    // Top and bottom endpoints, horizontally centered
    const midX = sx + sw / 2;
    return [
      [midX, sy, "nw"],
      [midX, sy + sh, "sw"],
    ];
  }
  // Box: 4 corners
  return [
    [sx, sy, "nw"],
    [sx + sw, sy, "ne"],
    [sx, sy + sh, "sw"],
    [sx + sw, sy + sh, "se"],
  ];
}
