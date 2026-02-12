/**
 * ASCII pattern definitions for each widget type.
 * These mirror the definitions in PATTERNS.md and are used
 * for both rendering and detection.
 */

export type WidgetType = "box" | "button" | "toggle" | "text" | "line";

export const BOX_CHARS = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
} as const;

export const BUTTON_CHARS = {
  open: "[ ",
  close: " ]",
} as const;

export const TOGGLE_CHARS = {
  on: "[x] ",
  off: "[ ] ",
} as const;

export const LINE_CHARS = {
  horizontal: "─",
  vertical: "│",
} as const;

/** All box-drawing corner characters, used to distinguish boxes from standalone lines */
export const BOX_CORNERS = new Set([
  BOX_CHARS.topLeft,
  BOX_CHARS.topRight,
  BOX_CHARS.bottomLeft,
  BOX_CHARS.bottomRight,
]);

export interface Rect {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface BoxWidget {
  type: "box";
  rect: Rect;
}

export interface ButtonWidget {
  type: "button";
  label: string;
  rect: Rect;
}

export interface ToggleWidget {
  type: "toggle";
  label: string;
  on: boolean;
  rect: Rect;
}

export interface TextWidget {
  type: "text";
  content: string;
  rect: Rect;
}

export interface LineWidget {
  type: "line";
  direction: "horizontal" | "vertical";
  rect: Rect;
}

export type Widget = BoxWidget | ButtonWidget | ToggleWidget | TextWidget | LineWidget;
