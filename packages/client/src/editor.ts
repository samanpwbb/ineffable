/**
 * Editor — tool state machine & interaction handling.
 * Manages the current tool, mouse events, and widget manipulation.
 */

import {
  Grid,
  Widget,
  Rect,
  WidgetType,
  detectWidgets,
  widgetAt,
  widgetsInside,
  renderWidget,
} from "@ineffable/core";
import { CanvasRenderer, HandleCorner } from "./canvas.js";
import { writeFile } from "./api.js";

export type Tool = "select" | WidgetType;

export class Editor {
  grid: Grid;
  tool: Tool = "select";
  widgets: Widget[] = [];
  selection: Rect | null = null;
  selectedWidget: Widget | null = null;
  currentFile: string | null = null;

  // Drag state
  private dragStart: { col: number; row: number } | null = null;
  private isDragging = false;
  private isMoving = false;
  private moveOffset: { col: number; row: number } = { col: 0, row: 0 };
  private gridSnapshot: Grid | null = null;

  // Resize state
  private isResizing = false;
  private resizeHandle: HandleCorner | null = null;
  private resizeAnchor: Rect | null = null; // original selection rect at resize start

  // Callbacks
  private onStatusUpdate: (pos: string, tool: string, file: string) => void;

  constructor(
    private renderer: CanvasRenderer,
    grid: Grid,
    onStatusUpdate: (pos: string, tool: string, file: string) => void
  ) {
    this.grid = grid;
    this.onStatusUpdate = onStatusUpdate;
    this.reparse();
  }

  reparse(): void {
    this.widgets = detectWidgets(this.grid);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.selection = null;
    this.selectedWidget = null;
    this.updateStatus(0, 0);
    this.redraw();
  }

  setGrid(grid: Grid): void {
    this.grid = grid;
    this.renderer.setGrid(grid);
    this.renderer.resize();
    this.reparse();
    this.selection = null;
    this.selectedWidget = null;
    this.redraw();
  }

  private get isResizable(): boolean {
    const t = this.selectedWidget?.type;
    return t === "box" || t === "line";
  }

  private get selectedLineDirection(): "horizontal" | "vertical" | undefined {
    const w = this.selectedWidget;
    return w?.type === "line" ? w.direction : undefined;
  }

  redraw(): void {
    this.renderer.render(this.selection, this.isResizable, this.selectedLineDirection);
  }

  updateStatus(col: number, row: number): void {
    this.onStatusUpdate(
      `${col}, ${row}`,
      this.tool,
      this.currentFile ?? "-"
    );
  }

  // --- Mouse handlers ---

  onMouseDown(px: number, py: number): void {
    const { col, row } = this.renderer.pixelToGrid(px, py);
    this.dragStart = { col, row };
    this.isDragging = false;
    this.isMoving = false;
    this.isResizing = false;
    this.resizeHandle = null;

    if (this.tool === "select") {
      // Check if clicking on a resize handle
      if (this.selection && this.selectedWidget && this.isResizable) {
        const handle = this.renderer.getHandleAt(px, py, this.selection, this.selectedLineDirection);
        if (handle) {
          this.isResizing = true;
          this.resizeHandle = handle;
          this.resizeAnchor = { ...this.selection };
          this.gridSnapshot = this.grid.clone();
          return;
        }
      }

      // Check if clicking inside the current selection (start a move)
      if (this.selection && this.selectedWidget && this.isInsideRect(col, row, this.selection)) {
        this.isMoving = true;
        this.gridSnapshot = this.grid.clone();
        this.moveOffset = {
          col: col - this.selection.col,
          row: row - this.selection.row,
        };
        return;
      }

      // Otherwise, try to select an existing widget
      const hit = widgetAt(this.widgets, col, row);
      if (hit) {
        this.selection = { ...hit.rect };
        this.selectedWidget = hit;
      } else {
        this.selection = null;
        this.selectedWidget = null;
      }
      this.redraw();
    }
  }

  onMouseMove(px: number, py: number): void {
    const { col, row } = this.renderer.pixelToGrid(px, py);
    this.updateStatus(col, row);

    if (!this.dragStart) return;
    this.isDragging = true;

    if (this.tool === "select" && this.isResizing && this.resizeAnchor && this.resizeHandle) {
      this.selection = this.computeResizedRect(this.resizeAnchor, this.resizeHandle, col, row);
      this.redraw();
    } else if (this.tool === "select" && this.isMoving && this.selectedWidget && this.selection) {
      // Update selection preview to show where widget will land
      this.selection = {
        ...this.selection,
        col: col - this.moveOffset.col,
        row: row - this.moveOffset.row,
      };
      this.redraw();
    } else if (this.tool === "box" || this.tool === "line") {
      const rect = this.dragToRect(this.dragStart, { col, row });
      this.selection = rect;
      this.redraw();
    }
  }

