import React, { useCallback, useEffect, useRef, useState } from "react";
import { Grid, DEFAULT_WIDTH, DEFAULT_HEIGHT } from "@ineffable/core";
import {
  CanvasRenderer,
  Editor,
  Toolbar,
  tools,
  Button,
  StatusBar,
  Select,
} from "@ineffable/client";
import type { Tool } from "@ineffable/client";

const vscode = acquireVsCodeApi();

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [status, setStatus] = useState({
    position: "0, 0",
    tool: "select",
    file: "-",
  });

  // Init canvas + editor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;

    const grid = new Grid(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    const renderer = new CanvasRenderer(canvas, grid);
    const editor = new Editor(
      renderer,
      grid,
      (position, tool, file) => {
        setStatus({ position, tool, file });
      },
      // onSave: send to extension host for file write
      (content) => {
        if (!editorRef.current?.currentFile) return;
        vscode.postMessage({
          type: "save",
          name: editorRef.current.currentFile,
          text: content,
        });
      }
    );

    rendererRef.current = renderer;
    editorRef.current = editor;
    editor.redraw();

    // Request file list from extension host
    vscode.postMessage({ type: "listFiles" });
  }, []);

  // Listen for messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case "files":
          setFiles(msg.files);
          if (msg.files.length > 0 && !currentFile) {
            setCurrentFile(msg.files[0]);
          }
          break;
        case "fileContent": {
          const editor = editorRef.current;
          if (!editor) break;
          const grid = msg.content
            ? Grid.fromString(msg.content, DEFAULT_WIDTH, DEFAULT_HEIGHT)
            : new Grid(DEFAULT_WIDTH, DEFAULT_HEIGHT);
          editor.currentFile = msg.name;
          editor.setGrid(grid);
          break;
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [currentFile]);

  // Load file when selection changes
  useEffect(() => {
    if (!currentFile || !editorRef.current) return;
    vscode.postMessage({ type: "requestLoad", name: currentFile });
  }, [currentFile]);

  // Tool change
  const handleToolChange = useCallback((tool: Tool) => {
    setActiveTool(tool);
    editorRef.current?.setTool(tool);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      const editor = editorRef.current;
      if (editor?.isEditing) {
        editor.onKeyDown(e);
        setActiveTool(editor.tool);
        return;
      }

      if (e.key === "Escape") {
        handleToolChange("select");
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (editor?.selectedWidget || editor?.selectedWidgets.length)
      ) {
        e.preventDefault();
        editor.deleteSelected();
        return;
      }

      if (
        e.shiftKey &&
        e.key.startsWith("Arrow") &&
        (editor?.selectedWidget || editor?.selectedWidgets.length)
      ) {
        e.preventDefault();
        editor.nudgeSelected(
          e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
        );
        return;
      }

      if (e.key.startsWith("Arrow") && editor) {
        e.preventDefault();
        editor.selectInDirection(
          e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
        );
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          editor?.redo();
        } else {
          editor?.undo();
        }
        return;
      }

      const match = tools.find(
        (t) => t.shortcut.toLowerCase() === e.key.toLowerCase()
      );
      if (match) handleToolChange(match.value);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleToolChange]);

  // Mouse handlers
  const onMouseMove = useCallback((e: MouseEvent) => {
    editorRef.current?.onMouseMove(e.clientX, e.clientY);
    if (canvasRef.current && editorRef.current) {
      canvasRef.current.style.cursor = editorRef.current.getCursor(
        e.clientX,
        e.clientY
      );
    }
  }, []);
  const onMouseUp = useCallback(
    (e: MouseEvent) => {
      editorRef.current?.onMouseUp(e.clientX, e.clientY);
      if (editorRef.current) setActiveTool(editorRef.current.tool);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    },
    [onMouseMove]
  );
  const onCanvasHover = useCallback((e: React.MouseEvent) => {
    if (canvasRef.current && editorRef.current) {
      canvasRef.current.style.cursor = editorRef.current.getCursor(
        e.clientX,
        e.clientY
      );
      editorRef.current.onHover(e.clientX, e.clientY);
    }
  }, []);
  const onCanvasLeave = useCallback(() => {
    editorRef.current?.clearHover();
  }, []);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      editorRef.current?.onMouseDown(e.clientX, e.clientY, e.shiftKey);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [onMouseMove, onMouseUp]
  );

  // Clear
  const handleClear = useCallback(() => {
    editorRef.current?.clearAll();
  }, []);

  // New file
  const handleNewFile = useCallback(() => {
    const name = prompt("File name (without .txt):");
    if (!name) return;
    const filename = name.endsWith(".txt") ? name : `${name}.txt`;
    vscode.postMessage({ type: "newFile", name: filename });
    setCurrentFile(filename);
  }, []);

  const fileOptions = files.map((f) => ({ label: f, value: f }));

  return (
    <div className="canvas-container">
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onCanvasHover}
        onMouseLeave={onCanvasLeave}
      />
      <div className="overlay">
        <Select
          value={currentFile}
          onChange={setCurrentFile}
          options={fileOptions}
          placeholder="Select file..."
        />
        <Button onClick={handleNewFile}>New File</Button>
        <Toolbar activeTool={activeTool} onToolChange={handleToolChange} />
        <Button onClick={handleClear}>Clear</Button>
      </div>
      <StatusBar
        position={status.position}
        tool={status.tool}
        file={status.file}
      />
    </div>
  );
}
