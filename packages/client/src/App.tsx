import React, { useCallback, useEffect, useRef, useState } from "react";
import { Grid, DEFAULT_WIDTH, DEFAULT_HEIGHT } from "@ineffable/core";
import { CanvasRenderer } from "./canvas.js";
import { Editor, Tool } from "./editor.js";
import { Select } from "./components/Select.js";
import { Toolbar, tools } from "./components/Toolbar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Button } from "./components/Button.js";
import { listFiles, readFile, triggerAi, connectWs } from "./api.js";
import { AiDialog, AiAction } from "./components/AiDialog.js";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [status, setStatus] = useState({ position: "0, 0", tool: "select", file: "-" });
  const [aiStatus, setAiStatus] = useState<{ status: "working" | "done" | "error"; instruction: string } | null>(null);
  const [aiDialogAction, setAiDialogAction] = useState<AiAction | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

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
        // Skip reload if we're inline-editing — the change came from our own save
        if (editorRef.current?.isEditing) return;
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

      // Forward to editor when inline editing
      const editor = editorRef.current;
      if (editor?.isEditing) {
        editor.onKeyDown(e);
        // Sync tool state — editing auto-switches to select
        setActiveTool(editor.tool);
        return;
      }

      if (e.key === "Escape") {
        handleToolChange("select");
        return;
      }

      // Delete selected widget
      if ((e.key === "Delete" || e.key === "Backspace") && editor?.selectedWidget) {
        e.preventDefault();
        editor.deleteSelected();
        return;
      }

      // Shift+Arrow: nudge selected widget
      if (e.shiftKey && e.key.startsWith("Arrow") && editor?.selectedWidget) {
        e.preventDefault();
        editor.nudgeSelected(e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight");
        return;
      }

      // Arrow: select nearest widget in direction
      if (e.key.startsWith("Arrow") && editor) {
        e.preventDefault();
        editor.selectInDirection(e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight");
        return;
      }

      // Undo/redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          editor?.redo();
        } else {
          editor?.undo();
        }
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
    // Sync tool state — button/text creation auto-switches to select
    if (editorRef.current) setActiveTool(editorRef.current.tool);
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

  // Track Shift key for immediate AI trigger (bypass dialog)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setShiftHeld(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const handleAiButtonClick = useCallback((action: AiAction, e: React.MouseEvent) => {
    if (!currentFile) return;
    if (e.shiftKey) {
      triggerAi(currentFile, action);
    } else {
      setAiDialogAction(action);
    }
  }, [currentFile]);

  const handleAiSubmit = useCallback(async (action: AiAction, userMessage: string) => {
    setAiDialogAction(null);
    if (!currentFile) return;
    await triggerAi(currentFile, action, userMessage);
  }, [currentFile]);

  const handleAiCancel = useCallback(() => {
    setAiDialogAction(null);
  }, []);

  const handleClear = useCallback(() => {
    editorRef.current?.clearAll();
  }, []);

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
          onClick={(e: React.MouseEvent) => handleAiButtonClick("repair", e)}
          disabled={!currentFile || aiStatus?.status === "working"}
        >
          {shiftHeld ? "Repair" : "Repair\u2026"}
        </Button>
        <Button
          onClick={(e: React.MouseEvent) => handleAiButtonClick("remix", e)}
          disabled={!currentFile || aiStatus?.status === "working"}
        >
          {shiftHeld ? "Remix" : "Remix\u2026"}
        </Button>
        <Button
          onClick={(e: React.MouseEvent) => handleAiButtonClick("predict", e)}
          disabled={!currentFile || aiStatus?.status === "working"}
        >
          {shiftHeld ? "Predict" : "Predict\u2026"}
        </Button>
        <Button onClick={handleClear}>
          Clear
        </Button>
      </div>
      <StatusBar
        position={status.position}
        tool={status.tool}
        file={status.file}
      />
      <AiDialog
        action={aiDialogAction}
        onSubmit={handleAiSubmit}
        onCancel={handleAiCancel}
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