  onMouseUp(px: number, py: number): void {
    const { col, row } = this.renderer.pixelToGrid(px, py);

    if (this.tool === "select" && this.isResizing && this.selectedWidget && this.resizeAnchor && this.resizeHandle) {
      const newRect = this.computeResizedRect(this.resizeAnchor, this.resizeHandle, col, row);
      this.resizeWidget(this.selectedWidget, newRect);
      this.dragStart = null;
      this.isDragging = false;
      this.isResizing = false;
      this.resizeHandle = null;
      this.resizeAnchor = null;
      return;
    }

    if (this.tool === "select" && this.isMoving && this.selectedWidget) {
      const newCol = col - this.moveOffset.col;
      const newRow = row - this.moveOffset.row;
      this.moveWidget(this.selectedWidget, newCol, newRow);
      this.dragStart = null;
      this.isDragging = false;
      this.isMoving = false;
      return;
    }

    if (this.tool === "box" && this.dragStart) {
      const rect = this.dragToRect(this.dragStart, { col, row });
      if (rect.width >= 3 && rect.height >= 3) {
        this.placeWidget({
          type: "box",
          rect,
        });
      }
    } else if (this.tool === "line" && this.dragStart) {
      const dx = Math.abs(col - this.dragStart.col);
      const dy = Math.abs(row - this.dragStart.row);
      if (dx >= 2 || dy >= 2) {
        if (dx >= dy) {
          const startCol = Math.min(col, this.dragStart.col);
          this.placeWidget({
            type: "line",
            direction: "horizontal",
            rect: { col: startCol, row: this.dragStart.row, width: dx + 1, height: 1 },
          });
        } else {
          const startRow = Math.min(row, this.dragStart.row);
          this.placeWidget({
            type: "line",
            direction: "vertical",
            rect: { col: this.dragStart.col, row: startRow, width: 1, height: dy + 1 },
          });
        }
      }
    } else if (this.tool === "button" && !this.isDragging) {
      const label = prompt("Button label:");
      if (label) {
        this.placeWidget({
          type: "button",
          label,
          rect: { col, row, width: label.length + 4, height: 1 },
        });
      }
    } else if (this.tool === "text" && !this.isDragging) {
      const content = prompt("Text content:");
      if (content) {
        this.placeWidget({
          type: "text",
          content,
          rect: { col, row, width: content.length, height: 1 },
        });
      }
    }

    this.dragStart = null;
    this.isDragging = false;
    this.isMoving = false;
  }

  // --- Widget movement ---

  private moveWidget(widget: Widget, newCol: number, newRow: number): void {
    if (!this.gridSnapshot) return;

    const deltaCol = newCol - widget.rect.col;
    const deltaRow = newRow - widget.rect.row;

    // Find children from the snapshot (original layout before drag)
    const snapshotWidgets = detectWidgets(this.gridSnapshot);
    const children = widget.type === "box"
      ? widgetsInside(snapshotWidgets, widget.rect)
      : [];

    // Restore grid to pre-move state
    const snapshot = this.gridSnapshot;
    for (let r = 0; r < this.grid.height; r++) {
      for (let c = 0; c < this.grid.width; c++) {
        this.grid.set(c, r, snapshot.get(c, r));
      }
    }

    // Clear the widget's original footprint (includes children for boxes)
    const oldRect = widget.rect;
    this.grid.clearRect(oldRect.col, oldRect.row, oldRect.width, oldRect.height);

    // Re-render any widgets that were under the moved widget
    const remaining = detectWidgets(this.grid);
    for (const w of remaining) {
      renderWidget(this.grid, w);
    }

    // Render the moved widget at its new position
    const moved: Widget = {
      ...widget,
      rect: { ...oldRect, col: newCol, row: newRow },
    } as Widget;
    renderWidget(this.grid, moved);

    // Render children at their new positions (same offset as parent)
    for (const child of children) {
      const movedChild: Widget = {
        ...child,
        rect: {
          ...child.rect,
          col: child.rect.col + deltaCol,
          row: child.rect.row + deltaRow,
        },
      } as Widget;
      renderWidget(this.grid, movedChild);
    }

    this.reparse();
    this.selectedWidget = widgetAt(this.widgets, newCol, newRow) ?? moved;
    this.selection = { ...moved.rect };
    this.gridSnapshot = null;
    this.redraw();
    this.save();
  }

  // --- Widget resizing ---

