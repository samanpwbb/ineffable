#!/usr/bin/env node

import path from "node:path";
import { startServer } from "../dist/server/index.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: ineffable [directory] [--port <port>]

Open the Ineffable diagram editor for .txt files in a directory.

Arguments:
  directory    Target directory to scan for .txt files (default: cwd)
  --port       Server port (default: 3001, or PORT env var)

Examples:
  ineffable                     # Edit diagrams in current directory
  ineffable ./diagrams          # Edit diagrams in ./diagrams
  ineffable --port 8080         # Use custom port`);
  process.exit(0);
}

let targetDir = process.cwd();
let port;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = Number(args[i + 1]);
    i++;
  } else if (!args[i].startsWith("-")) {
    targetDir = path.resolve(args[i]);
  }
}

startServer({ targetDir, port });
