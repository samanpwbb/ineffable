import React, { useCallback, useEffect, useRef, useState } from "react";
import { Grid, DEFAULT_WIDTH, DEFAULT_HEIGHT } from "@ineffable/core";
import { CanvasRenderer } from "./canvas.js";
import { Editor, Tool } from "./editor.js";
import { Select } from "./components/Select.js";
import { Toolbar, tools } from "./components/Toolbar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Button } from "./components/Button.js";
import { listFiles, readFile, triggerAi, connectWs } from "./api.js";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [status, setStatus] = useState({ position: "0, 0", tool: "select", file: "-" });
  const [aiStatus, setAiStatus] = useState<{ status: "working" | "done" | "error"; instruction: string } | null>(null);

  // Init canvas + editor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;

    const grid = new Grid(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    const renderer = new CanvasRenderer(canvas, grid);
    const editor = new Editor(renderer, grid, (position, tool, file) => {
      setStatus({ position, tool, file });
    });

    rendererRef.current = renderer;
    editorRef.current = editor;
    editor.redraw();
  }, []);

  // Load file list
  useEffect(() => {
    listFiles()
      .then((f) => {
        setFiles(f);
        if (f.length > 0) {
          setCurrentFile(f[0]);
        }
      })
      .catch(() => console.warn("Could not connect to server."));
  }, []);

  // Load file when selection changes
  useEffect(() => {
    if (!currentFile || !editorRef.current) return;
    readFile(currentFile).then((content) => {
      const grid = Grid.fromString(content, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      editorRef.current!.currentFile = currentFile;
      editorRef.current!.setGrid(grid);
    });
  }, [currentFile]);

  // WebSocket live reload + AI status
  useEffect(() => {
    let ws: WebSocket | null = null;
    connectWs((msg) => {
      if (msg.type === "file-changed" && msg.name === editorRef.current?.currentFile) {
        readFile(msg.name).then((content) => {
          const grid = Grid.fromString(content, DEFAULT_WIDTH, DEFAULT_HEIGHT);
          editorRef.current!.setGrid(grid);
        });
      } else if (msg.type === "ai-status" && msg.name === editorRef.current?.currentFile) {
        if (msg.status === "working") {
          setAiStatus({ status: "working", instruction: msg.instruction });
        } else {
          setAiStatus({ status: msg.status, instruction: msg.instruction });
          setTimeout(() => setAiStatus(null), 3000);
        }
      }
    }).then((socket) => { ws = socket; });
    return () => { ws?.close(); };
  }, []);

  // Tool change
  const handleToolChange = useCallback((tool: Tool) => {
    setActiveTool(tool);
    editorRef.current?.setTool(tool);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        handleToolChange("select");
        return;
      }
      const match = tools.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase());
      if (match) handleToolChange(match.value);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleToolChange]);

  // Mouse handlers — move/up are attached to document during drag so they
  // fire even when the cursor leaves the canvas (fixes vertical drag).
  const onMouseMove = useCallback((e: MouseEvent) => {
    editorRef.current?.onMouseMove(e.clientX, e.clientY);
    if (canvasRef.current && editorRef.current) {
      canvasRef.current.style.cursor = editorRef.current.getCursor(e.clientX, e.clientY);
    }
  }, []);
  const onMouseUp = useCallback((e: MouseEvent) => {
    editorRef.current?.onMouseUp(e.clientX, e.clientY);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }, [onMouseMove]);
  const onCanvasHover = useCallback((e: React.MouseEvent) => {
    if (canvasRef.current && editorRef.current) {
      canvasRef.current.style.cursor = editorRef.current.getCursor(e.clientX, e.clientY);
    }
  }, []);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    editorRef.current?.onMouseDown(e.clientX, e.clientY);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [onMouseMove, onMouseUp]);

  const handleRepair = useCallback(async () => {
    if (!currentFile) return;
    await triggerAi(currentFile, "repair");
  }, [currentFile]);

  const fileOptions = files.map((f) => ({ label: f, value: f }));

  return (
    <div className="canvas-container">
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onCanvasHover}
      />
      <div className="overlay">
        <Select
          value={currentFile}
          onChange={setCurrentFile}
          options={fileOptions}
          placeholder="Select file..."
        />
        <Toolbar activeTool={activeTool} onToolChange={handleToolChange} />
        <Button
          className="repair-btn"
          onClick={handleRepair}
          disabled={!currentFile || aiStatus?.status === "working"}
        >
          Repair
        </Button>
      </div>
      <StatusBar
        position={status.position}
        tool={status.tool}
        file={status.file}
      />
      {aiStatus && (
        <div className={`ai-indicator ai-indicator--${aiStatus.status}`}>
          <span className="ai-indicator-label">
            {aiStatus.status === "working" ? "AI working" : aiStatus.status === "done" ? "AI done" : "AI error"}
          </span>
          <span className="ai-indicator-instruction">{aiStatus.instruction}</span>
        </div>
      )}
    </div>
  );
}
