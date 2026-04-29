// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HashRouter } from "react-router-dom";
import "./index.css";

// Import favicon/logo properly
import logo from "./assets/logo1.png";

// =========================
// HARI MOVIE APP ROOT
// =========================

// Browser tab title
document.title = "HARI MOVIES";

// =========================
// FAVICON SETUP
// =========================
let favicon = document.querySelector("link[rel='icon']");

if (!favicon) {
  favicon = document.createElement("link");
  favicon.rel = "icon";
  document.head.appendChild(favicon);
}

favicon.href = logo;

// Apple / mobile icon
let appleIcon = document.querySelector("link[rel='apple-touch-icon']");

if (!appleIcon) {
  appleIcon = document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  document.head.appendChild(appleIcon);
}

appleIcon.href = logo;

// =========================
// META TAGS FOR LINK SHARE
// =========================

// Helper function
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

// Basic SEO
setMetaTag("description", "Watch movies and entertainment on HARI MOVIES", true);
setMetaTag("application-name", "HARI MOVIES", true);
setMetaTag("apple-mobile-web-app-title", "HARI MOVIES", true);

// Open Graph (WhatsApp, Facebook, Telegram)
setMetaTag("og:title", "HARI MOVIES");
setMetaTag("og:description", "Watch movies and entertainment on HARI MOVIES");
setMetaTag("og:image", logo);
setMetaTag("og:type", "website");
setMetaTag("og:url", window.location.href);

// Twitter
setMetaTag("twitter:card", "summary_large_image", true);
setMetaTag("twitter:title", "HARI MOVIES", true);
setMetaTag("twitter:description", "Watch movies and entertainment on HARI MOVIES", true);
setMetaTag("twitter:image", logo, true);

// =========================
// GOOGLE FONT
// =========================
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined";
document.head.appendChild(fontLink);

// =========================
// RENDER APP
// =========================
const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);