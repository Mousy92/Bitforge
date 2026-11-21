// Entry point for the single-file offline build. The game data is imported and
// bundled directly into the page (no fetch), so the built index.html runs by
// double-clicking it from disk — no server, no network.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import gamedata from "../public/data/gamedata.json";
import "./styles.css";

(globalThis as unknown as { __GAMEDATA__?: unknown }).__GAMEDATA__ = gamedata;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
