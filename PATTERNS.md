# Ineffable Widget Patterns

This file defines the ASCII patterns used by each widget in Ineffable diagrams.
LLMs should reference this file when reading or editing `.txt` diagram files.

## Grid

Diagrams are a fixed-width character grid. Each cell holds one character.
Coordinates are `(col, row)` starting at `(0, 0)` top-left.
Empty cells are spaces (` `).

## Widgets

### Box

A rectangle drawn with Unicode box-drawing characters.
Minimum size: 3 wide x 3 tall.

```
┌──────┐
│      │
│      │
└──────┘
```

- `┌` top-left corner
- `┐` top-right corner
- `└` bottom-left corner
- `┘` bottom-right corner
- `─` horizontal edge
- `│` vertical edge
- Interior is filled with spaces

### Button

A single-line label enclosed in square brackets with a space padding.

```
[ Submit ]
```

- Starts with `[ ` (bracket, space)
- Ends with ` ]` (space, bracket)
- Label text between the padding spaces
- Always exactly one line tall

### Toggle

A checkbox-style toggle. Two states:

```
[x] Enabled
[ ] Disabled
```

- `[x] ` prefix = on
- `[ ] ` prefix = off
- Label text follows the prefix
- Always exactly one line tall

### Text

Plain text with no surrounding decoration. Any characters that don't match
another widget pattern are treated as text.

A text widget is a contiguous run of non-space characters (and internal spaces)
on a single line that does not match box, button, toggle, or line patterns.

### Line

Horizontal or vertical runs of line-drawing characters.

Horizontal:
```
────────
```

Vertical:
```
│
│
│
│
```

- Horizontal: 2 or more `─` characters in a row (not part of a box edge)
- Vertical: 2 or more `│` characters in a column (not part of a box edge)

## Pattern Priority

When detecting widgets from the grid, match in this order:
1. Box (look for corners, trace edges)
2. Button (look for `[ ... ]` with padding)
3. Toggle (look for `[x] ` or `[ ] ` prefix)
4. Line (horizontal/vertical runs not part of a box)
5. Text (everything else that isn't whitespace)
