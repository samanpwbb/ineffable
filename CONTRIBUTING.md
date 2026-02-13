# Contributing

## Prerequisites

- Node.js >= 18
- pnpm >= 10
- Claude Code CLI (`claude`) for AI features

## Setup

```bash
git clone <repo-url>
cd ineffable
pnpm install
```

## Development

```bash
pnpm dev
```

Opens the editor at http://localhost:5173 (API server runs on port 3001).

## Project structure

```
packages/
  core/      Widget types, 2D grid, ASCII parser, renderer
  server/    Express API + WebSocket + AI directive handler
  client/    Canvas-based editor UI (React + Vite)
diagrams/    Working directory for .txt diagram files
PATTERNS.md  Widget ASCII pattern definitions (LLM context)
```

## File format

Diagram files are plain text stored in `diagrams/` as `.txt` files. Lines starting with `#` at the top of the file are treated as comments — they are preserved on save but not rendered on the canvas.

```
# see PATTERNS.md for widget syntax
# any other comments here

┌───────────┐
│  Content  │
└───────────┘
```

See [PATTERNS.md](PATTERNS.md) for full widget pattern definitions.
