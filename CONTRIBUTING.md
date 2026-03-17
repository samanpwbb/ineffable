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

## Releasing

Releases are published to npm automatically via GitHub Actions when a version tag is pushed.

1. Bump the version in the root `package.json`:

   ```bash
   # e.g. 0.2.5 → 0.3.0
   vim package.json
   ```

2. Commit the bump and tag it:

   ```bash
   git add package.json
   git commit -m "v0.3.0"
   git tag v0.3.0
   ```

3. Push the commit and tag:

   ```bash
   git push origin main --tags
   ```

The `publish.yml` workflow runs on any `v*` tag push. It installs dependencies, runs tests, builds, and publishes to npm using the `NPM_TOKEN` secret.
