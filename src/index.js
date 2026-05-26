import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HashRouter } from "react-router-dom";
import "./index.css";
import logo from "./assets/logo1.png";
<<<<<<< HEAD
import { App as CapacitorApp } from "@capacitor/app";
// =========================
// 1. PREVENT ANDROID SWIPE EXIT
// =========================
window.history.pushState(null, "", window.location.href);

window.addEventListener("popstate", () => {
  window.history.pushState(null, "", window.location.href);
});

// Prevent horizontal gesture conflicts
document.documentElement.style.overflowX = "hidden";
document.body.style.overflowX = "hidden";

// =========================
// 2. DYNAMIC SCRIPT LOADER
// =========================
const loadTorrentEngine = () => {
  return new Promise((resolve) => {
    if (window.WebTorrent) {
      resolve();
      return;
    }

    // CSP
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content =
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;";
    document.head.appendChild(meta);

    // WebTorrent CDN
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js";

    script.async = true;

=======

// =========================
// 1. DYNAMIC SCRIPT LOADER
// =========================
const loadTorrentEngine = () => {
  return new Promise((resolve) => {
    // Check if already loaded
    if (window.WebTorrent) return resolve();

    // Set Content Security Policy for WebTorrent
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;";
    document.head.appendChild(meta);

    // Load WebTorrent CDN
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js";
    script.async = true;
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
    script.onload = () => {
      console.log("🎬 Torrent Engine Loaded Successfully");
      resolve();
    };
<<<<<<< HEAD

    script.onerror = () => {
      console.error("❌ Failed to load Torrent Engine");
      resolve();
    };

=======
    script.onerror = () => {
      console.error("❌ Failed to load Torrent Engine");
      resolve(); // Resolve anyway to not block the whole app
    };
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
    document.head.appendChild(script);
  });
};

// =========================
<<<<<<< HEAD
// 3. SEO & UI SETUP
// =========================
document.title = "HARI MOVIES";

// Favicon + Apple Icon
const setupIcons = () => {
  let favicon = document.querySelector("link[rel='icon']");

=======
// 2. SEO & UI SETUP
// =========================
document.title = "HARI MOVIES";

const setupIcons = () => {
  let favicon = document.querySelector("link[rel='icon']");
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.appendChild(favicon);
  }
<<<<<<< HEAD

  favicon.href = logo;

  let appleIcon = document.querySelector(
    "link[rel='apple-touch-icon']"
  );

=======
  favicon.href = logo;

  let appleIcon = document.querySelector("link[rel='apple-touch-icon']");
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
  if (!appleIcon) {
    appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    document.head.appendChild(appleIcon);
  }
<<<<<<< HEAD

  appleIcon.href = logo;
};

setupIcons();

// Meta Tags
const setMetaTag = (property, content, isName = false) => {
  const selector = isName
    ? `meta[name='${property}']`
    : `meta[property='${property}']`;

  let tag = document.querySelector(selector);

  if (!tag) {
    tag = document.createElement("meta");

    if (isName) {
      tag.setAttribute("name", property);
    } else {
      tag.setAttribute("property", property);
    }

    document.head.appendChild(tag);
  }

  tag.setAttribute("content", content);
};

setMetaTag(
  "description",
  "Watch movies on HARI MOVIES",
  true
);

setMetaTag("og:title", "HARI MOVIES");
setMetaTag("og:image", logo);

// Google Material Symbols
const fontLink = document.createElement("link");

fontLink.rel = "stylesheet";

fontLink.href =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined";

document.head.appendChild(fontLink);

// =========================
// 4. RENDER APP
// =========================
const root = ReactDOM.createRoot(
  document.getElementById("root")
);
CapacitorApp.addListener("backButton", ({ canGoBack }) => {

  if (window.location.hash !== "#/" && canGoBack) {

    window.history.back();

  } else {

    // Prevent app from closing on home page
    // Remove this line if you WANT exit on home
    return;
  }
});
=======
  appleIcon.href = logo;
};
setupIcons();

const setMetaTag = (property, content, isName = false) => {
  const selector = isName ? `meta[name='${property}']` : `meta[property='${property}']`;
  let tag = document.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    if (isName) tag.setAttribute("name", property);
    else tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
};

setMetaTag("description", "Watch movies on HARI MOVIES", true);
setMetaTag("og:title", "HARI MOVIES");
setMetaTag("og:image", logo);

const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined";
document.head.appendChild(fontLink);

// =========================
// 3. INITIALIZE & RENDER
// =========================
const root = ReactDOM.createRoot(document.getElementById("root"));

// Load engine THEN render app
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
loadTorrentEngine().then(() => {
  root.render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
});