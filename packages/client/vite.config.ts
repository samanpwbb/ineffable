import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portFile = path.resolve(__dirname, "../../.server-port");

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
});