  private computeResizedRect(anchor: Rect, handle: HandleCorner, col: number, row: number): Rect {
    const widget = this.selectedWidget;
    const minW = widget?.type === "box" ? 3 : 2;
    const minH = widget?.type === "box" ? 3 : 2;

    // Fixed corner is opposite the dragged handle
    let fixedCol: number, fixedRow: number;
    let dragCol: number, dragRow: number;

    switch (handle) {
      case "nw":
        fixedCol = anchor.col + anchor.width - 1;
        fixedRow = anchor.row + anchor.height - 1;
        dragCol = col;
        dragRow = row;
        break;
      case "ne":
        fixedCol = anchor.col;
        fixedRow = anchor.row + anchor.height - 1;
        dragCol = col;
        dragRow = row;
        break;
      case "sw":
        fixedCol = anchor.col + anchor.width - 1;
        fixedRow = anchor.row;
        dragCol = col;
        dragRow = row;
        break;
      case "se":
        fixedCol = anchor.col;
        fixedRow = anchor.row;
        dragCol = col;
        dragRow = row;
        break;
    }

    // For lines, constrain to their axis
    if (widget?.type === "line") {
      if (widget.direction === "horizontal") {
        dragRow = anchor.row;
      } else {
        dragCol = anchor.col;
      }
    }

    const newCol = Math.min(fixedCol, dragCol);
    const newRow = Math.min(fixedRow, dragRow);
    const newWidth = Math.max(minW, Math.abs(dragCol - fixedCol) + 1);
    const newHeight = Math.max(minH, Math.abs(dragRow - fixedRow) + 1);

    // For lines, keep 1-cell thickness on the non-axis dimension
    if (widget?.type === "line") {
      if (widget.direction === "horizontal") {
        return { col: newCol, row: anchor.row, width: newWidth, height: 1 };
      } else {
        return { col: anchor.col, row: newRow, width: 1, height: newHeight };
      }
    }

    return { col: newCol, row: newRow, width: newWidth, height: newHeight };
  }

  private resizeWidget(widget: Widget, newRect: Rect): void {
    if (!this.gridSnapshot) return;

    // Restore grid from snapshot
    const snapshot = this.gridSnapshot;
    for (let r = 0; r < this.grid.height; r++) {
      for (let c = 0; c < this.grid.width; c++) {
        this.grid.set(c, r, snapshot.get(c, r));
      }
    }

    // Clear the widget's original footprint
    const oldRect = widget.rect;
    this.grid.clearRect(oldRect.col, oldRect.row, oldRect.width, oldRect.height);

    // Re-render any widgets that were under the resized widget
    const remaining = detectWidgets(this.grid);
    for (const w of remaining) {
      renderWidget(this.grid, w);
    }

    // Build resized widget
    let resized: Widget;
    if (widget.type === "line") {
      resized = {
        ...widget,
        rect: newRect,
        direction: newRect.width > newRect.height ? "horizontal" : "vertical",
      };
    } else {
      resized = { ...widget, rect: newRect } as Widget;
    }
    renderWidget(this.grid, resized);

    // Re-render children that were inside the original box (keep absolute positions)
    if (widget.type === "box") {
      const snapshotWidgets = detectWidgets(snapshot);
      const children = widgetsInside(snapshotWidgets, oldRect);
      for (const child of children) {
        // Only re-render if the child still fits inside the new rect
        const cr = child.rect;
        if (
          cr.col > newRect.col &&
          cr.row > newRect.row &&
          cr.col + cr.width < newRect.col + newRect.width &&
          cr.row + cr.height < newRect.row + newRect.height
        ) {
          renderWidget(this.grid, child);
        }
      }
    }

    this.reparse();
    this.selectedWidget = widgetAt(this.widgets, newRect.col, newRect.row) ?? resized;
    this.selection = { ...newRect };
    this.gridSnapshot = null;
    this.redraw();
    this.save();
  }

  // --- Widget placement ---

  private placeWidget(widget: Widget): void {
    renderWidget(this.grid, widget);
    this.reparse();
    this.selection = { ...widget.rect };
    this.selectedWidget = widgetAt(this.widgets, widget.rect.col, widget.rect.row) ?? widget;
    this.redraw();
    this.save();
  }

  async save(): Promise<void> {
    if (!this.currentFile) return;
    try {
      await writeFile(this.currentFile, this.grid.toString());
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }

  // --- Cursor ---

  getCursor(px: number, py: number): string {
    if (this.tool !== "select") return "crosshair";
    if (this.selection && this.selectedWidget && this.isResizable) {
      const handle = this.renderer.getHandleAt(px, py, this.selection, this.selectedLineDirection);
      if (handle) {
        if (this.selectedLineDirection === "horizontal") return "ew-resize";
        if (this.selectedLineDirection === "vertical") return "ns-resize";
        const cursors: Record<string, string> = {
          nw: "nwse-resize",
          se: "nwse-resize",
          ne: "nesw-resize",
          sw: "nesw-resize",
        };
        return cursors[handle];
      }
    }
    if (this.selection) {
      const { col, row } = this.renderer.pixelToGrid(px, py);
      if (this.isInsideRect(col, row, this.selection)) {
        return "move";
      }
    }
    return "default";
  }

  // --- Helpers ---

  private isInsideRect(col: number, row: number, rect: Rect): boolean {
    return col >= rect.col && col < rect.col + rect.width && row >= rect.row && row < rect.row + rect.height;
  }

  private dragToRect(
    start: { col: number; row: number },
    end: { col: number; row: number }
  ): Rect {
    const col = Math.min(start.col, end.col);
    const row = Math.min(start.row, end.row);
    const width = Math.abs(end.col - start.col) + 1;
    const height = Math.abs(end.row - start.row) + 1;
    return { col, row, width, height };
  }
}
