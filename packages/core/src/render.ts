/**
 * Render widgets onto a Grid.
 * This is the inverse of the parser — given a widget, stamp its
 * ASCII pattern onto the grid.
 */

import { Grid } from "./grid.js";
import { Widget, BOX_CHARS, LINE_CHARS } from "./patterns.js";

/** Render a single widget onto the grid. */
export function renderWidget(grid: Grid, widget: Widget): void {
  switch (widget.type) {
    case "box":
      renderBox(grid, widget.rect.col, widget.rect.row, widget.rect.width, widget.rect.height, widget.label);
      break;
    case "button":
      renderButton(grid, widget.rect.col, widget.rect.row, widget.label, widget.rect.width);
      break;
    case "text":
      grid.writeString(widget.rect.col, widget.rect.row, widget.content);
      break;
    case "line":
      renderLine(grid, widget.rect.col, widget.rect.row, widget.direction, widget.direction === "horizontal" ? widget.rect.width : widget.rect.height);
      break;
  }
}

function renderBox(grid: Grid, col: number, row: number, width: number, height: number, label?: string): void {
  // Corners
  grid.set(col, row, BOX_CHARS.topLeft);
  grid.set(col + width - 1, row, BOX_CHARS.topRight);
  grid.set(col, row + height - 1, BOX_CHARS.bottomLeft);
  grid.set(col + width - 1, row + height - 1, BOX_CHARS.bottomRight);

  // Top and bottom edges
  for (let c = col + 1; c < col + width - 1; c++) {
    grid.set(c, row, BOX_CHARS.horizontal);
    grid.set(c, row + height - 1, BOX_CHARS.horizontal);
  }

  // Left and right edges
  for (let r = row + 1; r < row + height - 1; r++) {
    grid.set(col, r, BOX_CHARS.vertical);
    grid.set(col + width - 1, r, BOX_CHARS.vertical);
  }

  // Centered label
  if (label) {
    const innerWidth = width - 2;
    const midRow = row + Math.floor(height / 2);
    const padLeft = Math.floor((innerWidth - label.length) / 2);
    grid.writeString(col + 1 + padLeft, midRow, label);
  }
}

function renderButton(grid: Grid, col: number, row: number, label: string, totalWidth: number): void {
  const minWidth = label.length + 4; // "[ " + label + " ]"
  const width = Math.max(minWidth, totalWidth);
  const innerWidth = width - 4;
  const padTotal = innerWidth - label.length;
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;
  const content = "[ " + " ".repeat(padLeft) + label + " ".repeat(padRight) + " ]";
  grid.writeString(col, row, content);
}

function renderLine(grid: Grid, col: number, row: number, direction: "horizontal" | "vertical", length: number): void {
  for (let i = 0; i < length; i++) {
    if (direction === "horizontal") {
      grid.set(col + i, row, LINE_CHARS.horizontal);
    } else {
      grid.set(col, row + i, LINE_CHARS.vertical);
    }
  }
}
