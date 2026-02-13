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

  // Multi-selection state
  selectedWidgets: Widget[] = [];
  private isBoxSelecting = false;
  private marquee: Rect | null = null;
  private groupDragDelta: { col: number; row: number } | null = null;

  // Drag state
  private dragStart: { col: number; row: number } | null = null;
  private isDragging = false;
  private isMoving = false;
  private isMovingGroup = false;
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

  // Hover state
  private hoveredWidget: Widget | null = null;

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
    this.selectedWidgets = [];
    this.updateStatus(0, 0);
    this.redraw();
  }

  setGrid(grid: Grid, resetHistory = true): void {
    if (this.isEditing) this.stopEditing(false);
    this.grid = grid;
    this.renderer.setGrid(grid);
    this.renderer.resize();
    this.reparse();
    this.selection = null;
    this.selectedWidget = null;
    this.selectedWidgets = [];
    if (resetHistory) {
      this.lastSavedState = grid.toString();
      this.undoStack = [];
      this.redoStack = [];
    }
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
    let selections: Rect[] = this.selectedWidgets.length > 1
      ? this.selectedWidgets.map(w => w.rect)
      : this.selection ? [this.selection] : [];

    // During group drag, offset all selection rects by the drag delta
    const d = this.groupDragDelta;
    if (d && selections.length > 1) {
      selections = selections.map(r => ({
        ...r,
        col: r.col + d.col,
        row: r.row + d.row,
      }));
    }

    // Compute bounding box around multi-selection
    let boundingBox: Rect | null = null;
    if (selections.length > 1) {
      const minCol = Math.min(...selections.map(r => r.col));
      const minRow = Math.min(...selections.map(r => r.row));
      const maxCol = Math.max(...selections.map(r => r.col + r.width));
      const maxRow = Math.max(...selections.map(r => r.row + r.height));
      boundingBox = { col: minCol, row: minRow, width: maxCol - minCol, height: maxRow - minRow };
    }

    this.renderer.render(
      selections,
      this.isResizable && !this.isEditing && this.selectedWidgets.length <= 1,
      this.selectedLineDirection,
      this.getEditCursor(),
      this.hoveredWidget?.rect ?? null,
      this.marquee,
      boundingBox,
    );
  }

  updateStatus(col: number, row: number): void {
    this.onStatusUpdate(
      `${col}, ${row}`,
      this.tool,
      this.currentFile ?? "-"
    );
  }

  // --- Hover ---

  onHover(px: number, py: number): void {
    if (this.tool !== "select" || this.dragStart) return;
    const { col, row } = this.renderer.pixelToGrid(px, py);
    const hit = widgetAt(this.widgets, col, row);
    if (hit !== this.hoveredWidget) {
      this.hoveredWidget = hit;
      this.redraw();
    }
  }

  clearHover(): void {
    if (this.hoveredWidget) {
      this.hoveredWidget = null;
      this.redraw();
    }
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
    this.isMovingGroup = false;
    this.isResizing = false;
    this.isBoxSelecting = false;
    this.marquee = null;
    this.groupDragDelta = null;
    this.resizeHandle = null;

    if (this.tool === "select") {
      // Check if clicking on a resize handle (single selection only)
      if (this.selection && this.selectedWidget && this.isResizable && this.selectedWidgets.length <= 1) {
        const handle = this.renderer.getHandleAt(px, py, this.selection, this.selectedLineDirection);
        if (handle) {
          this.isResizing = true;
          this.resizeHandle = handle;
          this.resizeAnchor = { ...this.selection };
          this.gridSnapshot = this.grid.clone();
          return;
        }
      }

      // Check if clicking inside a widget that's part of the multi-selection
      if (this.selectedWidgets.length > 1) {
        const hitInGroup = this.selectedWidgets.find(w => this.isInsideRect(col, row, w.rect));
        if (hitInGroup) {
          this.isMovingGroup = true;
          this.gridSnapshot = this.grid.clone();
          this.moveOffset = { col: col - this.dragStart.col, row: row - this.dragStart.row };
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
        this.selectedWidgets = [hit];
        this.isMoving = true;
        this.gridSnapshot = this.grid.clone();
        this.moveOffset = {
          col: col - hit.rect.col,
          row: row - hit.rect.row,
        };
      } else {
        // Click on empty space — start box select
        this.selection = null;
        this.selectedWidget = null;
        this.selectedWidgets = [];
        this.isBoxSelecting = true;
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
    } else if (this.tool === "select" && this.isMovingGroup && this.selectedWidgets.length > 1) {
      this.groupDragDelta = this.clampDelta(
        this.selectedWidgets.map(w => w.rect),
        col - this.dragStart.col,
        row - this.dragStart.row,
      );
      this.redraw();
    } else if (this.tool === "select" && this.isMoving && this.selectedWidget && this.selection) {
      // Update selection preview to show where widget will land (clamped to grid)
      const clamped = this.clampRect({
        ...this.selection,
        col: col - this.moveOffset.col,
        row: row - this.moveOffset.row,
      });
      this.selection = clamped;
      this.redraw();
    } else if (this.tool === "select" && this.isBoxSelecting && this.dragStart) {
      this.marquee = this.dragToRect(this.dragStart, { col, row });
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

    if (this.tool === "select" && this.isMovingGroup && this.selectedWidgets.length > 1 && this.dragStart) {
      const clamped = this.clampDelta(
        this.selectedWidgets.map(w => w.rect),
        col - this.dragStart.col,
        row - this.dragStart.row,
      );
      this.groupDragDelta = null;
      if (clamped.col !== 0 || clamped.row !== 0) {
        this.moveWidgets(this.selectedWidgets, clamped.col, clamped.row);
      }
      this.gridSnapshot = null;
      this.dragStart = null;
      this.isDragging = false;
      this.isMovingGroup = false;
      return;
    }

    if (this.tool === "select" && this.isMoving && this.selectedWidget) {
      const clamped = this.clampRect({
        ...this.selectedWidget.rect,
        col: col - this.moveOffset.col,
        row: row - this.moveOffset.row,
      });
      if (clamped.col !== this.selectedWidget.rect.col || clamped.row !== this.selectedWidget.rect.row) {
        this.moveWidget(this.selectedWidget, clamped.col, clamped.row);
      }
      this.gridSnapshot = null;
      this.dragStart = null;
      this.isDragging = false;
      this.isMoving = false;
      return;
    }

    if (this.tool === "select" && this.isBoxSelecting) {
      if (this.isDragging && this.dragStart) {
        const marqueeRect = this.dragToRect(this.dragStart, { col, row });
        const hits = this.widgetsOverlapping(this.widgets, marqueeRect);
        if (hits.length > 0) {
          this.selectedWidgets = hits;
          this.selectedWidget = hits[0];
          this.selection = hits.length === 1 ? { ...hits[0].rect } : null;
        } else {
          this.selectedWidgets = [];
          this.selectedWidget = null;
          this.selection = null;
        }
      } else {
        // Plain click on empty space — clear selection
        this.selectedWidgets = [];
        this.selectedWidget = null;
        this.selection = null;
      }
      this.marquee = null;
      this.isBoxSelecting = false;
      this.dragStart = null;
      this.isDragging = false;
      this.redraw();
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

    // Re-render overlapping widgets using snapshot data (not re-detected from
    // the partially-cleared grid, which can mis-detect interior content as labels)
    for (const w of snapshotWidgets) {
      if (this.rectsEqual(w.rect, oldRect) && w.type === widget.type) continue;
      if (children.includes(w)) continue;
      if (this.rectsOverlap(w.rect, oldRect)) {
        renderWidget(this.grid, w);
      }
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
    this.selectedWidgets = this.selectedWidget ? [this.selectedWidget] : [];
    this.selection = { ...moved.rect };
    this.gridSnapshot = null;
    this.redraw();
    this.save();
  }

  private moveWidgets(widgets: Widget[], deltaCol: number, deltaRow: number): void {
    if (!this.gridSnapshot) return;

    const snapshot = this.gridSnapshot;
    const snapshotWidgets = detectWidgets(snapshot);

    // Restore grid from snapshot
    for (let r = 0; r < this.grid.height; r++) {
      for (let c = 0; c < this.grid.width; c++) {
        this.grid.set(c, r, snapshot.get(c, r));
      }
    }

    // Collect all widgets to move (including children of boxes)
    const toMove: Widget[] = [];
    const toMoveSet = new Set<Widget>();
    for (const w of widgets) {
      if (toMoveSet.has(w)) continue;
      toMove.push(w);
      toMoveSet.add(w);
      if (w.type === "box") {
        for (const child of widgetsInside(snapshotWidgets, w.rect)) {
          if (!toMoveSet.has(child)) {
            toMove.push(child);
            toMoveSet.add(child);
          }
        }
      }
    }

    // Clear all original footprints and compute union of cleared area
    let clearMinCol = Infinity, clearMinRow = Infinity;
    let clearMaxCol = -Infinity, clearMaxRow = -Infinity;
    for (const w of toMove) {
      this.grid.clearRect(w.rect.col, w.rect.row, w.rect.width, w.rect.height);
      clearMinCol = Math.min(clearMinCol, w.rect.col);
      clearMinRow = Math.min(clearMinRow, w.rect.row);
      clearMaxCol = Math.max(clearMaxCol, w.rect.col + w.rect.width);
      clearMaxRow = Math.max(clearMaxRow, w.rect.row + w.rect.height);
    }
    const clearedArea: Rect = {
      col: clearMinCol, row: clearMinRow,
      width: clearMaxCol - clearMinCol, height: clearMaxRow - clearMinRow,
    };

    // Re-render overlapping widgets using snapshot data (not re-detected from
    // the partially-cleared grid, which can mis-detect interior content as labels)
    for (const w of snapshotWidgets) {
      if (toMove.some(m => this.rectsEqual(m.rect, w.rect) && m.type === w.type)) continue;
      if (this.rectsOverlap(w.rect, clearedArea)) {
        renderWidget(this.grid, w);
      }
    }

    // Render all moved widgets at new positions
    const movedWidgets: Widget[] = [];
    for (const w of toMove) {
      const moved: Widget = {
        ...w,
        rect: {
          ...w.rect,
          col: w.rect.col + deltaCol,
          row: w.rect.row + deltaRow,
        },
      } as Widget;
      renderWidget(this.grid, moved);
      movedWidgets.push(moved);
    }

    this.reparse();

    // Update selection to the moved top-level widgets (not children)
    this.selectedWidgets = [];
    for (let i = 0; i < widgets.length; i++) {
      const origRect = widgets[i].rect;
      const newCol = origRect.col + deltaCol;
      const newRow = origRect.row + deltaRow;
      const found = widgetAt(this.widgets, newCol, newRow);
      if (found) this.selectedWidgets.push(found);
    }
    this.selectedWidget = this.selectedWidgets[0] ?? null;
    this.selection = this.selectedWidgets.length === 1 ? { ...this.selectedWidgets[0].rect } : null;
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
        return this.clampRect({ col: newCol, row: anchor.row, width: newWidth, height: 1 });
      } else {
        return this.clampRect({ col: anchor.col, row: newRow, width: 1, height: newHeight });
      }
    }

    // Buttons are always 1 row tall, horizontal only
    if (widget?.type === "button") {
      return this.clampRect({ col: newCol, row: anchor.row, width: newWidth, height: 1 });
    }

    return this.clampRect({ col: newCol, row: newRow, width: newWidth, height: newHeight });
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

    // Re-render overlapping widgets using snapshot data (not re-detected from
    // the partially-cleared grid, which can mis-detect interior content as labels)
    const snapshotWidgets = detectWidgets(snapshot);
    for (const w of snapshotWidgets) {
      if (this.rectsEqual(w.rect, oldRect) && w.type === widget.type) continue;
      if (this.rectsOverlap(w.rect, oldRect)) {
        renderWidget(this.grid, w);
      }
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
    this.selectedWidgets = this.selectedWidget ? [this.selectedWidget] : [];
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
    this.selectedWidgets = this.selectedWidget ? [this.selectedWidget] : [];
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
    const toDelete = this.selectedWidgets.length > 0
      ? this.selectedWidgets
      : this.selectedWidget ? [this.selectedWidget] : [];
    if (toDelete.length === 0) return;

    // Save widget data before clearing so we re-render from correct state
    const preDeleteWidgets = [...this.widgets];

    let clearMinCol = Infinity, clearMinRow = Infinity;
    let clearMaxCol = -Infinity, clearMaxRow = -Infinity;
    for (const w of toDelete) {
      this.grid.clearRect(w.rect.col, w.rect.row, w.rect.width, w.rect.height);
      clearMinCol = Math.min(clearMinCol, w.rect.col);
      clearMinRow = Math.min(clearMinRow, w.rect.row);
      clearMaxCol = Math.max(clearMaxCol, w.rect.col + w.rect.width);
      clearMaxRow = Math.max(clearMaxRow, w.rect.row + w.rect.height);
    }
    const clearedArea: Rect = {
      col: clearMinCol, row: clearMinRow,
      width: clearMaxCol - clearMinCol, height: clearMaxRow - clearMinRow,
    };
    // Re-render overlapping widgets using pre-delete data
    for (const w of preDeleteWidgets) {
      if (toDelete.includes(w)) continue;
      if (this.rectsOverlap(w.rect, clearedArea)) {
        renderWidget(this.grid, w);
      }
    }
    this.selection = null;
    this.selectedWidget = null;
    this.selectedWidgets = [];
    this.reparse();
    this.redraw();
    this.save();
  }

  clearAll(): void {
    this.grid.clearRect(0, 0, this.grid.width, this.grid.height);
    this.widgets = [];
    this.selection = null;
    this.selectedWidget = null;
    this.selectedWidgets = [];
    this.redraw();
    this.save();
  }

  // --- Nudge & directional selection ---

  nudgeSelected(direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
    const delta = { col: 0, row: 0 };
    if (direction === "ArrowUp") delta.row = -1;
    else if (direction === "ArrowDown") delta.row = 1;
    else if (direction === "ArrowLeft") delta.col = -1;
    else if (direction === "ArrowRight") delta.col = 1;

    if (this.selectedWidgets.length > 1) {
      const clampedDelta = this.clampDelta(this.selectedWidgets.map(w => w.rect), delta.col, delta.row);
      if (clampedDelta.col === 0 && clampedDelta.row === 0) return;
      this.gridSnapshot = this.grid.clone();
      this.moveWidgets(this.selectedWidgets, clampedDelta.col, clampedDelta.row);
      return;
    }

    if (!this.selectedWidget) return;
    const clamped = this.clampRect({
      ...this.selectedWidget.rect,
      col: this.selectedWidget.rect.col + delta.col,
      row: this.selectedWidget.rect.row + delta.row,
    });
    if (clamped.col === this.selectedWidget.rect.col && clamped.row === this.selectedWidget.rect.row) return;
    this.gridSnapshot = this.grid.clone();
    this.moveWidget(this.selectedWidget, clamped.col, clamped.row);
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
    this.selectedWidgets = [];
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

    // Only allow editing empty boxes (no child widgets inside)
    if (w.type === "box" && !isNew) {
      const children = widgetsInside(this.widgets, w.rect);
      if (children.length > 0) return;
    }

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
    if (this.selection && this.selectedWidget && this.isResizable && this.selectedWidgets.length <= 1) {
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
    const { col, row } = this.renderer.pixelToGrid(px, py);
    // Multi-selection: show move cursor over any selected widget
    if (this.selectedWidgets.length > 1) {
      if (this.selectedWidgets.some(w => this.isInsideRect(col, row, w.rect))) {
        return "move";
      }
    }
    if (this.selection) {
      if (this.isInsideRect(col, row, this.selection)) {
        return "move";
      }
    }
    return "default";
  }

  // --- Helpers ---

  /** Clamp a rect so it stays fully within the grid bounds. */
  private clampRect(rect: Rect): Rect {
    const col = Math.max(0, Math.min(rect.col, this.grid.width - rect.width));
    const row = Math.max(0, Math.min(rect.row, this.grid.height - rect.height));
    return { col, row, width: rect.width, height: rect.height };
  }

  /** Clamp a delta so that all rects stay within bounds after applying it. */
  private clampDelta(rects: Rect[], deltaCol: number, deltaRow: number): { col: number; row: number } {
    let minCol = deltaCol, minRow = deltaRow;
    let maxCol = deltaCol, maxRow = deltaRow;
    for (const r of rects) {
      // How far left/up can we go?
      minCol = Math.max(minCol, -r.col);
      minRow = Math.max(minRow, -r.row);
      // How far right/down can we go?
      maxCol = Math.min(maxCol, this.grid.width - r.width - r.col);
      maxRow = Math.min(maxRow, this.grid.height - r.height - r.row);
    }
    return {
      col: Math.max(minCol, Math.min(deltaCol, maxCol)),
      row: Math.max(minRow, Math.min(deltaRow, maxRow)),
    };
  }

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

  private rectsEqual(a: Rect, b: Rect): boolean {
    return a.col === b.col && a.row === b.row && a.width === b.width && a.height === b.height;
  }

  private rectsOverlap(a: Rect, b: Rect): boolean {
    return (
      a.col < b.col + b.width &&
      a.col + a.width > b.col &&
      a.row < b.row + b.height &&
      a.row + a.height > b.row
    );
  }

  private widgetsOverlapping(widgets: Widget[], rect: Rect): Widget[] {
    return widgets.filter((w) => this.rectsOverlap(w.rect, rect));
  }
}
