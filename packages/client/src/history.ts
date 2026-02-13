/**
 * History — undo/redo stack for grid state strings.
 */

const MAX_STACK_SIZE = 100;

export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSavedState: string | null = null;

  push(state: string): void {
    if (state === this.lastSavedState) return;
    this.undoStack.push(this.lastSavedState ?? state);
    this.redoStack = [];
    this.lastSavedState = state;
    if (this.undoStack.length > MAX_STACK_SIZE) this.undoStack.shift();
  }

  undo(): string | null {
    if (this.undoStack.length === 0) return null;
    const current = this.lastSavedState;
    if (current !== null) this.redoStack.push(current);
    const prev = this.undoStack.pop()!;
    this.lastSavedState = prev;
    return prev;
  }

  redo(): string | null {
    if (this.redoStack.length === 0) return null;
    const current = this.lastSavedState;
    if (current !== null) this.undoStack.push(current);
    const next = this.redoStack.pop()!;
    this.lastSavedState = next;
    return next;
  }

  reset(state: string): void {
    this.lastSavedState = state;
    this.undoStack = [];
    this.redoStack = [];
  }
}
