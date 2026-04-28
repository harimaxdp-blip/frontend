import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HashRouter } from "react-router-dom";

// GLOBAL STYLES
import "./index.css";

// =========================
// HARI MOVIE APP ROOT
// =========================

// Browser tab title
document.title = "HARI MOVIES";

// Browser favicon from src/assets/logo.png
const favicon =
  document.querySelector("link[rel='icon']") ||
  document.createElement("link");

favicon.rel = "icon";
favicon.href = require("./assets/logo1.png");
document.head.appendChild(favicon);

// =========================
// RENDER APP
// =========================
// Creating the root element and rendering the app
const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);