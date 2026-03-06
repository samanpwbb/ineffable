import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";

const HOOK_SCRIPT_TEMPLATE = `#!/bin/bash
DIAGRAM_DIR="$CLAUDE_PROJECT_DIR/{{DIAGRAMS_DIR}}"
HASH_FILE="/tmp/ineffable-diagram-hash"

[ -d "$DIAGRAM_DIR" ] || exit 0

# Hash all .txt files in the diagrams directory
CURRENT=$(cat "$DIAGRAM_DIR"/*.txt 2>/dev/null | md5 -q 2>/dev/null || cat "$DIAGRAM_DIR"/*.txt 2>/dev/null | md5sum | cut -d' ' -f1)
LAST=$(cat "$HASH_FILE" 2>/dev/null || echo "")

[ "$CURRENT" = "$LAST" ] && exit 0
[ -z "$CURRENT" ] && exit 0

echo "$CURRENT" > "$HASH_FILE"

CONTENT=""
for f in "$DIAGRAM_DIR"/*.txt; do
  [ -f "$f" ] || continue
  NAME=$(basename "$f")
  CONTENT="$CONTENT--- $NAME ---
$(cat "$f")

"
done

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "The user has updated their ASCII diagrams:\\n\\n$CONTENT"
  }
}
EOF
`;

const HOOK_ENTRY = {
  hooks: [
    {
      type: "command" as const,
      command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/inject-diagram.sh',
      timeout: 5,
    },
  ],
};

export async function setupHook(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  const root = workspaceFolder.uri.fsPath;
  const diagramsDir = vscode.workspace
    .getConfiguration("ineffable")
    .get<string>("diagramsDir", "ineffable-diagrams");

  // Create .claude/hooks/ directory
  const hooksDir = path.join(root, ".claude", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });

  // Write hook script with diagrams dir templated in
  const hookPath = path.join(hooksDir, "inject-diagram.sh");
  const script = HOOK_SCRIPT_TEMPLATE.replace("{{DIAGRAMS_DIR}}", diagramsDir);
  fs.writeFileSync(hookPath, script, { mode: 0o755 });

  // Read or create .claude/settings.local.json
  const settingsPath = path.join(root, ".claude", "settings.local.json");
  let settings: Record<string, unknown> = {};
  try {
    const existing = fs.readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(existing);
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  // Merge hook entry
  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown[]>;
  if (!hooks.UserPromptSubmit) hooks.UserPromptSubmit = [];

  // Check if our hook is already configured
  const already = (hooks.UserPromptSubmit as Array<{ hooks?: Array<{ command?: string }> }>).some(
    (entry) =>
      entry.hooks?.some((h) => h.command?.includes("inject-diagram.sh"))
  );

  if (!already) {
    (hooks.UserPromptSubmit as unknown[]).push(HOOK_ENTRY);
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  vscode.window.showInformationMessage(
    "Claude Code hook configured. Diagrams will be auto-injected on prompt submit."
  );
}
