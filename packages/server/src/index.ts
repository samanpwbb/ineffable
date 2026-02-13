import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { buildPrompt } from "./prompt-builder.js";
import { LOOKS_LIKE_CHAT } from "./prompts.js";

// Find the package root by walking up from the current file until we find PATTERNS.md.
// This works both in dev (packages/server/src/) and published (dist/server/).
function findPackageRoot(start: string): string {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, "PATTERNS.md"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find package root (PATTERNS.md not found)");
    dir = parent;
  }
}

const PACKAGE_ROOT = findPackageRoot(import.meta.dirname);
const PATTERNS_PATH = path.resolve(PACKAGE_ROOT, "PATTERNS.md");
const PORT_FILE = path.join(os.tmpdir(), "ineffable-server-port");

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  ".nuxt", "vendor", "__pycache__", ".venv", "target",
]);

function findTxtFiles(dir: string, base: string = dir): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      results.push(...findTxtFiles(path.join(dir, entry.name), base));
    } else if (entry.isFile() && entry.name.endsWith(".txt")) {
      results.push(path.relative(base, path.join(dir, entry.name)));
    }
  }
  return results;
}

export interface ServerOptions {
  targetDir: string;
  port?: number;
}

export function startServer(options: ServerOptions): void {
  const PREFERRED_PORT = options.port ?? (Number(process.env.PORT) || 3001);

  // Validate target directory
  const rawDir = path.resolve(options.targetDir);
  if (!fs.existsSync(rawDir)) {
    console.error(`Error: directory does not exist: ${rawDir}`);
    process.exit(1);
  }
  if (!fs.statSync(rawDir).isDirectory()) {
    console.error(`Error: not a directory: ${rawDir}`);
    process.exit(1);
  }

  // Resolve symlinks so path comparisons in safePath are consistent
  const DIAGRAMS_DIR = fs.realpathSync(rawDir);

  function safePath(name: string): string | null {
    if (!name.endsWith(".txt")) return null;
    const resolved = path.resolve(DIAGRAMS_DIR, name);
    if (!resolved.startsWith(DIAGRAMS_DIR + path.sep) && resolved !== DIAGRAMS_DIR) {
      return null;
    }
    return resolved;
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: "text/plain", limit: "1mb" }));

  // CORS for local dev
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  // Serve built client assets
  const clientDist = path.resolve(PACKAGE_ROOT, "client-dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
  }

  /** List all diagram files */
  app.get("/files", (_req, res) => {
    const files = findTxtFiles(DIAGRAMS_DIR).sort();
    res.json(files);
  });

  /** Read a diagram file */
  app.get("/file/:name", (req, res) => {
    const filePath = safePath(req.params.name);
    if (!filePath) return res.status(400).json({ error: "Invalid filename" });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });

    const content = fs.readFileSync(filePath, "utf-8");
    res.type("text/plain").send(content);
  });

  /** Write a diagram file */
  app.put("/file/:name", (req, res) => {
    const filePath = safePath(req.params.name);
    if (!filePath) return res.status(400).json({ error: "Invalid filename" });

    const content = typeof req.body === "string" ? req.body : String(req.body);
    fs.writeFileSync(filePath, content, "utf-8");

    // Notify WebSocket clients
    broadcast({ type: "file-changed", name: req.params.name });

    // Check for @ai directives
    checkForAiDirectives(req.params.name, content);

    res.json({ ok: true });
  });

  /** Trigger an @ai directive on a file */
  app.post("/ai/:name", (req, res) => {
    const filePath = safePath(req.params.name);
    if (!filePath) return res.status(400).json({ error: "Invalid filename" });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });

    let instruction: string;
    let userMessage: string;
    if (typeof req.body === "object" && req.body !== null) {
      instruction = req.body.instruction?.trim() || "repair";
      userMessage = req.body.userMessage?.trim() || "";
    } else {
      instruction = (typeof req.body === "string" && req.body.trim()) || "repair";
      userMessage = "";
    }

    if (activeJobs.has(req.params.name)) {
      return res.status(409).json({ error: "Already processing" });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    checkForAiDirectives(req.params.name, `# @ai ${instruction}\n${content}`, userMessage);
    res.json({ ok: true });
  });

  // SPA fallback: serve index.html for non-API routes
  if (fs.existsSync(clientDist)) {
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  // --- WebSocket for live reload ---

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  function broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // Watch diagrams directory for external changes (e.g. LLM editing files)
  const watchDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  fs.watch(DIAGRAMS_DIR, { recursive: true }, (_eventType, filename) => {
    if (!filename || !filename.endsWith(".txt")) return;

    // Skip ignored directories
    const parts = filename.split(path.sep);
    if (parts.some(p => IGNORE_DIRS.has(p) || (p.startsWith(".") && p !== "."))) return;

    const name = filename.split(path.sep).join("/");

    if (watchDebounce.has(name)) clearTimeout(watchDebounce.get(name)!);
    watchDebounce.set(name, setTimeout(() => {
      watchDebounce.delete(name);
      broadcast({ type: "file-changed", name });

      const filePath = path.join(DIAGRAMS_DIR, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        checkForAiDirectives(name, content);
      }
    }, 200));
  });

  // --- @ai directive handling ---

  const AI_DIRECTIVE_RE = /^#\s*@ai\s+(.+)$/m;
  const activeJobs = new Set<string>();

  function checkForAiDirectives(filename: string, content: string, userMessage = ""): void {
    if (activeJobs.has(filename)) return;

    const match = content.match(AI_DIRECTIVE_RE);
    if (!match) return;

    const instruction = match[1].trim();
    console.log(`[ai] Detected directive in ${filename}: "${instruction}"`);

    activeJobs.add(filename);
    broadcast({ type: "ai-status", name: filename, status: "working", instruction });

    runClaude(filename, instruction, userMessage)
      .then(() => {
        console.log(`[ai] Done processing ${filename}`);
        broadcast({ type: "ai-status", name: filename, status: "done", instruction });
      })
      .catch((err) => {
        console.error(`[ai] Error processing ${filename}:`, err);
        broadcast({ type: "ai-status", name: filename, status: "error", instruction });
      })
      .finally(() => {
        activeJobs.delete(filename);
      });
  }

  function runClaude(filename: string, instruction: string, userMessage = ""): Promise<void> {
    const filePath = path.join(DIAGRAMS_DIR, filename);
    const { prompt, systemPrompt } = buildPrompt({
      patternsPath: PATTERNS_PATH,
      diagramPath: filePath,
      instruction,
      userMessage,
    });
    return attemptClaude(filename, filePath, prompt, systemPrompt, 0);
  }

  function attemptClaude(filename: string, filePath: string, prompt: string, systemPrompt: string, attempt: number): Promise<void> {
    const MAX_ATTEMPTS = 2;

    return new Promise((resolve, reject) => {
      const finalPrompt = attempt > 0
        ? prompt + "\n\nPREVIOUS ATTEMPT FAILED. Output ONLY the raw diagram text. No explanation."
        : prompt;

      console.log(`[ai] Spawning claude for ${filename} (attempt ${attempt + 1}/${MAX_ATTEMPTS}, prompt length: ${finalPrompt.length} chars)`);

      const child = spawn("claude", [
        "-p", finalPrompt,
        "--system-prompt", systemPrompt,
        "--tools", "",
      ], {
        cwd: DIAGRAMS_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        console.log(`[ai] stderr: ${data.toString().trim()}`);
      });

      child.on("close", (code) => {
        console.log(`[ai] claude exited with code ${code}, stdout length: ${stdout.length}`);
        if (code !== 0) {
          if (attempt < MAX_ATTEMPTS - 1) {
            console.log(`[ai] Non-zero exit, retrying...`);
            resolve(attemptClaude(filename, filePath, prompt, systemPrompt, attempt + 1));
            return;
          }
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
          return;
        }

        let result = stdout.trim() + "\n";

        // Strip markdown fences if claude wrapped the output
        result = result.replace(/^```[a-z]*\n/i, "").replace(/\n```\s*$/, "\n");

        // Validate: output should contain box-drawing chars or comment lines,
        // not look like a conversational response
        const hasBoxChars = /[┌┐└┘─│\[\]]/.test(result);
        const looksLikeChat = LOOKS_LIKE_CHAT.test(result);
        if (!hasBoxChars || looksLikeChat) {
          console.error(`[ai] Output rejected — looks like conversational text, not a diagram`);
          console.error(`[ai] First 200 chars: ${result.slice(0, 200)}`);
          if (attempt < MAX_ATTEMPTS - 1) {
            console.log(`[ai] Retrying...`);
            resolve(attemptClaude(filename, filePath, prompt, systemPrompt, attempt + 1));
            return;
          }
          reject(new Error("Claude output conversational text instead of diagram content"));
          return;
        }

        fs.writeFileSync(filePath, result, "utf-8");
        broadcast({ type: "file-changed", name: filename });
        resolve();
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  function startListening(port: number): void {
    fs.writeFileSync(PORT_FILE, String(port), "utf-8");
    console.log(`Ineffable server running on http://localhost:${port}`);
    console.log(`Serving diagrams from: ${DIAGRAMS_DIR}`);
  }

  // Suppress WSS errors (they mirror the HTTP server errors)
  wss.on("error", () => {});

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${PREFERRED_PORT} in use, finding an open port...`);
      server.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        startListening(port);
      });
    } else {
      throw err;
    }
  });

  server.listen(PREFERRED_PORT, () => {
    startListening(PREFERRED_PORT);
  });
}

// When run directly (not imported), parse CLI args and start
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") || process.argv[1].endsWith("/index.js"));

if (isDirectRun) {
  const args = process.argv.slice(2);
  let targetDir = process.cwd();
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = Number(args[i + 1]);
      i++;
    } else if (!args[i].startsWith("-")) {
      targetDir = path.resolve(args[i]);
    }
  }

  startServer({ targetDir, port });
}
