import React from "react";
import type { Tool } from "../editor.js";

const tools: { value: Tool; label: string; shortcut: string }[] = [
  { value: "select", label: "Select", shortcut: "V" },
  { value: "box", label: "Box", shortcut: "B" },
  { value: "line", label: "Line", shortcut: "L" },
  { value: "text", label: "Text", shortcut: "T" },
  { value: "button", label: "Button", shortcut: "U" },
];

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
}

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div role="group">
        {tools.map((tool) => (
          <button
            key={tool.value}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.value}
            className="toolbar-btn"
            onClick={() => onToolChange(tool.value)}
          >
            <span className="toolbar-btn-label">{tool.label}</span>
            <span className="toolbar-btn-shortcut">{tool.shortcut}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { tools };
