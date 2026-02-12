import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";

// Resolve diagrams dir relative to repo root (two levels up from packages/server)
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DIAGRAMS_DIR = path.resolve(REPO_ROOT, "diagrams");
const PATTERNS_PATH = path.resolve(REPO_ROOT, "PATTERNS.md");
const PREFERRED_PORT = Number(process.env.PORT) || 3001;
const PORT_FILE = path.resolve(REPO_ROOT, ".server-port");

// Ensure diagrams directory exists
if (!fs.existsSync(DIAGRAMS_DIR)) {
  fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
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

/** List all diagram files */
app.get("/files", (_req, res) => {
  const files = fs.readdirSync(DIAGRAMS_DIR)
    .filter(f => f.endsWith(".txt"))
    .sort();
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
let watchDebounce: ReturnType<typeof setTimeout> | null = null;
fs.watch(DIAGRAMS_DIR, (eventType, filename) => {
  if (filename && filename.endsWith(".txt")) {
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      broadcast({ type: "file-changed", name: filename });

      // Also check for @ai directives on external edits
      const filePath = path.join(DIAGRAMS_DIR, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        checkForAiDirectives(filename, content);
      }
    }, 200);
  }
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

const SYSTEM_PROMPT = [
  "You are a text-processing tool that transforms ASCII diagrams.",
  "You receive a diagram and output a modified version.",
  "Your ENTIRE stdout will be written directly to a file.",
  "Output ONLY the diagram content. No prose, no explanations, no questions,",
  "no markdown fences, no commentary. Never ask for permission.",
].join(" ");

const LOOKS_LIKE_CHAT = /^(I |I'm |I need |I can|I've |It seems|Sure|Here|The |This |Let me|Unfortunately|I apologize|Could you|Please |Would you|Note:)/m;

function runClaude(filename: string, instruction: string, userMessage = ""): Promise<void> {
  const filePath = path.join(DIAGRAMS_DIR, filename);
  const patterns = fs.readFileSync(PATTERNS_PATH, "utf-8");
  const diagramContent = fs.readFileSync(filePath, "utf-8");

  const isRepair = /^repair$/i.test(instruction);
  const isRemix = /^remix$/i.test(instruction);
  const isPredict = /^predict$/i.test(instruction);

  let taskDescription: string;

  if (isRepair) {
    taskDescription = [
      "REPAIR this diagram.",
      "Look for broken or incomplete widget patterns — missing box corners, unclosed edges,",
      "misaligned borders, partially erased widgets — and fix them.",
      "Do not add new widgets or change the layout. Only repair damaged patterns.",
    ].join("\n");
  } else if (isRemix) {
    taskDescription = [
      "REMIX this diagram.",
      "Produce a completely new layout that preserves ALL existing content but rearranges it.",
      "",
      'What "preserve content" means:',
      "- Every box label that exists must appear in the output (same text, not reworded)",
      "- Every button label that exists must appear in the output (same text, not reworded)",
      "- Every text widget that exists must appear in the output (same text, not reworded)",
      "- The total number of boxes, buttons, text widgets, and lines should stay the same",
      "",
      'What "new layout" means:',
      "- Change the positions of widgets — move things to different rows and columns",
      "- Change box sizes (wider, taller, narrower, shorter) as long as labels still fit",
      "- Change grouping — nest widgets inside boxes that previously were outside, or vice versa",
      "- Change alignment — if things were stacked vertically, try horizontal, or a grid",
      "- Change spacing between widgets",
      "- Be creative: the result should look noticeably different, not like a minor shift",
      "",
      "Do not add new widgets that were not in the original.",
      "Do not remove any widgets that were in the original.",
      "Do not rename or reword any labels or text.",
      "All box-drawing characters must form valid, complete boxes (no broken corners or edges).",
      "All buttons must use correct [ Label ] syntax.",
    ].join("\n");
  } else if (isPredict) {
    taskDescription = [
      "PREDICT what comes next in this diagram and complete it.",
      "The diagram is a work in progress. Analyze what is already there and add what is missing.",
      "",
      "How to analyze:",
      '- Look for repeating patterns (e.g., a series of form fields — if there is "Username" but no "Password", add it)',
      "- Look for incomplete structures (e.g., a header and content area but no footer — add the footer)",
      "- Look for asymmetry that suggests missing pieces (e.g., three buttons in a row with space for a fourth)",
      "- Look for conventional UI patterns (e.g., a login form missing a submit button, a nav bar missing expected items)",
      '- Infer intent from labels and layout (e.g., a "Settings" box with only one option probably needs more)',
      "",
      "Rules for prediction:",
      "- Preserve everything that already exists — do not move, resize, or restyle existing widgets",
      "- Only add new widgets; never remove or modify existing ones",
      "- Match the visual style of existing widgets: same box sizes for similar items, same spacing conventions, same alignment patterns",
      "- Place new widgets in logical positions relative to existing ones (below, beside, continuing a sequence)",
      "- Do not add more than what the pattern suggests — complete the thought, do not over-extend",
      "- Use the same character conventions already present in the diagram",
      "- If the diagram appears complete and nothing is obviously missing, output it unchanged",
    ].join("\n");
  } else {
    taskDescription = [
      "The user has left this instruction in the file:",
      `"${instruction}"`,
      "\nEdit the diagram to fulfill the instruction.",
    ].join("\n");
  }

  if (userMessage) {
    taskDescription += "\n\nAdditional user instruction: " + userMessage;
  }

  const prompt = [
    "Widget pattern definitions:\n",
    patterns,
    "\nCurrent file content:\n",
    diagramContent,
    "\nTask: " + taskDescription,
    "\nRules:",
    "- Remove any line starting with '# @ai'",
    "- Keep other comment lines (like '# see PATTERNS.md for widget syntax')",
    "- Output the complete file contents and NOTHING else",
  ].join("\n");

  return attemptClaude(filename, filePath, prompt, 0);
}

function attemptClaude(filename: string, filePath: string, prompt: string, attempt: number): Promise<void> {
  const MAX_ATTEMPTS = 2;

  return new Promise((resolve, reject) => {
    const finalPrompt = attempt > 0
      ? prompt + "\n\nPREVIOUS ATTEMPT FAILED. Output ONLY the raw diagram text. No explanation."
      : prompt;

    console.log(`[ai] Spawning claude for ${filename} (attempt ${attempt + 1}/${MAX_ATTEMPTS}, prompt length: ${finalPrompt.length} chars)`);

    const child = spawn("claude", [
      "-p", finalPrompt,
      "--system-prompt", SYSTEM_PROMPT,
      "--tools", "",
    ], {
      cwd: REPO_ROOT,
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
          resolve(attemptClaude(filename, filePath, prompt, attempt + 1));
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
          resolve(attemptClaude(filename, filePath, prompt, attempt + 1));
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
  console.log(`Diagrams directory: ${DIAGRAMS_DIR}`);
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

// --- Helpers ---

function safePath(name: string): string | null {
  const sanitized = path.basename(name);
  if (!sanitized.endsWith(".txt")) return null;
  if (sanitized !== name) return null;
  return path.join(DIAGRAMS_DIR, sanitized);
}
