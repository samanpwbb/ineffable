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

  // Inline editing state
  isEditing = false;
  private editBuffer = "";
  private editCursorPos = 0;
  editCursorVisible = false;
  private editBlinkTimer: ReturnType<typeof setInterval> | null = null;
  private editSnapshot: Grid | null = null; // grid state before editing began
  private editIsNew = false; // true if widget was just created (Escape removes it)
  private onRedrawCallback: (() => void) | null = null;

  // Double-click detection
  private lastClickTime = 0;
  private lastClickCol = -1;
  private lastClickRow = -1;

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
    if (this.isEditing) this.stopEditing(true);
    this.tool = tool;
    this.selection = null;
    this.selectedWidget = null;
    this.updateStatus(0, 0);
    this.redraw();
  }

  setGrid(grid: Grid): void {
    if (this.isEditing) this.stopEditing(false);
    this.grid = grid;
    this.renderer.setGrid(grid);
    this.renderer.resize();
    this.reparse();
    this.selection = null;
    this.selectedWidget = null;
    // Reset undo history when loading a new file
    this.lastSavedState = grid.toString();
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
  }

  private get isResizable(): boolean {
    const t = this.selectedWidget?.type;
    return t === "box" || t === "line" || t === "button";
  }

  /** Returns "horizontal" or "vertical" for line-like widgets (lines and buttons). */
  private get selectedLineDirection(): "horizontal" | "vertical" | undefined {
    const w = this.selectedWidget;
    if (w?.type === "line") return w.direction;
    if (w?.type === "button") return "horizontal";
    return undefined;
  }

  redraw(): void {
    this.renderer.render(
      this.selection,
      this.isResizable && !this.isEditing,
      this.selectedLineDirection,
      this.getEditCursor(),
    );
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
    // Commit any active inline edit when clicking
    if (this.isEditing) {
      this.stopEditing(true);
    }

    const { col, row } = this.renderer.pixelToGrid(px, py);

    // Double-click detection: edit existing button/text
    const now = Date.now();
    const isDoubleClick =
      now - this.lastClickTime < 400 &&
      col === this.lastClickCol &&
      row === this.lastClickRow;
    this.lastClickTime = now;
    this.lastClickCol = col;
    this.lastClickRow = row;

    if (isDoubleClick && this.tool === "select" && this.selectedWidget) {
      const t = this.selectedWidget.type;
      if (t === "button" || t === "text" || t === "box") {
        this.startEditing(false);
        return;
      }
    }

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

      // Otherwise, try to select an existing widget — and start a move
      // so select + drag works in a single gesture
      const hit = widgetAt(this.widgets, col, row);
      if (hit) {
        this.selection = { ...hit.rect };
        this.selectedWidget = hit;
        this.isMoving = true;
        this.gridSnapshot = this.grid.clone();
        this.moveOffset = {
          col: col - hit.rect.col,
          row: row - hit.rect.row,
        };
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
    } else if (this.tool === "button") {
      const startCol = Math.min(this.dragStart.col, col);
      const width = Math.max(5, Math.abs(col - this.dragStart.col) + 1);
      this.selection = { col: startCol, row: this.dragStart.row, width, height: 1 };
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
      if (newCol !== this.selectedWidget.rect.col || newRow !== this.selectedWidget.rect.row) {
        this.moveWidget(this.selectedWidget, newCol, newRow);
      }
      this.gridSnapshot = null;
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
        this.tool = "select";
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
        this.tool = "select";
      }
    } else if (this.tool === "button") {
      let width = 5; // minimum: "[ _ ]"
      if (this.isDragging && this.dragStart) {
        width = Math.max(5, Math.abs(col - this.dragStart.col) + 1);
      }
      const startCol = this.isDragging && this.dragStart ? Math.min(col, this.dragStart.col) : col;
      const btnRow = this.isDragging && this.dragStart ? this.dragStart.row : row;
      this.placeWidget({
        type: "button",
        label: "",
        rect: { col: startCol, row: btnRow, width, height: 1 },
      }, true);
      this.tool = "select";
      this.startEditing(true);
    } else if (this.tool === "text" && !this.isDragging) {
      this.placeWidget({
        type: "text",
        content: "",
        rect: { col, row, width: 1, height: 1 },
      }, true);
      this.tool = "select";
      this.startEditing(true);
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
    let minW = widget?.type === "box" ? 3 : 2;
    const minH = widget?.type === "box" ? 3 : 2;

    // Button minimum width: must fit label + "[ " + " ]"
    if (widget?.type === "button") {
      minW = Math.max(5, widget.label.length + 4);
    }

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

    // For lines and buttons, constrain to their axis
    if (widget?.type === "line") {
      if (widget.direction === "horizontal") {
        dragRow = anchor.row;
      } else {
        dragCol = anchor.col;
      }
    } else if (widget?.type === "button") {
      dragRow = anchor.row;
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

    // Buttons are always 1 row tall, horizontal only
    if (widget?.type === "button") {
      return { col: newCol, row: anchor.row, width: newWidth, height: 1 };
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

  private placeWidget(widget: Widget, skipSave = false): void {
    renderWidget(this.grid, widget);
    this.reparse();
    this.selection = { ...widget.rect };
    this.selectedWidget = widgetAt(this.widgets, widget.rect.col, widget.rect.row) ?? widget;
    this.redraw();
    if (!skipSave) this.save();
  }

  async save(): Promise<void> {
    if (!this.currentFile) return;
    this.pushUndo();
    try {
      await writeFile(this.currentFile, this.grid.toString());
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }

  // --- Widget deletion ---

  deleteSelected(): void {
    if (!this.selectedWidget || !this.selection) return;
    const r = this.selectedWidget.rect;
    this.grid.clearRect(r.col, r.row, r.width, r.height);
    // Re-render widgets that were under the deleted one
    this.reparse();
    for (const w of this.widgets) {
      renderWidget(this.grid, w);
    }
    this.selection = null;
    this.selectedWidget = null;
    this.reparse();
    this.redraw();
    this.save();
  }

  clearAll(): void {
    this.grid.clearRect(0, 0, this.grid.width, this.grid.height);
    this.widgets = [];
    this.selection = null;
    this.selectedWidget = null;
    this.redraw();
    this.save();
  }

  // --- Nudge & directional selection ---

  nudgeSelected(direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
    if (!this.selectedWidget) return;
    const delta = { col: 0, row: 0 };
    if (direction === "ArrowUp") delta.row = -1;
    else if (direction === "ArrowDown") delta.row = 1;
    else if (direction === "ArrowLeft") delta.col = -1;
    else if (direction === "ArrowRight") delta.col = 1;

    const newCol = this.selectedWidget.rect.col + delta.col;
    const newRow = this.selectedWidget.rect.row + delta.row;
    this.gridSnapshot = this.grid.clone();
    this.moveWidget(this.selectedWidget, newCol, newRow);
  }

  selectInDirection(direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
    if (this.widgets.length === 0) return;

    // If nothing selected, select the first widget
    if (!this.selectedWidget) {
      const w = this.widgets[0];
      this.selection = { ...w.rect };
      this.selectedWidget = w;
      this.redraw();
      return;
    }

    const cur = this.selectedWidget.rect;
    const cx = cur.col + cur.width / 2;
    const cy = cur.row + cur.height / 2;

    let best: Widget | null = null;
    let bestDist = Infinity;

    for (const w of this.widgets) {
      if (w === this.selectedWidget) continue;
      const wr = w.rect;
      const wx = wr.col + wr.width / 2;
      const wy = wr.row + wr.height / 2;
      const dx = wx - cx;
      const dy = wy - cy;

      // Check if the widget is in the correct direction
      let inDirection = false;
      if (direction === "ArrowUp" && dy < 0) inDirection = true;
      else if (direction === "ArrowDown" && dy > 0) inDirection = true;
      else if (direction === "ArrowLeft" && dx < 0) inDirection = true;
      else if (direction === "ArrowRight" && dx > 0) inDirection = true;

      if (!inDirection) continue;

      // Prefer widgets along the primary axis, with cross-axis as tiebreaker
      let dist: number;
      if (direction === "ArrowUp" || direction === "ArrowDown") {
        dist = Math.abs(dy) + Math.abs(dx) * 0.1;
      } else {
        dist = Math.abs(dx) + Math.abs(dy) * 0.1;
      }
      if (dist < bestDist) {
        bestDist = dist;
        best = w;
      }
    }

    if (best) {
      this.selection = { ...best.rect };
      this.selectedWidget = best;
      this.redraw();
    }
  }

  // --- Undo / Redo ---

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSavedState: string | null = null;

  private pushUndo(): void {
    const state = this.grid.toString();
    if (state === this.lastSavedState) return; // no change
    this.undoStack.push(this.lastSavedState ?? state);
    this.redoStack = [];
    this.lastSavedState = state;
    // Cap the stack
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    const current = this.grid.toString();
    this.redoStack.push(current);
    const prev = this.undoStack.pop()!;
    this.applyState(prev);
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    const current = this.grid.toString();
    this.undoStack.push(current);
    const next = this.redoStack.pop()!;
    this.applyState(next);
  }

  private applyState(state: string): void {
    const grid = Grid.fromString(state, this.grid.width, this.grid.height);
    this.grid = grid;
    this.renderer.setGrid(grid);
    this.lastSavedState = state;
    this.reparse();
    this.selection = null;
    this.selectedWidget = null;
    this.redraw();
    // Persist to server without pushing onto the undo stack
    if (this.currentFile) {
      writeFile(this.currentFile, state).catch((e) =>
        console.error("Failed to save:", e)
      );
    }
  }

  // --- Inline editing ---

  /** Register a callback for cursor blink redraws (called by App). */
  setRedrawCallback(cb: () => void): void {
    this.onRedrawCallback = cb;
  }

  startEditing(isNew: boolean): void {
    if (!this.selectedWidget) return;
    const w = this.selectedWidget;
    if (w.type !== "button" && w.type !== "text" && w.type !== "box") return;

    this.isEditing = true;
    this.editIsNew = isNew;
    this.editSnapshot = this.grid.clone();
    // For new widgets, start with empty buffer (parser may have detected padding spaces)
    if (isNew) {
      this.editBuffer = "";
    } else if (w.type === "button") {
      this.editBuffer = w.label;
    } else if (w.type === "box") {
      this.editBuffer = w.label ?? "";
    } else {
      this.editBuffer = w.content;
    }
    this.editCursorPos = this.editBuffer.length;
    this.editCursorVisible = true;

    // Start blink timer
    this.editBlinkTimer = setInterval(() => {
      this.editCursorVisible = !this.editCursorVisible;
      this.redraw();
      this.onRedrawCallback?.();
    }, 530);

    this.redraw();
  }

  stopEditing(commit: boolean): void {
    if (!this.isEditing) return;

    // Stop blink
    if (this.editBlinkTimer !== null) {
      clearInterval(this.editBlinkTimer);
      this.editBlinkTimer = null;
    }
    this.editCursorVisible = false;

    // For boxes, empty label on commit is fine (just no label).
    // For buttons/text, empty buffer on commit means cancel.
    const shouldRevert = !commit ||
      (this.editBuffer.length === 0 && this.selectedWidget?.type !== "box");
    if (shouldRevert) {
      // Cancel: restore grid to pre-edit state
      if (this.editSnapshot) {
        for (let r = 0; r < this.grid.height; r++) {
          for (let c = 0; c < this.grid.width; c++) {
            this.grid.set(c, r, this.editSnapshot.get(c, r));
          }
        }
      }
      if (this.editIsNew) {
        // Widget was just created — remove selection
        this.selection = null;
        this.selectedWidget = null;
      }
    }
    // If committing, the grid already has the latest content from updateEditWidget

    this.isEditing = false;
    this.editSnapshot = null;
    this.reparse();
    this.redraw();
    this.save();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (!this.isEditing || !this.selectedWidget) return;

    if (e.key === "Enter") {
      e.preventDefault();
      this.stopEditing(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.stopEditing(false);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (this.editCursorPos > 0) {
        this.editBuffer =
          this.editBuffer.slice(0, this.editCursorPos - 1) +
          this.editBuffer.slice(this.editCursorPos);
        this.editCursorPos--;
        this.updateEditWidget();
      }
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      if (this.editCursorPos < this.editBuffer.length) {
        this.editBuffer =
          this.editBuffer.slice(0, this.editCursorPos) +
          this.editBuffer.slice(this.editCursorPos + 1);
        this.updateEditWidget();
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (this.editCursorPos > 0) {
        this.editCursorPos--;
        this.resetBlink();
        this.redraw();
      }
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (this.editCursorPos < this.editBuffer.length) {
        this.editCursorPos++;
        this.resetBlink();
        this.redraw();
      }
      return;
    }

    // Printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.editBuffer =
        this.editBuffer.slice(0, this.editCursorPos) +
        e.key +
        this.editBuffer.slice(this.editCursorPos);
      this.editCursorPos++;
      this.updateEditWidget();
    }
  }

  /** Returns the cursor grid position for rendering, or null if not editing. */
  getEditCursor(): { col: number; row: number; visible: boolean } | null {
    if (!this.isEditing || !this.selectedWidget) return null;
    const w = this.selectedWidget;
    let row = w.rect.row;
    let col: number;
    if (w.type === "button") {
      // Cursor inside the "[ ... ]" wrapper — label starts after "[ " plus centering padding
      const innerWidth = w.rect.width - 4;
      const padLeft = Math.floor((innerWidth - this.editBuffer.length) / 2);
      col = w.rect.col + 2 + padLeft + this.editCursorPos;
    } else if (w.type === "box") {
      // Cursor centered in box interior
      const innerWidth = w.rect.width - 2;
      const padLeft = Math.floor((innerWidth - this.editBuffer.length) / 2);
      col = w.rect.col + 1 + padLeft + this.editCursorPos;
      row = w.rect.row + Math.floor(w.rect.height / 2);
    } else {
      col = w.rect.col + this.editCursorPos;
    }
    return { col, row, visible: this.editCursorVisible };
  }

  private resetBlink(): void {
    this.editCursorVisible = true;
    if (this.editBlinkTimer !== null) {
      clearInterval(this.editBlinkTimer);
    }
    this.editBlinkTimer = setInterval(() => {
      this.editCursorVisible = !this.editCursorVisible;
      this.redraw();
      this.onRedrawCallback?.();
    }, 530);
  }

  private updateEditWidget(): void {
    if (!this.selectedWidget) return;
    const w = this.selectedWidget;

    // Clear old footprint
    this.grid.clearRect(w.rect.col, w.rect.row, w.rect.width, w.rect.height);

    if (w.type === "button") {
      const neededWidth = Math.max(5, this.editBuffer.length + 4);
      if (neededWidth <= w.rect.width) {
        // Text fits — re-render at same size (renderButton centers it)
        const updated: Widget = { type: "button", label: this.editBuffer, rect: w.rect };
        renderWidget(this.grid, updated);
        this.selectedWidget = updated;
      } else {
        // Need to grow — expand from center, overflow right
        const grow = neededWidth - w.rect.width;
        const growLeft = Math.min(Math.floor(grow / 2), w.rect.col);
        const growRight = grow - growLeft;
        const newRect = {
          ...w.rect,
          col: w.rect.col - growLeft,
          width: w.rect.width + growLeft + growRight,
        };
        const updated: Widget = { type: "button", label: this.editBuffer, rect: newRect };
        renderWidget(this.grid, updated);
        this.selectedWidget = updated;
        this.selection = { ...newRect };
      }
    } else if (w.type === "box") {
      // Re-render box with updated label — box size stays the same
      const updated: Widget = { type: "box", label: this.editBuffer || undefined, rect: w.rect };
      renderWidget(this.grid, updated);
      this.selectedWidget = updated;
    } else if (w.type === "text") {
      const newWidth = Math.max(1, this.editBuffer.length);
      const newRect = { ...w.rect, width: newWidth };
      const updated: Widget = { type: "text", content: this.editBuffer, rect: newRect };
      renderWidget(this.grid, updated);
      this.selectedWidget = updated;
      this.selection = { ...newRect };
    }

    this.resetBlink();
    this.redraw();
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
