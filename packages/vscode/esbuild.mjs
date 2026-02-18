import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Extension host bundle (Node.js, CommonJS)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
};

// Webview bundle (browser, IIFE)
const webviewConfig = {
  entryPoints: ["src/webview/main.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  loader: { ".css": "css" },
  jsx: "automatic",
};

if (watch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context(webviewConfig);
  await Promise.all([ctx1.watch(), ctx2.watch()]);
  console.log("Watching...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
}
