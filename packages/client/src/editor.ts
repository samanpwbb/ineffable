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
import { History } from "./history.js";
import { EditSession } from "./editSession.js";

export type Tool = "select" | WidgetType;

type GridPos = { col: number; row: number };

type Interaction =
  | { type: "idle" }
  | { type: "pending"; start: GridPos }
  | { type: "moving"; start: GridPos; widget: Widget; offset: GridPos; snapshot: Grid; preview: Rect }
  | { type: "movingGroup"; start: GridPos; snapshot: Grid; delta: GridPos }
  | { type: "resizing"; start: GridPos; widget: Widget; handle: HandleCorner; anchor: Rect; snapshot: Grid; preview: Rect }
  | { type: "boxSelecting"; start: GridPos; marquee: Rect | null }
  | { type: "drawing"; start: GridPos; preview: Rect | null };

export class Editor {
  grid: Grid;
  tool: Tool = "select";
  widgets: Widget[] = [];
  autoRepair = true;
  currentFile: string | null = null;

  // Selection state
  selectedWidgets: Widget[] = [];

  get selectedWidget(): Widget | null { return this.selectedWidgets[0] ?? null; }

  // Interaction state (drag/resize/box-select/draw)
  private interaction: Interaction = { type: "idle" };

  /** The rect to display for single selection: preview rect during interaction, otherwise widget rect. */
  private get selectionRect(): Rect | null {
    const ix = this.interaction;
    if (ix.type === "moving" || ix.type === "resizing") return ix.preview;
    if (ix.type === "drawing") return ix.preview;
    return this.selectedWidget?.rect ?? null;
  }

  // Inline editing state
  private editSession: EditSession | null = null;
  private onRedrawCallback: (() => void) | null = null;

