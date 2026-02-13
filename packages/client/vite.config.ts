import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const portFile = path.join(os.tmpdir(), "ineffable-server-port");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "server-port",
      configureServer(server) {
        server.middlewares.use("/__server_port", (_req, res) => {
          try {
            const port = fs.readFileSync(portFile, "utf-8").trim();
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ port: Number(port) }));
          } catch {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: "Server not ready" }));
          }
        });
      },
    },
  ],
  server: {
    port: 5177,
  },
  build: {
    outDir: "../../client-dist",
    emptyOutDir: true,
  },
});
