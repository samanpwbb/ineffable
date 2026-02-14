/**
 * Client-side API for communicating with the Ineffable server.
 * Discovers the server port dynamically via /__server_port.
 */

let _baseUrl: string | null = null;

async function getBaseUrl(): Promise<string> {
  if (_baseUrl) return _baseUrl;
  try {
    const res = await fetch("/__server_port");
    const { port } = await res.json();
    _baseUrl = `http://localhost:${port}`;
  } catch {
    // In production the server serves the client on the same origin
    _baseUrl = "";
  }
  return _baseUrl;
}

export async function listFiles(): Promise<string[]> {
  const base = await getBaseUrl();
  try {
    const res = await fetch(`${base}/files`);
    return res.json();
  } catch (e) {
    _baseUrl = null;
    throw e;
  }
}

export async function readFile(name: string): Promise<string> {
  const base = await getBaseUrl();
  try {
    const res = await fetch(`${base}/file/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Failed to read ${name}: ${res.status}`);
    return res.text();
  } catch (e) {
    _baseUrl = null;
    throw e;
  }
}

export async function writeFile(name: string, content: string): Promise<void> {
  const base = await getBaseUrl();
  try {
    const res = await fetch(`${base}/file/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    if (!res.ok) throw new Error(`Failed to write ${name}: ${res.status}`);
  } catch (e) {
    _baseUrl = null; // Re-discover port on next call
    throw e;
  }
}

export async function triggerAi(name: string, instruction = "repair", userMessage = ""): Promise<void> {
  const base = await getBaseUrl();
  try {
    const res = await fetch(`${base}/ai/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, userMessage }),
    });
    if (!res.ok) throw new Error(`Failed to trigger AI on ${name}: ${res.status}`);
  } catch (e) {
    _baseUrl = null;
    throw e;
  }
}

export type WsMessage =
  | { type: "file-changed"; name: string }
  | { type: "ai-status"; name: string; status: "working" | "done" | "error"; instruction: string };

export async function connectWs(onMessage: (msg: WsMessage) => void): Promise<WebSocket> {
  const base = await getBaseUrl();
  const wsUrl = base.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data as string) as WsMessage;
    onMessage(msg);
  });
  return ws;
}
