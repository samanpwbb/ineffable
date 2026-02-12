# Ineffable

ASCII canvas for designing UI layouts alongside LLMs. Because sometimes words aren't good enough.

Ineffable lets you sketch layouts and UX flows using ASCII widgets — boxes, buttons, lines, and text. The ASCII text is the source of truth: no intermediate JSON or XML. LLMs can read and edit diagram files directly. Then give your diagrams to your LLM to build the real thing.

## Prerequisites

- Node.js >= 18
- pnpm >= 10
- Claude Code CLI (`claude`) for AI features

## Installation

```bash
git clone <repo-url>
cd ineffable
pnpm install
```

## Getting started

```bash
pnpm dev
```

Opens the editor at http://localhost:5173 (API server runs on port 3001).

Diagram files live in `diagrams/` as plain `.txt` files. An example is included.

## Usage

### Drawing

Select a tool from the floating toolbar (top-right) or use keyboard shortcuts:

| Tool   | Key | Interaction                     |
|--------|-----|---------------------------------|
| Select | V   | Click a widget to select it     |
| Box    | B   | Click + drag to draw            |
| Line   | L   | Click + drag to draw            |
| Text   | T   | Click to place, enter text      |
| Button | U   | Click to place, enter label     |

Press **Escape** to return to the select tool.

### Moving widgets

Select a widget, then click + drag it to a new position.

### AI edits

Add a `# @ai` comment to any diagram file to have Claude edit it:

```
# see PATTERNS.md for widget syntax
# @ai add a login form with username and password fields and a submit button

┌──────────────────────────────┐
│  My App                      │
└──────────────────────────────┘
```

The server detects the directive, invokes Claude with the diagram content and pattern definitions, writes the result back, and the canvas reloads live. The `# @ai` line is removed after processing.

You can add the directive by editing the `.txt` file directly in your editor — the server watches for changes on disk.

### Live reload

Any external change to a `.txt` file in `diagrams/` (from an LLM, a text editor, a script) triggers a live reload in the browser via WebSocket.

## Widget reference

See [PATTERNS.md](PATTERNS.md) for full pattern definitions.

```
Box:       ┌──────┐        Button:   [ Submit ]
           │      │
           └──────┘
Text:      Hello world
                           Line:     ──────── (horizontal)
                                     │ (vertical)
```

## File format

Diagram files are plain text. Lines starting with `#` at the top of the file are treated as comments — they are preserved on save but not rendered on the canvas.

```
# see PATTERNS.md for widget syntax
# any other comments here

┌──────────┐
│  Content  │
└──────────┘
```

## Project structure

```
packages/
  core/      Widget types, 2D grid, ASCII parser, renderer
  server/    Express API + WebSocket + AI directive handler
  client/    Canvas-based editor UI (React + Vite)
diagrams/    Working directory for .txt diagram files
PATTERNS.md  Widget ASCII pattern definitions (LLM context)
```
