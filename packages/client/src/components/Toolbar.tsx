import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
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
      <ToggleGroup
        value={[activeTool]}
        onValueChange={(value) => {
          if (value.length > 0) {
            onToolChange(value[value.length - 1] as Tool);
          }
        }}
      >
        {tools.map((tool) => (
          <Toggle
            key={tool.value}
            value={tool.value}
            aria-label={tool.label}
            className="toolbar-btn"
            pressed={activeTool === tool.value}
          >
            <span className="toolbar-btn-label">{tool.label}</span>
            <span className="toolbar-btn-shortcut">{tool.shortcut}</span>
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

export { tools };
