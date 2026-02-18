import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "@ineffable/client/src/styles.css";

createRoot(document.getElementById("root")!).render(<App />);
