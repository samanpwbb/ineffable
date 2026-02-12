/**
 * 2D character grid — the fundamental data structure.
 * A diagram is a Grid. All reads/writes go through here.
 */

export const DEFAULT_WIDTH = 120;
export const DEFAULT_HEIGHT = 40;

export class Grid {
  readonly width: number;
  readonly height: number;
  private cells: string[];
  /** Comment lines (starting with #) stripped during parsing, preserved on save. */
  comments: string[] = [];

  constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(" ");
  }

  /** Get the character at (col, row). Returns " " if out of bounds. */
  get(col: number, row: number): string {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return " ";
    return this.cells[row * this.width + col];
  }

  /** Set the character at (col, row). No-op if out of bounds. */
  set(col: number, row: number, char: string): void {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return;
    this.cells[row * this.width + col] = char.charAt(0) || " ";
  }

  /** Write a string horizontally starting at (col, row). */
  writeString(col: number, row: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.set(col + i, row, str[i]);
    }
  }

  /** Fill a rectangular region with a character. */
  fillRect(col: number, row: number, width: number, height: number, char: string): void {
    for (let r = row; r < row + height; r++) {
      for (let c = col; c < col + width; c++) {
        this.set(c, r, char);
      }
    }
  }

  /** Clear a rectangular region (fill with spaces). */
  clearRect(col: number, row: number, width: number, height: number): void {
    this.fillRect(col, row, width, height, " ");
  }

  /** Create a deep copy of this grid. */
  clone(): Grid {
    const copy = new Grid(this.width, this.height);
    copy.cells = [...this.cells];
    copy.comments = [...this.comments];
    return copy;
  }

  /** Serialize the grid to a plain text string (lines joined by \n). */
  toString(): string {
    const out: string[] = [];

    // Re-emit comment lines at the top
    for (const comment of this.comments) {
      out.push(comment);
    }

    const lines: string[] = [];
    for (let r = 0; r < this.height; r++) {
      let line = "";
      for (let c = 0; c < this.width; c++) {
        line += this.get(c, r);
      }
      lines.push(line.trimEnd());
    }
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    out.push(...lines);
    return out.join("\n") + "\n";
  }

  /** Parse a plain text string into a Grid, stripping comment lines (# ...). */
  static fromString(text: string, minWidth = DEFAULT_WIDTH, minHeight = DEFAULT_HEIGHT): Grid {
    const allLines = text.split("\n");

    // Strip leading comment lines (# ...)
    const comments: string[] = [];
    let contentStart = 0;
    for (let i = 0; i < allLines.length; i++) {
      const trimmed = allLines[i].trimStart();
      if (trimmed.startsWith("#")) {
        comments.push(allLines[i]);
        contentStart = i + 1;
      } else {
        break;
      }
    }

    const contentLines = allLines.slice(contentStart);

    // Size the grid to fit all content, with minimums
    const maxLineWidth = contentLines.reduce((max, line) => Math.max(max, line.length), 0);
    const width = Math.max(minWidth, maxLineWidth);
    const height = Math.max(minHeight, contentLines.length);

    const grid = new Grid(width, height);
    grid.comments = comments;

    for (let r = 0; r < contentLines.length; r++) {
      for (let c = 0; c < contentLines[r].length; c++) {
        grid.set(c, r, contentLines[r][c]);
      }
    }
    return grid;
  }
}
