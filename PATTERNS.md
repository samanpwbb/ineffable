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

### Checkbox

A single-line checkbox with a label. Can be checked or unchecked.

Unchecked:
```
[ ] Accept terms
```

Checked:
```
[x] Remember me
```

- Starts with `[x]` (checked) or `[ ]` (unchecked) — exactly 3 characters
- Followed by a space and label text
- Always exactly one line tall

### Input

A single-line text input field represented by underscores inside brackets.

```
[____________]
```

- Starts with `[` and ends with `]`
- Interior is filled with `_` (underscore) characters
- Minimum 2 underscores (minimum width: 4)
- Always exactly one line tall

### Text

Plain text with no surrounding decoration. Any characters that don't match
another widget pattern are treated as text.

A text widget is a contiguous run of non-space characters (and internal spaces)
on a single line that does not match box, button, or line patterns.

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
2. Checkbox (look for `[x]` or `[ ]` followed by space and label)
3. Input (look for `[___]` — brackets containing underscores)
4. Button (look for `[ ... ]` with padding)
5. Line (horizontal/vertical runs not part of a box)
6. Text (everything else that isn't whitespace)