  get isEditing(): boolean { return this.editSession !== null; }
  get editCursorVisible(): boolean { return this.editSession?.cursorVisible ?? false; }

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
    if (this.autoRepair) {
      const result = detectWidgets(this.grid, { repair: true });
      this.widgets = result.widgets;
      if (result.repairs.length > 0) {
        this.grid = result.grid;
        this.renderer.setGrid(this.grid);
      }
    } else {
      this.widgets = detectWidgets(this.grid);
    }
    this.hoveredWidget = null;
  }

  setTool(tool: Tool): void {
    if (this.isEditing) this.stopEditing();
    this.tool = tool;
    this.selectedWidgets = [];
    this.interaction = { type: "idle" };
    this.updateStatus(0, 0);
    this.redraw();
  }

  setGrid(grid: Grid, resetHistory = true): void {
    if (this.isEditing) this.stopEditing();
    const prevSelected = this.selectedWidgets;
    this.grid = grid;
    this.renderer.setGrid(grid);
    this.renderer.resize();
    this.reparse();
    // Preserve selection across reloads by matching widget rects
    if (!resetHistory && prevSelected.length > 0) {
      this.selectedWidgets = prevSelected
        .map(prev => this.widgets.find(w => this.rectsEqual(w.rect, prev.rect) && w.type === prev.type) ?? null)
        .filter((w): w is Widget => w !== null);
    } else {
      this.selectedWidgets = [];
    }
    this.interaction = { type: "idle" };
    if (resetHistory) {
      this.history.reset(grid.toString());
    }
    this.redraw();
  }

  private get isResizable(): boolean {
    const t = this.selectedWidget?.type;
    return t === "box" || t === "line" || t === "button";
  }

  private get selectedLineDirection(): "horizontal" | "vertical" | undefined {
    const w = this.selectedWidget;
    if (w?.type === "line") return w.direction;
    if (w?.type === "button") return "horizontal";
    return undefined;
  }

  private static widgetResizable(w: Widget): boolean {
    return w.type === "box" || w.type === "line" || w.type === "button";
  }

  private static widgetLineDirection(w: Widget): "horizontal" | "vertical" | undefined {
    if (w.type === "line") return w.direction;
    if (w.type === "button") return "horizontal";
    return undefined;
  }

  redraw(): void {
    const ix = this.interaction;

    let selections: Rect[];
    if (this.selectedWidgets.length > 1) {
      selections = this.selectedWidgets.map(w => w.rect);
    } else {
      const rect = this.selectionRect;
      selections = rect ? [rect] : [];
    }

    // During group drag, offset all selection rects by the drag delta
    if (ix.type === "movingGroup" && selections.length > 1) {
      const d = ix.delta;
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

    const marquee = ix.type === "boxSelecting" ? ix.marquee : null;

    // Determine if hover handles should be shown
    const hovered = this.hoveredWidget;
    let hoverHandles: { lineDirection?: "horizontal" | "vertical" } | null = null;
    if (hovered && Editor.widgetResizable(hovered)) {
      const isSelected = selections.some(
        s => s.col === hovered.rect.col && s.row === hovered.rect.row &&
             s.width === hovered.rect.width && s.height === hovered.rect.height
      );
      if (!isSelected) {
        hoverHandles = { lineDirection: Editor.widgetLineDirection(hovered) };
      }
    }

    this.renderer.render(
      selections,
      this.isResizable && !this.isEditing && this.selectedWidgets.length <= 1,
      this.selectedLineDirection,
      this.getEditCursor(),
      this.hoveredWidget?.rect ?? null,
      marquee,
      boundingBox,
      hoverHandles,
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
    if (this.tool !== "select" || this.interaction.type !== "idle") return;
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

  onMouseDown(px: number, py: number, shiftKey = false): void {
    if (this.isEditing) {
      this.stopEditing();
    }

    const { col, row } = this.renderer.pixelToGrid(px, py);
    const start = { col, row };

    // Double-click detection
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
      if (t === "button" || t === "text") {
        this.startEditing(false);
        return;
      }
    }

    if (this.tool === "select") {
      const selRect = this.selectionRect;

      // Check resize handle (single selection only)
      if (selRect && this.selectedWidget && this.isResizable && this.selectedWidgets.length <= 1) {
        const handle = this.renderer.getHandleAt(px, py, selRect, this.selectedLineDirection);
        if (handle) {
          this.interaction = {
            type: "resizing", start, widget: this.selectedWidget,
            handle, anchor: { ...selRect }, snapshot: this.grid.clone(),
            preview: { ...selRect },
          };
          return;
        }
      }

      // Check click inside multi-selection group
      if (this.selectedWidgets.length > 1) {
        const hitInGroup = this.selectedWidgets.find(w => this.isInsideRect(col, row, w.rect));
        if (hitInGroup) {
          if (shiftKey) {
            // Shift+click on selected widget — deselect it
            this.selectedWidgets = this.selectedWidgets.filter(w => w !== hitInGroup);
            this.redraw();
            return;
          }
          this.interaction = {
            type: "movingGroup", start, snapshot: this.grid.clone(),
            delta: { col: 0, row: 0 },
          };
          return;
        }
      }

      // Check click inside current selection (start move)
      if (selRect && this.selectedWidget && this.isInsideRect(col, row, selRect)) {
        if (shiftKey) {
          // Shift+click on the single selected widget — deselect it
          this.selectedWidgets = [];
          this.redraw();
          return;
        }
        this.interaction = {
          type: "moving", start, widget: this.selectedWidget,
          offset: { col: col - selRect.col, row: row - selRect.row },
          snapshot: this.grid.clone(), preview: { ...selRect },
        };
        return;
      }

      // Check resize handle on hovered (non-selected) widget
      if (this.hoveredWidget && Editor.widgetResizable(this.hoveredWidget)) {
        const hoverLineDir = Editor.widgetLineDirection(this.hoveredWidget);
        const hoverHandle = this.renderer.getHandleAt(px, py, this.hoveredWidget.rect, hoverLineDir);
        if (hoverHandle) {
          this.selectedWidgets = [this.hoveredWidget];
          this.interaction = {
            type: "resizing", start, widget: this.hoveredWidget,
            handle: hoverHandle, anchor: { ...this.hoveredWidget.rect }, snapshot: this.grid.clone(),
            preview: { ...this.hoveredWidget.rect },
          };
          return;
        }
      }

      // Click on a widget — select + prepare move
      const hit = widgetAt(this.widgets, col, row);
      if (hit) {
        if (shiftKey) {
          // Shift+click — add to selection
          this.selectedWidgets = [...this.selectedWidgets, hit];
          this.redraw();
        } else {
          this.selectedWidgets = [hit];
          this.interaction = {
            type: "moving", start, widget: hit,
            offset: { col: col - hit.rect.col, row: row - hit.rect.row },
            snapshot: this.grid.clone(), preview: { ...hit.rect },
          };
        }
      } else {
        // Empty space — start box select
        if (!shiftKey) {
          this.selectedWidgets = [];
        }
        this.interaction = { type: "boxSelecting", start, marquee: null };
      }
      this.redraw();
    } else {
      // Drawing tool — start with pending (need drag to create preview)
      this.interaction = { type: "drawing", start, preview: null };
    }
  }

  onMouseMove(px: number, py: number): void {
    const { col, row } = this.renderer.pixelToGrid(px, py);
    this.updateStatus(col, row);

    const ix = this.interaction;
    if (ix.type === "idle") return;

    switch (ix.type) {
      case "resizing": {
        ix.preview = this.computeResizedRect(ix.anchor, ix.handle, col, row);
        this.redraw();
        break;
      }
      case "movingGroup": {
        ix.delta = this.clampDelta(
          this.selectedWidgets.map(w => w.rect),
          col - ix.start.col,
          row - ix.start.row,
        );
        this.redraw();
        break;
      }
      case "moving": {
        ix.preview = this.clampRect({
          ...ix.widget.rect,
          col: col - ix.offset.col,
          row: row - ix.offset.row,
        });
        this.redraw();
        break;
      }
      case "boxSelecting": {
        ix.marquee = this.dragToRect(ix.start, { col, row });
        this.redraw();
        break;
      }
      case "drawing": {
        if (this.tool === "box" || this.tool === "line") {
          ix.preview = this.dragToRect(ix.start, { col, row });
        } else if (this.tool === "button") {
          const startCol = Math.min(ix.start.col, col);
          const width = Math.max(5, Math.abs(col - ix.start.col) + 1);
          ix.preview = { col: startCol, row: ix.start.row, width, height: 1 };
        }
        this.redraw();
        break;
      }
    }
  }

  onMouseUp(px: number, py: number): void {
    const { col, row } = this.renderer.pixelToGrid(px, py);
    const ix = this.interaction;

    switch (ix.type) {
      case "resizing": {
        const newRect = this.computeResizedRect(ix.anchor, ix.handle, col, row);
        this.interaction = { type: "idle" };
        this.resizeWidget(ix.widget, newRect, ix.snapshot);
        return;
      }
      case "movingGroup": {
        const clamped = this.clampDelta(
          this.selectedWidgets.map(w => w.rect),
          col - ix.start.col,
          row - ix.start.row,
        );
        this.interaction = { type: "idle" };
        if (clamped.col !== 0 || clamped.row !== 0) {
          this.moveWidgets(this.selectedWidgets, clamped.col, clamped.row, ix.snapshot);
        } else {
          this.redraw();
        }
        return;
      }
      case "moving": {
        const clamped = this.clampRect({
          ...ix.widget.rect,
          col: col - ix.offset.col,
          row: row - ix.offset.row,
        });
        this.interaction = { type: "idle" };
        if (clamped.col !== ix.widget.rect.col || clamped.row !== ix.widget.rect.row) {
          this.moveWidget(ix.widget, clamped.col, clamped.row, ix.snapshot);
        } else {
          this.redraw();
        }
        return;
      }
      case "boxSelecting": {
        const hasDragged = ix.marquee !== null;
        if (hasDragged) {
          const marqueeRect = this.dragToRect(ix.start, { col, row });
          this.selectedWidgets = this.widgetsOverlapping(this.widgets, marqueeRect);
        } else {
          this.selectedWidgets = [];
        }
        this.interaction = { type: "idle" };
        this.redraw();
        return;
      }
      case "drawing": {
        const hasDragged = ix.preview !== null;
        this.interaction = { type: "idle" };

        if (this.tool === "box") {
          const rect = this.dragToRect(ix.start, { col, row });
          if (rect.width >= 3 && rect.height >= 3) {
            this.placeWidget({ type: "box", rect });
            this.tool = "select";
          }
        } else if (this.tool === "line") {
          const dx = Math.abs(col - ix.start.col);
          const dy = Math.abs(row - ix.start.row);
          if (dx >= 2 || dy >= 2) {
            if (dx >= dy) {
              const startCol = Math.min(col, ix.start.col);
              this.placeWidget({
                type: "line", direction: "horizontal",
                rect: { col: startCol, row: ix.start.row, width: dx + 1, height: 1 },
              });
            } else {
              const startRow = Math.min(row, ix.start.row);
              this.placeWidget({
                type: "line", direction: "vertical",
                rect: { col: ix.start.col, row: startRow, width: 1, height: dy + 1 },
              });
            }
            this.tool = "select";
          }
        } else if (this.tool === "button") {
          let width = 5;
          if (hasDragged) {
            width = Math.max(5, Math.abs(col - ix.start.col) + 1);
          }
          const startCol = hasDragged ? Math.min(col, ix.start.col) : col;
          const btnRow = hasDragged ? ix.start.row : row;
          this.placeWidget({
            type: "button", label: "",
            rect: { col: startCol, row: btnRow, width, height: 1 },
          }, true);
          this.tool = "select";
          this.startEditing(true);
        } else if (this.tool === "text" && !hasDragged) {
          this.placeWidget({
            type: "text", content: "",
            rect: { col, row, width: 1, height: 1 },
          }, true);
          this.tool = "select";
          this.startEditing(true);
        }
        return;
      }
    }

    this.interaction = { type: "idle" };
  }

  // --- Widget movement ---

  private moveWidget(widget: Widget, newCol: number, newRow: number, snapshot: Grid): void {
    const snapshotWidgets = detectWidgets(snapshot);

    // Restore grid to pre-move state
    for (let r = 0; r < this.grid.height; r++) {
      for (let c = 0; c < this.grid.width; c++) {
        this.grid.set(c, r, snapshot.get(c, r));
      }
    }

    // Clear the widget's original footprint
    const oldRect = widget.rect;
    this.grid.clearRect(oldRect.col, oldRect.row, oldRect.width, oldRect.height);

    // Re-render overlapping widgets using snapshot data
    for (const w of snapshotWidgets) {
      if (this.rectsEqual(w.rect, oldRect) && w.type === widget.type) continue;
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

    this.reparse();
    const found = widgetAt(this.widgets, newCol, newRow) ?? moved;
    this.selectedWidgets = [found];
    this.redraw();
    this.save();
  }

  private moveWidgets(widgets: Widget[], deltaCol: number, deltaRow: number, snapshot: Grid): void {
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

    // Re-render overlapping widgets using snapshot data
    for (const w of snapshotWidgets) {
      if (toMove.some(m => this.rectsEqual(m.rect, w.rect) && m.type === w.type)) continue;
      if (this.rectsOverlap(w.rect, clearedArea)) {
        renderWidget(this.grid, w);
      }
    }

    // Render all moved widgets at new positions
    for (const w of toMove) {
      const moved: Widget = {
        ...w,
        rect: { ...w.rect, col: w.rect.col + deltaCol, row: w.rect.row + deltaRow },
      } as Widget;
      renderWidget(this.grid, moved);
    }

    this.reparse();

    // Update selection to the moved top-level widgets (not children)
    this.selectedWidgets = [];
    for (let i = 0; i < widgets.length; i++) {
      const origRect = widgets[i].rect;
      const found = widgetAt(this.widgets, origRect.col + deltaCol, origRect.row + deltaRow);
      if (found) this.selectedWidgets.push(found);
    }
    this.redraw();
    this.save();
  }

  // --- Widget resizing ---

  private computeResizedRect(anchor: Rect, handle: HandleCorner, col: number, row: number): Rect {
    const widget = this.selectedWidget;
    let minW = widget?.type === "box" ? 3 : 2;
    const minH = widget?.type === "box" ? 3 : 2;

    if (widget?.type === "button") {
      minW = Math.max(5, widget.label.length + 4);
    }

    let fixedCol: number, fixedRow: number;
    let dragCol: number, dragRow: number;

    switch (handle) {
      case "nw":
        fixedCol = anchor.col + anchor.width - 1;
        fixedRow = anchor.row + anchor.height - 1;
        dragCol = col; dragRow = row;
        break;
      case "ne":
        fixedCol = anchor.col;
        fixedRow = anchor.row + anchor.height - 1;
        dragCol = col; dragRow = row;
        break;
      case "sw":
        fixedCol = anchor.col + anchor.width - 1;
        fixedRow = anchor.row;
        dragCol = col; dragRow = row;
        break;
      case "se":
        fixedCol = anchor.col;
        fixedRow = anchor.row;
        dragCol = col; dragRow = row;
        break;
    }

    if (widget?.type === "line") {
      if (widget.direction === "horizontal") { dragRow = anchor.row; }
      else { dragCol = anchor.col; }
    } else if (widget?.type === "button") {
      dragRow = anchor.row;
    }

    const newCol = Math.min(fixedCol, dragCol);
    const newRow = Math.min(fixedRow, dragRow);
    const newWidth = Math.max(minW, Math.abs(dragCol - fixedCol) + 1);
    const newHeight = Math.max(minH, Math.abs(dragRow - fixedRow) + 1);

    if (widget?.type === "line") {
      if (widget.direction === "horizontal") {
        return this.clampRect({ col: newCol, row: anchor.row, width: newWidth, height: 1 });
      } else {
        return this.clampRect({ col: anchor.col, row: newRow, width: 1, height: newHeight });
      }
    }

    if (widget?.type === "button") {
      return this.clampRect({ col: newCol, row: anchor.row, width: newWidth, height: 1 });
    }

    return this.clampRect({ col: newCol, row: newRow, width: newWidth, height: newHeight });
  }

  private resizeWidget(widget: Widget, newRect: Rect, snapshot: Grid): void {
    // Restore grid from snapshot
    for (let r = 0; r < this.grid.height; r++) {
      for (let c = 0; c < this.grid.width; c++) {
        this.grid.set(c, r, snapshot.get(c, r));
      }
    }

    const oldRect = widget.rect;
    this.grid.clearRect(oldRect.col, oldRect.row, oldRect.width, oldRect.height);

    const snapshotWidgets = detectWidgets(snapshot);
    for (const w of snapshotWidgets) {
      if (this.rectsEqual(w.rect, oldRect) && w.type === widget.type) continue;
      if (this.rectsOverlap(w.rect, oldRect)) {
        renderWidget(this.grid, w);
      }
    }

    let resized: Widget;
    if (widget.type === "line") {
      resized = {
        ...widget, rect: newRect,
        direction: newRect.width > newRect.height ? "horizontal" : "vertical",
      };
    } else {
      resized = { ...widget, rect: newRect } as Widget;
    }
    renderWidget(this.grid, resized);

    if (widget.type === "box") {
      const children = widgetsInside(snapshotWidgets, oldRect);
      for (const child of children) {
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
    const found = widgetAt(this.widgets, newRect.col, newRect.row) ?? resized;
    this.selectedWidgets = [found];
    this.redraw();
    this.save();
  }

  // --- Widget placement ---

  private placeWidget(widget: Widget, skipSave = false): void {
    renderWidget(this.grid, widget);
    this.reparse();
    const found = widgetAt(this.widgets, widget.rect.col, widget.rect.row) ?? widget;
    this.selectedWidgets = [found];
    this.redraw();
    if (!skipSave) this.save();
  }

  async save(): Promise<void> {
    if (!this.currentFile) return;
    this.history.push(this.grid.toString());
    try {
      await writeFile(this.currentFile, this.grid.toString());
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }

  // --- Widget deletion ---

  deleteSelected(): void {
    if (this.selectedWidgets.length === 0) return;
    const toDelete = this.selectedWidgets;

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
    for (const w of preDeleteWidgets) {
      if (toDelete.includes(w)) continue;
      if (this.rectsOverlap(w.rect, clearedArea)) {
        renderWidget(this.grid, w);
      }
    }
    this.selectedWidgets = [];
    this.reparse();
    this.redraw();
    this.save();
  }

  clearAll(): void {
    this.grid.clearRect(0, 0, this.grid.width, this.grid.height);
    this.widgets = [];
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
      this.moveWidgets(this.selectedWidgets, clampedDelta.col, clampedDelta.row, this.grid.clone());
      return;
    }

    if (!this.selectedWidget) return;
    const clamped = this.clampRect({
      ...this.selectedWidget.rect,
      col: this.selectedWidget.rect.col + delta.col,
      row: this.selectedWidget.rect.row + delta.row,
    });
    if (clamped.col === this.selectedWidget.rect.col && clamped.row === this.selectedWidget.rect.row) return;
    this.moveWidget(this.selectedWidget, clamped.col, clamped.row, this.grid.clone());
  }

  selectInDirection(direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
    if (this.widgets.length === 0) return;

    if (!this.selectedWidget) {
      this.selectedWidgets = [this.widgets[0]];
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

      let inDirection = false;
      if (direction === "ArrowUp" && dy < 0) inDirection = true;
      else if (direction === "ArrowDown" && dy > 0) inDirection = true;
      else if (direction === "ArrowLeft" && dx < 0) inDirection = true;
      else if (direction === "ArrowRight" && dx > 0) inDirection = true;

      if (!inDirection) continue;

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
      this.selectedWidgets = [best];
      this.redraw();
    }
  }

  // --- Undo / Redo ---

  private history = new History();

  undo(): void {
    const prev = this.history.undo();
    if (prev) this.applyState(prev);
  }

  redo(): void {
    const next = this.history.redo();
    if (next) this.applyState(next);
  }

  private applyState(state: string): void {
    const grid = Grid.fromString(state, this.grid.width, this.grid.height);
    this.grid = grid;
    this.renderer.setGrid(grid);
    this.reparse();
    this.selectedWidgets = [];
    this.redraw();
    if (this.currentFile) {
      writeFile(this.currentFile, state).catch((e) =>
        console.error("Failed to save:", e)
      );
    }
  }

  // --- Inline editing ---

  setRedrawCallback(cb: () => void): void {
    this.onRedrawCallback = cb;
  }

  startEditing(isNew: boolean): void {
    if (!this.selectedWidget) return;
    const w = this.selectedWidget;
    if (w.type !== "button" && w.type !== "text") return;

    this.editSession = new EditSession(w, isNew, () => {
      this.redraw();
      this.onRedrawCallback?.();
    });

    this.redraw();
  }

  stopEditing(): void {
    const session = this.editSession;
    if (!session) return;

    session.dispose();
    this.editSession = null;
    this.reparse();
    this.redraw();
    this.save();
  }

  onKeyDown(e: KeyboardEvent): void {
    const session = this.editSession;
    if (!session || !this.selectedWidget) return;

    const action = session.handleKey(e);
    switch (action) {
      case "commit":
        this.stopEditing();
        break;
      case "cancel":
        this.stopEditing();
        break;
      case "update":
        this.updateEditWidget();
        break;
      case "cursor":
        this.redraw();
        break;
    }
  }

  getEditCursor(): { col: number; row: number; visible: boolean } | null {
    if (!this.editSession || !this.selectedWidget) return null;
    return this.editSession.getCursor(this.selectedWidget);
  }

  private updateEditWidget(): void {
    const session = this.editSession;
    if (!session || !this.selectedWidget) return;
    const w = this.selectedWidget;

    this.grid.clearRect(w.rect.col, w.rect.row, w.rect.width, w.rect.height);

    if (w.type === "button") {
      const neededWidth = Math.max(5, session.buffer.length + 4);
      if (neededWidth <= w.rect.width) {
        const updated: Widget = { type: "button", label: session.buffer, rect: w.rect };
        renderWidget(this.grid, updated);
        this.selectedWidgets = [updated];
      } else {
        const grow = neededWidth - w.rect.width;
        const growLeft = Math.min(Math.floor(grow / 2), w.rect.col);
        const growRight = grow - growLeft;
        const newRect = {
          ...w.rect,
          col: w.rect.col - growLeft,
          width: w.rect.width + growLeft + growRight,
        };
        const updated: Widget = { type: "button", label: session.buffer, rect: newRect };
        renderWidget(this.grid, updated);
        this.selectedWidgets = [updated];
      }
    } else if (w.type === "text") {
      const newWidth = Math.max(1, session.buffer.length);
      const newRect = { ...w.rect, width: newWidth };
      const updated: Widget = { type: "text", content: session.buffer, rect: newRect };
      renderWidget(this.grid, updated);
      this.selectedWidgets = [updated];
    }

    session.resetBlink();
    this.redraw();
  }

  // --- Cursor ---

  getCursor(px: number, py: number): string {
    if (this.tool !== "select") return "crosshair";
    const selRect = this.selectionRect;
    if (selRect && this.selectedWidget && this.isResizable && this.selectedWidgets.length <= 1) {
      const handle = this.renderer.getHandleAt(px, py, selRect, this.selectedLineDirection);
      if (handle) {
        if (this.selectedLineDirection === "horizontal") return "ew-resize";
        if (this.selectedLineDirection === "vertical") return "ns-resize";
        const cursors: Record<string, string> = {
          nw: "nwse-resize", se: "nwse-resize",
          ne: "nesw-resize", sw: "nesw-resize",
        };
        return cursors[handle];
      }
    }
    // Check resize handles on hovered (non-selected) widget
    if (this.hoveredWidget && Editor.widgetResizable(this.hoveredWidget)) {
      const hoverLineDir = Editor.widgetLineDirection(this.hoveredWidget);
      const hoverHandle = this.renderer.getHandleAt(px, py, this.hoveredWidget.rect, hoverLineDir);
      if (hoverHandle) {
        if (hoverLineDir === "horizontal") return "ew-resize";
        if (hoverLineDir === "vertical") return "ns-resize";
        const cursors: Record<string, string> = {
          nw: "nwse-resize", se: "nwse-resize",
          ne: "nesw-resize", sw: "nesw-resize",
        };
        return cursors[hoverHandle];
      }
    }

    const { col, row } = this.renderer.pixelToGrid(px, py);
    if (this.selectedWidgets.length > 1) {
      if (this.selectedWidgets.some(w => this.isInsideRect(col, row, w.rect))) {
        return "move";
      }
    }
    if (selRect) {
      if (this.isInsideRect(col, row, selRect)) {
        return "move";
      }
    }
    return "default";
  }

  // --- Helpers ---

  private clampRect(rect: Rect): Rect {
    const col = Math.max(0, Math.min(rect.col, this.grid.width - rect.width));
    const row = Math.max(0, Math.min(rect.row, this.grid.height - rect.height));
    return { col, row, width: rect.width, height: rect.height };
  }

  private clampDelta(rects: Rect[], deltaCol: number, deltaRow: number): { col: number; row: number } {
    let minCol = deltaCol, minRow = deltaRow;
    let maxCol = deltaCol, maxRow = deltaRow;
    for (const r of rects) {
      minCol = Math.max(minCol, -r.col);
      minRow = Math.max(minRow, -r.row);
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

  private dragToRect(start: GridPos, end: GridPos): Rect {
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
