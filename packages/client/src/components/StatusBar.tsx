import React from "react";

interface StatusBarProps {
  position: string;
  tool: string;
  file: string;
}

export function StatusBar({ position, tool, file }: StatusBarProps) {
  return (
    <div className="status-bar">
      <span>{position}</span>
      <span>{tool}</span>
      <span>{file}</span>
    </div>
  );
}
