/**
 * EditSession — manages inline text editing state (buffer, cursor, blink).
 */

import { Widget } from "@ineffable/core";

const BLINK_INTERVAL = 530;

export type EditAction = "commit" | "cancel" | "update" | "cursor";

export class EditSession {
  buffer: string;
  cursorPos: number;
  cursorVisible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    widget: Widget,
    isNew: boolean,
    private onBlink: () => void,
  ) {
    if (isNew) {
      this.buffer = "";
    } else if (widget.type === "button") {
      this.buffer = widget.label;
    } else if (widget.type === "text") {
      this.buffer = widget.content;
    } else {
      this.buffer = "";
    }

    this.cursorPos = this.buffer.length;
    this.startBlink();
  }

  handleKey(e: KeyboardEvent): EditAction {
    if (e.key === "Enter") {
      e.preventDefault();
      return "commit";
    }
    if (e.key === "Escape") {
      e.preventDefault();
      return "cancel";
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (this.cursorPos > 0) {
        this.buffer =
          this.buffer.slice(0, this.cursorPos - 1) +
          this.buffer.slice(this.cursorPos);
        this.cursorPos--;
        return "update";
      }
      return "cursor";
    }
    if (e.key === "Delete") {
      e.preventDefault();
      if (this.cursorPos < this.buffer.length) {
        this.buffer =
          this.buffer.slice(0, this.cursorPos) +
          this.buffer.slice(this.cursorPos + 1);
        return "update";
      }
      return "cursor";
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.resetBlink();
      }
      return "cursor";
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (this.cursorPos < this.buffer.length) {
        this.cursorPos++;
        this.resetBlink();
      }
      return "cursor";
    }

    // Printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.buffer =
        this.buffer.slice(0, this.cursorPos) +
        e.key +
        this.buffer.slice(this.cursorPos);
      this.cursorPos++;
      return "update";
    }

    return "cursor";
  }

  getCursor(widget: Widget): { col: number; row: number; visible: boolean } | null {
    let row = widget.rect.row;
    let col: number;
    if (widget.type === "button") {
      const innerWidth = widget.rect.width - 4;
      const padLeft = Math.floor((innerWidth - this.buffer.length) / 2);
      col = widget.rect.col + 2 + padLeft + this.cursorPos;
    } else {
      col = widget.rect.col + this.cursorPos;
    }
    return { col, row, visible: this.cursorVisible };
  }

  resetBlink(): void {
    this.cursorVisible = true;
    if (this.blinkTimer !== null) {
      clearInterval(this.blinkTimer);
    }
    this.startBlink();
  }

  dispose(): void {
    if (this.blinkTimer !== null) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.cursorVisible = false;
  }

  private startBlink(): void {
    this.blinkTimer = setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      this.onBlink();
    }, BLINK_INTERVAL);
  }
}
