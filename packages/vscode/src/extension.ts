import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { setupHook } from "./hook";

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("ineffable.open", () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        return;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      const root = workspaceFolder.uri.fsPath;
      const diagramsDir = vscode.workspace
        .getConfiguration("ineffable")
        .get<string>("diagramsDir", "ineffable-diagrams");
      const diagramsPath = path.join(root, diagramsDir);

      // Ensure diagrams directory exists
      fs.mkdirSync(diagramsPath, { recursive: true });

      panel = vscode.window.createWebviewPanel(
        "ineffable",
        "Ineffable",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
          ],
        }
      );

      const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js")
      );
      const styleUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css")
      );

      panel.webview.html = getWebviewHtml(panel.webview, scriptUri, styleUri);

      panel.webview.onDidReceiveMessage(
        async (msg: { type: string; text?: string; name?: string }) => {
          switch (msg.type) {
            case "listFiles": {
              try {
                const files = fs
                  .readdirSync(diagramsPath)
                  .filter((f) => f.endsWith(".txt"))
                  .sort();
                panel?.webview.postMessage({ type: "files", files });
              } catch {
                panel?.webview.postMessage({ type: "files", files: [] });
              }
              break;
            }
            case "requestLoad": {
              if (!msg.name) break;
              try {
                const filePath = path.join(diagramsPath, msg.name);
                const content = fs.readFileSync(filePath, "utf-8");
                panel?.webview.postMessage({
                  type: "fileContent",
                  name: msg.name,
                  content,
                });
              } catch {
                panel?.webview.postMessage({
                  type: "fileContent",
                  name: msg.name,
                  content: "",
                });
              }
              break;
            }
            case "save": {
              if (!msg.name || !msg.text) break;
              const filePath = path.join(diagramsPath, msg.name);
              fs.writeFileSync(filePath, msg.text, "utf-8");
              break;
            }
            case "newFile": {
              if (!msg.name) break;
              const filePath = path.join(diagramsPath, msg.name);
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, "", "utf-8");
              }
              // Send updated file list
              const files = fs
                .readdirSync(diagramsPath)
                .filter((f) => f.endsWith(".txt"))
                .sort();
              panel?.webview.postMessage({ type: "files", files });
              break;
            }
          }
        },
        undefined,
        context.subscriptions
      );

      panel.onDidDispose(() => {
        panel = undefined;
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ineffable.setupHook", () => {
      setupHook();
    })
  );
}

export function deactivate() {}

function getWebviewHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri
): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} https://fonts.googleapis.com;
             font-src https://fonts.gstatic.com;
             script-src 'nonce-${nonce}';" />
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Ineffable</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
