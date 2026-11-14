import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";

const PROXY_BASE = process.env.REACT_APP_MEDIA_PROXY_URL || "http://localhost:4000";
const EMPTY_LIST = Object.freeze([]);

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmt(s) {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function srtToVttBlobUrl(srtText) {
  const vtt =
    "WEBVTT\n\n" +
    srtText
      .replace(/^\uFEFF/, "")
      .replace(/\r+/g, "")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
}

async function prepareSubtitleSrc(src) {
  if (!src) return "";
  if (!/\.srt($|\?)/i.test(src)) return src;
  try {
    const res = await fetch(src);
    const srt = await res.text();
    return srtToVttBlobUrl(srt);
  } catch {
    return src;
  }
}

// ─── Parse Embedded Languages & Subtitles from Filename/URL ───────────────────
const LANG_MAP = [
  { re: /\b(tam|tamil)\b/i, label: "Tamil", lang: "ta" },
  { re: /\b(tel|telugu)\b/i, label: "Telugu", lang: "te" },
  { re: /\b(hin|hindi)\b/i, label: "Hindi", lang: "hi" },
  { re: /\b(eng|english)\b/i, label: "English", lang: "en" },
  { re: /\b(mal|malayalam)\b/i, label: "Malayalam", lang: "ml" },
  { re: /\b(kan|kannada)\b/i, label: "Kannada", lang: "kn" },
  { re: /\b(jap|japanese)\b/i, label: "Japanese", lang: "ja" },
  { re: /\b(kor|korean)\b/i, label: "Korean", lang: "ko" },
  { re: /\b(spa|spanish)\b/i, label: "Spanish", lang: "es" },
];

function parseMediaMetadataFromUrl(url) {
  try {
    const decoded = decodeURIComponent(url.split("?")[0]).replace(/[_.\-+]+/g, " ");
    const detectedAudio = [];
    LANG_MAP.forEach((entry) => {
      if (entry.re.test(decoded)) {
        detectedAudio.push({ label: entry.label, lang: entry.lang });
      }
    });

    const hasEsub = /\b(esub|esubs|msub|msubs|hcsub|subbed|sub)\b/i.test(decoded);
    const isSurround = /\b(dd5 1|ddp5 1|dd\+|ac3|eac3|dts|truehd|atmos)\b/i.test(decoded);
    const isMkv = /\.mkv($|\?)/i.test(url);

    return { detectedAudio, hasEsub, isSurround, isMkv };
  } catch {
    return { detectedAudio: [], hasEsub: false, isSurround: false, isMkv: false };
  }
}

// ─── URL / format detection ───────────────────────────────────────────────────
const RE_HLS     = /\.m3u8($|\?)/i;
const RE_DASH    = /\.mpd($|\?)/i;
const RE_MAGNET  = /^magnet:\?/i;
const RE_ARCHIVE = /\.(zip|rar|7z|tar|gz|iso|torrent|exe|apk)($|\?)/i;
const RE_MKV_AVI = /\.(mkv|avi|wmv|flv)($|\?)/i;
const RE_DIRECT  = /\.(mp4|m3u8|webm|mkv|avi|mov|ts|flv|ogv|3gp|wmv)($|\?)/i;

function getCleanFileName(url) {
  try {
    if (RE_MAGNET.test(url)) {
      const dn = new URL(url).searchParams.get("dn");
      if (dn) return decodeURIComponent(dn).replace(/[_+.-]+/g, " ").trim();
      return "Magnet Video Stream";
    }
    const pathname = new URL(url).pathname;
    const raw = pathname.split("/").pop() || "Media Stream";
    return decodeURIComponent(raw).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  } catch {
    return "Media Stream";
  }
}

function getFileExtension(url) {
  if (RE_MAGNET.test(url)) return "MAGNET";
  const m = url.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
  return m ? m[1].toUpperCase() : "FILE";
}

function isDirectUrl(url) {
  return (
    RE_DIRECT.test(url) ||
    /[?&]stream=1/i.test(url) ||
    /\/hls\//i.test(url) ||
    /\/dash\//i.test(url) ||
    /\/manifest\//i.test(url) ||
    /\.m3u8/i.test(url) ||
    /\.mpd/i.test(url)
  );
}

function getYouTubeId(url) {
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/
  );
  return m ? m[1] : null;
}

async function scrapeDirectUrl(pageUrl, signal) {
  try {
    const head = await fetch(pageUrl, { method: "HEAD", signal, mode: "cors", credentials: "omit" }).catch(() => null);
    if (head && head.ok) {
      const cType = (head.headers.get("content-type") || "").toLowerCase();
      if (cType.includes("zip") || cType.includes("octet-stream") || cType.includes("x-rar")) {
        return { errorType: "archive" };
      }
      if (cType.startsWith("video/") || cType.includes("mpegurl")) {
        return { streamUrl: pageUrl };
      }
      if (!cType.includes("text/html")) return null;
    }

    const resp = await fetch(pageUrl, { signal, mode: "cors", credentials: "omit" });
    if (!resp.ok) return null;

    const cType = (resp.headers.get("content-type") || "").toLowerCase();
    if (!cType.includes("text/html")) return null;

    const html = await resp.text();
    const patterns = [
      /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/i,
      /["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*?)["'`]/i,
      /["'`](https?:\/\/[^"'`\s]+\.mkv[^"'`\s]*?)["'`]/i,
      /["'`](https?:\/\/[^"'`\s]+\.webm[^"'`\s]*?)["'`]/i,
      /["'`](https?:\/\/[^"'`\s]+\.mpd[^"'`\s]*?)["'`]/i,
      /file\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /src\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4|mkv|webm)[^"']*)["']/i,
      /"hls"\s*:\s*"(https?:\/\/[^"]+)"/i,
      /"dash"\s*:\s*"(https?:\/\/[^"]+)"/i,
      /source\s+src=["'](https?:\/\/[^"']+)["']/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return { streamUrl: m[1].replace(/\\/g, "") };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Ad Blocker for iframes ───────────────────────────────────────────────────
function useAdBlock(iframeRef) {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    const frame = iframeRef?.current;
    if (!frame) return;

    const onLoad = () => {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) {
          setStatus("cross-origin");
          return;
        }
        const s = doc.createElement("script");
        s.textContent = `
          (function(){
            window.open = function(){ return null; };
            const adPatterns = /ads|banner|popup|advert|doubleclick|googlesyndication|adnxs|taboola|outbrain|revcontent|mgid|adsystem|adsbygoogle/i;
            const _appendChild = Element.prototype.appendChild;
            Element.prototype.appendChild = function(el){
              if (el && el.tagName) {
                const tag = el.tagName.toLowerCase();
                const src = el.src || el.href || "";
                if ((tag==="script"||tag==="iframe"||tag==="ins") && adPatterns.test(src)) return el;
              }
              return _appendChild.call(this, el);
            };
            const kill = () => {
              document.querySelectorAll('iframe,ins,[class*="ad-"],[id*="ad-"],[class*="banner"],[class*="popup"]').forEach(el => {
                if (el.tagName === "INS" || /adsbygoogle/i.test(el.className) || /ad/i.test(el.id||"")) {
                  el.style.display = "none";
                }
              });
            };
            kill();
            new MutationObserver(kill).observe(document.body || document.documentElement, { childList:true, subtree:true });
          })();
        `;
        doc.head?.appendChild(s);
        setStatus("injected");
      } catch {
        setStatus("cross-origin");
      }
    };

    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [iframeRef]);

  return status;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icons = {
  Play:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M8 5v14l11-7z"/></svg>,
  Pause:          () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>,
  Mute:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>,
  VolumeUp:       () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>,
  VolumeDown:     () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>,
  Fullscreen:     () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>,
  FullscreenExit: () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>,
  Back:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>,
  Rewind:         () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>,
  Forward:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>,
  Prev:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>,
  Next:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>,
  Stretch:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M21 3H3v18h18V3zM5 5h14v14H5V5z"/></svg>,
  Lock:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>,
  Unlock:         () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75l1.94.49C9.42 3.93 10.63 3 12 3c1.65 0 3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>,
  Gear:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>,
  Check:          () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>,
  Subtitles:      () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/></svg>,
  Language:       () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>,
  Quality:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 12H9.5v-2h-2v2H6V9h1.5v2.5h2V9H11v6zm2-6h4c.55 0 1 .45 1 1v4c0 .55-.45 1-1 1h-4V9zm1.5 4.5h2v-3h-2v3z"/></svg>,
  Upload:         () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>,
  Sun:            () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>,
  Warning:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>,
  Download:       () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>,
  Archive:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>,
  External:       () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>,
  Copy:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>,
  Shield:         () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>,
  ChevronLeft:    () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>,
  ChevronRight:   () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>,
};

// ─── Watch position helpers ───────────────────────────────────────────────────
function watchKey(t) { return `gp-pos-${(t || "u").replace(/\s+/g, "_").toLowerCase()}`; }
function savePos(t, s) { if (!t || !s || s < 5) return; try { localStorage.setItem(watchKey(t), String(Math.floor(s))); } catch {} }
function loadPos(t) { try { return parseInt(localStorage.getItem(watchKey(t)) || "0", 10) || 0; } catch { return 0; } }
function clearPos(t) { try { localStorage.removeItem(watchKey(t)); } catch {} }

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL PLAYER (Multi-Audio + Timestamp-Preserving Switch + Resume + Magnet)
// ═══════════════════════════════════════════════════════════════════════════════
export default function GlobalPlayer({
  url,
  title,
  playlist = null,
  startIndex = 0,
  subtitles = EMPTY_LIST,
  audioTracks: propAudioTracks = EMPTY_LIST,
  qualities: propQualities = EMPTY_LIST,
  onClose,
}) {
  const videoRef        = useRef(null);
  const subtitleTrackRefs = useRef(new Map());
  const containerRef    = useRef(null);
  const progressRef     = useRef(null);
  const hlsRef          = useRef(null);
  const iframeRef       = useRef(null);
  const subFileInput    = useRef(null);
  const controlsTimer   = useRef(null);
  const lockTimer       = useRef(null);
  const isScrubbingRef  = useRef(false);
  const lastSaveRef     = useRef(0);
  const pendingSeekRef  = useRef(null);
  const showResumeRef   = useRef(false);
  const gestureRef      = useRef({ active: false, moved: false, type: null, startX: 0, startY: 0, startValue: 0 });
  const gestureTimer    = useRef(null);
  const flashTimer      = useRef(null);
  const countdownRef    = useRef(null);
  const endTriggered    = useRef(false);
  const discoverAbort   = useRef(null);
  const epScrollRef     = useRef(null);

  const isSeries = Array.isArray(playlist) && playlist.length > 1;
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  const currentEp = useMemo(
    () => (isSeries ? playlist[currentIndex] || {} : { link: url, title }),
    [isSeries, playlist, currentIndex, url, title]
  );

  const rawUrl = currentEp.link || currentEp.url || url || "";
  const rawTitleStr = String(currentEp.title ?? title ?? "").trim();
  const currentTitle =
    rawTitleStr && rawTitleStr !== "0" ? rawTitleStr : getCleanFileName(rawUrl);

  const parsedMeta = useMemo(() => parseMediaMetadataFromUrl(rawUrl), [rawUrl]);

  const hasNext = isSeries && currentIndex < playlist.length - 1;
  const hasPrev = isSeries && currentIndex > 0;

  const [mode, setMode]                       = useState("discovering");
  const [directUrl, setDirectUrl]             = useState("");
  const [iframeUrl, setIframeUrl]             = useState("");
  const [engine, setEngine]                   = useState("");
  const [discoverMsg, setDiscoverMsg]         = useState("Detecting stream…");
  const [unsupportedInfo, setUnsupportedInfo] = useState(null);
  const [copied, setCopied]                   = useState(false);

  const [isPlaying, setIsPlaying]       = useState(false);
  const [currentTime, setCurrentTime]   = useState(0);
  const [duration, setDuration]         = useState(0);
  const [knownDuration, setKnownDuration] = useState(0);
  const [volume, setVolume]             = useState(1);
  const [isMuted, setIsMuted]           = useState(false);
  const [isBuffering, setIsBuffering]   = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing]   = useState(false);
  const [scrubPct, setScrubPct]         = useState(null);
  const [isStretched, setIsStretched]   = useState(false);

  const [isLocked, setIsLocked]           = useState(false);
  const [showLockBadge, setShowLockBadge] = useState(false);

  const [showSettings, setShowSettings]   = useState(false);
  const [settingsTab, setSettingsTab]     = useState("main");
  const [qualityList, setQualityList]     = useState([]);
  const [activeQuality, setActiveQuality] = useState(-1);
  const [audioList, setAudioList]         = useState([]);
  const [activeAudio, setActiveAudio]     = useState(0);
  const [subtitleList, setSubtitleList]   = useState([]);
  const [activeSub, setActiveSub]         = useState(-1);
  const [trackNotice, setTrackNotice]     = useState("");

  const [error, setError]               = useState("");
  const [brightness, setBrightness]     = useState(100);
  const [gestureOv, setGestureOv]       = useState(null);
  const [playFlash, setPlayFlash]       = useState(null);
  const [flashKey, setFlashKey]         = useState(0);
  const [countdown, setCountdown]       = useState(null);
  const [showResume, setShowResume]     = useState(false);
  const [resumeTime, setResumeTime]     = useState(0);
  const adBlockStatus = useAdBlock(iframeRef);

  useEffect(() => {
    showResumeRef.current = showResume;
  }, [showResume]);

  // ── Controls hide timer (3 seconds) ───────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    if (isScrubbingRef.current || showSettings) return;
    controlsTimer.current = setTimeout(() => {
      setShowControls(false);
      setShowSettings(false);
    }, 3000);
  }, [showSettings]);

  useEffect(() => {
    if (showSettings) {
      clearTimeout(controlsTimer.current);
      setShowControls(true);
    } else if (!isLocked) {
      resetControlsTimer();
    }
  }, [showSettings, isLocked, resetControlsTimer]);

  // ── Lock Mode ─────────────────────────────────────────────────────────
  const revealLockSign = useCallback(() => {
    setShowLockBadge(true);
    clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => setShowLockBadge(false), 3000);
  }, []);

  const enterLockMode = useCallback(() => {
    setIsLocked(true);
    setShowControls(false);
    setShowSettings(false);
    clearTimeout(controlsTimer.current);
    revealLockSign();
  }, [revealLockSign]);

  const exitLockMode = useCallback(() => {
    setIsLocked(false);
    setShowLockBadge(false);
    clearTimeout(lockTimer.current);
    resetControlsTimer();
  }, [resetControlsTimer]);

  // ── Load External Subtitles (.vtt or .srt) ────────────────────────────
  useEffect(() => {
    let active = true;
    const epSubs = currentEp.subtitles?.length ? currentEp.subtitles : subtitles;
    if (!epSubs.length) {
      setSubtitleList((prev) => prev.filter((s) => s.source !== "prop"));
      return;
    }
    Promise.all(
      epSubs.map(async (sub, i) => ({
        id: `prop-${i}`,
        label: sub.label || sub.lang || `Subtitle ${i + 1}`,
        lang: sub.lang || "en",
        src: await prepareSubtitleSrc(sub.src || sub.url),
        source: "prop",
      }))
    ).then((resolved) => {
      if (!active) return;
      setSubtitleList((prev) => [
        ...resolved,
        ...prev.filter((s) => s.source !== "prop"),
      ]);
      if (resolved.length > 0) setActiveSub(resolved[0].id);
    });
    return () => { active = false; };
  }, [currentEp, subtitles]);

  // ── Handle Local Subtitle Upload (.srt / .vtt) ────────────────────────
  const handleSubtitleUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      const blobUrl = /\.srt$/i.test(file.name)
        ? srtToVttBlobUrl(content)
        : URL.createObjectURL(new Blob([content], { type: "text/vtt" }));

      const newId = `upload-${Date.now()}`;
      const newSub = {
        id: newId,
        label: file.name.replace(/\.[^.]+$/, ""),
        lang: "en",
        src: blobUrl,
        source: "upload",
      };

      setSubtitleList((prev) => [...prev, newSub]);
      setActiveSub(newId);
      setTrackNotice("");

      setTimeout(() => {
        const v = videoRef.current;
        if (!v?.textTracks) return;
        for (let i = 0; i < v.textTracks.length; i++) {
          v.textTracks[i].mode = v.textTracks[i].label === newSub.label ? "showing" : "disabled";
        }
      }, 80);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // ── Sync optional prop qualities & audio tracks ───────────────────────
  useEffect(() => {
    const epQuals = currentEp.qualities?.length ? currentEp.qualities : propQualities;
    if (epQuals.length > 0) {
      setQualityList(epQuals.map((q, i) => ({ id: i, label: q.label, url: q.url })));
      setActiveQuality(0);
    } else {
      setQualityList([]);
      setActiveQuality(-1);
    }

    const epAudio = currentEp.audioTracks?.length ? currentEp.audioTracks : propAudioTracks;
    if (epAudio.length > 0) {
      setAudioList(epAudio.map((a, i) => ({ id: i, label: a.label, lang: a.lang || "", url: a.url, source: "prop" })));
      setActiveAudio(0);
    }
  }, [currentEp, propQualities, propAudioTracks]);

  const applyProbeData = useCallback((probeData, mediaHttpUrl) => {
    const totalDuration = Number(probeData?.totalDuration);
    if (Number.isFinite(totalDuration) && totalDuration > 0) setKnownDuration(totalDuration);

    const fallbackLangs = parseMediaMetadataFromUrl(mediaHttpUrl).detectedAudio;
    const sourceTracks = probeData?.audioTracks?.length
      ? probeData.audioTracks
      : fallbackLangs.map((track, idx) => ({ id: idx, label: track.label, lang: track.lang }));

    const hasProvidedAudioTracks =
      currentEp.audioTracks?.length > 0 || propAudioTracks.length > 0;
    if (sourceTracks.length > 0 && !hasProvidedAudioTracks) {
      setAudioList(
        sourceTracks.map((audio, idx) => {
          const rawLabel = (audio.label || "").trim();
          const isGeneric =
            !rawLabel ||
            /^und$/i.test(rawLabel) ||
            /^(audio|track|stream)\s*\d*$/i.test(rawLabel);
          return {
            id: idx,
            label: isGeneric ? fallbackLangs[idx]?.label || `Audio ${idx + 1}` : rawLabel,
            lang: audio.lang || fallbackLangs[idx]?.lang || "",
            source: "proxy",
            baseStreamUrl: `${PROXY_BASE}/api/hls/master.m3u8?url=${encodeURIComponent(mediaHttpUrl)}&audio=${idx}`,
          };
        })
      );
      setActiveAudio(0);
    }

    if (probeData?.subtitleTracks?.length > 0) {
      setSubtitleList((prev) => [
        ...prev.filter((sub) => sub.source === "prop" || sub.source === "upload"),
        ...probeData.subtitleTracks.map((sub, idx) => ({
          id: `proxy-sub-${idx}`,
          label: sub.label || sub.lang || `Subtitle ${idx + 1}`,
          lang: sub.lang || "",
          src: `${PROXY_BASE}/api/subtitle.vtt?url=${encodeURIComponent(mediaHttpUrl)}&track=${idx}${Number.isInteger(sub.streamIndex) ? `&streamIndex=${sub.streamIndex}` : ""}`,
          source: "proxy-sub",
        })),
      ]);
    }
  }, [currentEp, propAudioTracks]);

  const fetchMediaProbe = useCallback(async (mediaHttpUrl, signal) => {
    const probeRes = await fetch(
      `${PROXY_BASE}/api/probe?url=${encodeURIComponent(mediaHttpUrl)}`,
      { signal }
    );
    if (!probeRes.ok) throw new Error("Probe failed");
    const probeData = await probeRes.json();
    if (!signal?.aborted) applyProbeData(probeData, mediaHttpUrl);
    return probeData;
  }, [applyProbeData]);

  // ── Helper: Probe & Remux Any Media HTTP URL via Proxy ────────────────
  const initProxyMedia = useCallback(
    async (mediaHttpUrl, ctrl, startAtSec = 0) => {
      setDiscoverMsg("Probing multi-audio & subtitle tracks…");
      const probeData = await fetchMediaProbe(mediaHttpUrl, ctrl.signal);

      if (ctrl.signal.aborted) return true;

      setTrackNotice("");
      if (probeData.sourceQuality) {
        setQualityList([{ id: -1, label: probeData.sourceQuality }]);
        setActiveQuality(-1);
      }

      setDiscoverMsg("Transcoding DD5.1 audio to AAC…");
      const startParam = startAtSec > 0 ? `&start=${Math.floor(startAtSec)}` : "";
      setDirectUrl(
        `${PROXY_BASE}/api/hls/master.m3u8?url=${encodeURIComponent(mediaHttpUrl)}&audio=0${startParam}`
      );
      setEngine("HLS-Remux");
      setMode("direct");
      return true;
    },
    [fetchMediaProbe]
  );

  // ── SOURCE DISCOVERY ──────────────────────────────────────────────────
  useEffect(() => {
    if (!rawUrl) {
      setMode("error");
      setError("No URL provided.");
      return;
    }

    discoverAbort.current?.abort();
    const ctrl = new AbortController();
    discoverAbort.current = ctrl;

    setMode("discovering");
    setDiscoverMsg("Detecting stream…");
    setError("");
    setTrackNotice("");
    setDirectUrl("");
    setIframeUrl("");
    setKnownDuration(0);
    setDuration(0);
    setCurrentTime(0);
    const epQuals = currentEp.qualities?.length ? currentEp.qualities : propQualities;
    setQualityList(epQuals.map((quality, idx) => ({ id: idx, label: quality.label, url: quality.url })));
    setActiveQuality(epQuals.length ? 0 : -1);
    const epAudio = currentEp.audioTracks?.length ? currentEp.audioTracks : propAudioTracks;
    setAudioList(epAudio.map((audio, idx) => ({
      id: idx,
      label: audio.label,
      lang: audio.lang || "",
      url: audio.url,
      source: "prop",
    })));
    setActiveAudio(0);
    setSubtitleList((prev) => prev.filter((sub) => sub.source === "upload"));
    setActiveSub(-1);
    setUnsupportedInfo(null);
    setShowSettings(false);
    setSettingsTab("main");
    setCopied(false);
    endTriggered.current = false;
    lastSaveRef.current = 0;

    try { hlsRef.current?.destroy(); } catch {}
    hlsRef.current = null;

    const saved = loadPos(currentTitle);
    if (saved > 10) {
      setResumeTime(saved);
      setShowResume(true);
      showResumeRef.current = true;
    } else {
      setShowResume(false);
      showResumeRef.current = false;
      setResumeTime(0);
    }

    const discover = async () => {
      const probeDirectSource = (mediaUrl) => {
        fetchMediaProbe(mediaUrl, ctrl.signal).catch(() => {
          if (ctrl.signal.aborted) return;
          const fallbackLangs = parseMediaMetadataFromUrl(mediaUrl).detectedAudio;
          if (fallbackLangs.length > 0) {
            setAudioList(fallbackLangs.map((audio, idx) => ({
              id: idx,
              label: audio.label,
              lang: audio.lang,
              source: "detected",
            })));
            setTrackNotice("Start the Node.js media proxy (port 4000) to switch audio tracks in-browser, or open in VLC.");
          }
        });
      };

      // 1. Magnet Link Playback via Backend WebTorrent Bridge
      if (RE_MAGNET.test(rawUrl)) {
        setDiscoverMsg("Connecting to torrent peers (Magnet)…");
        try {
          const res = await fetch(
            `${PROXY_BASE}/api/magnet/info?magnet=${encodeURIComponent(rawUrl)}`,
            { signal: ctrl.signal }
          );
          if (res.ok) {
            const { fileName, streamUrl } = await res.json();
            if (ctrl.signal.aborted) return;

            const isMkvTorrent = /\.(mkv|avi|wmv|flv)$/i.test(fileName || "");
            if (isMkvTorrent) {
              await initProxyMedia(streamUrl, ctrl);
              setEngine("Magnet-HLS");
              return;
            }

            probeDirectSource(streamUrl);
            setDirectUrl(streamUrl);
            setEngine("Magnet");
            setMode("direct");
            return;
          }
        } catch {}

        if (ctrl.signal.aborted) return;
        setEngine("MAGNET");
        setUnsupportedInfo({
          ext: "MAGNET",
          isMagnet: true,
          isStreamableExternal: false,
          title: "BitTorrent Magnet Link",
          reason:
            "Start the Node.js media proxy (port 4000) to stream Magnet links directly in-browser, or open in qBittorrent / Flud.",
        });
        setMode("unsupported");
        return;
      }

      // 2. Archives (.zip, .rar, .7z)
      if (RE_ARCHIVE.test(rawUrl)) {
        const ext = getFileExtension(rawUrl);
        setEngine(ext);
        setUnsupportedInfo({
          ext,
          isMagnet: false,
          isStreamableExternal: false,
          title: `Compressed ${ext} Archive`,
          reason: `Browsers cannot stream .${ext.toLowerCase()} archives directly. Download and extract first.`,
        });
        setMode("unsupported");
        return;
      }

      // 3. YouTube
      const ytId = getYouTubeId(rawUrl);
      if (ytId) {
        if (ctrl.signal.aborted) return;
        setIframeUrl(`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&playsinline=1&modestbranding=1&rel=0`);
        setEngine("YouTube");
        setMode("iframe");
        return;
      }

      // 4. MKV / AVI / DD5.1 Multi-Audio Live Remux via Backend Proxy
      if (RE_MKV_AVI.test(rawUrl) || parsedMeta.isSurround) {
        try {
          await initProxyMedia(rawUrl, ctrl);
          return;
        } catch {
          if (parsedMeta.detectedAudio.length > 0) {
            setAudioList(
              parsedMeta.detectedAudio.map((a, i) => ({
                id: i,
                label: a.label,
                lang: a.lang,
                source: "detected",
              }))
            );
            setTrackNotice("Media proxy offline. Start backend server (port 4000) for in-browser DD5.1 & multi-audio playback, or open in VLC.");
          }
        }
      }

      // 5. Direct Media URL
      if (isDirectUrl(rawUrl)) {
        if (ctrl.signal.aborted) return;
        probeDirectSource(rawUrl);
        setDirectUrl(rawUrl);
        setEngine("");
        setMode("direct");
        return;
      }

      // 6. Scrape page
      setDiscoverMsg("Extracting stream from page…");
      const result = await scrapeDirectUrl(rawUrl, ctrl.signal);
      if (ctrl.signal.aborted) return;

      if (result?.errorType === "archive") {
        setEngine("ARCHIVE");
        setUnsupportedInfo({
          ext: "ARCHIVE",
          isMagnet: false,
          isStreamableExternal: false,
          title: "Downloadable Archive Detected",
          reason: "This URL points to an archive file rather than a playable video stream.",
        });
        setMode("unsupported");
        return;
      }

      if (result?.streamUrl) {
        probeDirectSource(result.streamUrl);
        setDirectUrl(result.streamUrl);
        setEngine("Scraped");
        setMode("direct");
        return;
      }

      // 7. Embed fallback
      setDiscoverMsg("Opening in embedded player…");
      setIframeUrl(rawUrl);
      setEngine("Embed");
      setMode("iframe");
    };

    discover().catch(() => {
      if (!ctrl.signal.aborted) {
        setMode("error");
        setError("Failed to load source.");
      }
    });

    return () => ctrl.abort();
  }, [
    currentIndex,
    rawUrl,
    currentTitle,
    parsedMeta,
    initProxyMedia,
    fetchMediaProbe,
    currentEp,
    propQualities,
    propAudioTracks,
  ]);

  // ── Init direct video engine + HLS Quality/Audio/Subtitle tracks ──────
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;
    const video = videoRef.current;
    try { hlsRef.current?.destroy(); } catch {}
    hlsRef.current = null;

    if (RE_HLS.test(directUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          maxBufferLength: 60,
          startFragPrefetch: true,
          fragLoadingTimeOut: 25000,
          manifestLoadingTimeOut: 20000,
        });
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setIsBuffering(false);
          if (pendingSeekRef.current !== null) {
            video.currentTime = pendingSeekRef.current;
            pendingSeekRef.current = null;
          }
          if (!showResumeRef.current) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
          if (data?.levels?.length > 1) {
            const levels = data.levels.map((lvl, idx) => ({
              id: idx,
              label: lvl.height ? `${lvl.height}p` : `${Math.round((lvl.bitrate || 0) / 1000)} kbps`,
            }));
            setQualityList([{ id: -1, label: "Auto" }, ...levels]);
            setActiveQuality(-1);
          }
        });

        hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
          const details = data?.details;
          const playlistDuration = Number(details?.totalduration);
          if (
            Number.isFinite(playlistDuration) &&
            playlistDuration > 0 &&
            (details.live === false || details.endList)
          ) {
            setKnownDuration((known) => Math.max(known, playlistDuration));
          }
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
          if (data?.audioTracks?.length > 1) {
            setAudioList(
              data.audioTracks.map((t, idx) => ({
                id: idx,
                label: t.name || t.lang || `Audio ${idx + 1}`,
                lang: t.lang || "",
                source: "hls",
              }))
            );
            setActiveAudio(hls.audioTrack >= 0 ? hls.audioTrack : 0);
          }
        });

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
          if (data?.subtitleTracks?.length > 0) {
            const hlsSubs = data.subtitleTracks.map((t, idx) => ({
              id: `hls-${idx}`,
              hlsIdx: idx,
              label: t.name || t.lang || `Track ${idx + 1}`,
              lang: t.lang || "",
              source: "hls",
            }));
            const activeTrack = hls.subtitleTrack;
            if (activeTrack >= 0) setActiveSub(`hls-${activeTrack}`);
            setSubtitleList((prev) => [
              ...prev.filter((s) => ["prop", "upload", "proxy-sub"].includes(s.source)),
              ...hlsSubs,
            ]);
          }
        });

        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) {
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else setError("HLS stream error.");
          }
        });
        if (!directUrl.includes("/api/hls/")) setEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        if (!showResumeRef.current) video.play().catch(() => {});
        setEngine("HLS-Native");
      } else {
        setError("HLS not supported on this browser.");
      }
    } else if (RE_DASH.test(directUrl)) {
      video.src = directUrl;
      video.load();
      if (!showResumeRef.current) video.play().catch(() => {});
      setEngine("DASH");
    } else {
      video.src = directUrl;
      video.load();
      if (!showResumeRef.current) video.play().catch(() => {});
      setEngine((currentEngine) => currentEngine || (RE_MKV_AVI.test(directUrl) ? "MKV" : "Native"));
    }

    return () => {
      try { hlsRef.current?.destroy(); } catch {}
      hlsRef.current = null;
    };
  }, [mode, directUrl]);

  // ── Detect Native HTML5 Audio & Subtitle Tracks ────────────────────────
  const syncNativeTracks = useCallback(() => {
    const v = videoRef.current;
    if (!v || hlsRef.current) return;

    if (v.audioTracks && v.audioTracks.length > 0 && propAudioTracks.length === 0) {
      const list = [];
      for (let i = 0; i < v.audioTracks.length; i++) {
        const t = v.audioTracks[i];
        const fallbackLang = parsedMeta.detectedAudio[i]?.label;
        list.push({
          id: i,
          label: t.label || fallbackLang || t.language || `Audio ${i + 1}`,
          lang: t.language || parsedMeta.detectedAudio[i]?.lang || "",
          source: "native",
        });
        if (t.enabled) setActiveAudio(i);
      }
      setAudioList(list);
      setTrackNotice("");
    }

    if (v.textTracks && v.textTracks.length > 0) {
      const nativeSubs = [];
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i];
        if (t.kind === "subtitles" || t.kind === "captions") {
          nativeSubs.push({
            id: `native-${i}`,
            nativeIdx: i,
            label: t.label || t.language || `Embedded Sub ${i + 1}`,
            lang: t.language || "",
            source: "native",
          });
        }
      }
      if (nativeSubs.length > 0) {
        setSubtitleList((prev) => {
          const customOnly = prev.filter((s) => ["prop", "upload", "proxy-sub"].includes(s.source));
          const merged = [...customOnly];
          nativeSubs.forEach((ns) => {
            if (!merged.some((m) => m.label === ns.label)) merged.push(ns);
          });
          return merged;
        });
      }
    }
  }, [propAudioTracks.length, parsedMeta]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTrackAdded = () => syncNativeTracks();
    v.audioTracks?.addEventListener?.("addtrack", onTrackAdded);
    v.textTracks?.addEventListener?.("addtrack", onTrackAdded);
    return () => {
      v.audioTracks?.removeEventListener?.("addtrack", onTrackAdded);
      v.textTracks?.removeEventListener?.("addtrack", onTrackAdded);
    };
  }, [mode, syncNativeTracks]);

  // ── Gear Menu Selection Handlers ──────────────────────────────────────
  const handleSelectQuality = useCallback((item) => {
    setActiveQuality(item.id);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = item.id;
    } else if (item.url && videoRef.current) {
      const v = videoRef.current;
      pendingSeekRef.current = v.currentTime;
      setDirectUrl(item.url);
    }
    setSettingsTab("main");
  }, []);

  const handleSelectAudio = useCallback((item) => {
    setActiveAudio(item.id);
    const v = videoRef.current;

    if (item.source === "proxy" && item.baseStreamUrl && v) {
      const seekSec = Math.floor(v.currentTime || 0);
      pendingSeekRef.current = seekSec;
      setIsBuffering(true);
      setDirectUrl(`${item.baseStreamUrl}&start=${seekSec}`);
    } else if (hlsRef.current) {
      hlsRef.current.audioTrack = item.id;
    } else if (v?.audioTracks && v.audioTracks.length > item.id) {
      for (let i = 0; i < v.audioTracks.length; i++) {
        v.audioTracks[i].enabled = i === item.id;
      }
    } else if (item.url && v) {
      pendingSeekRef.current = v.currentTime;
      setDirectUrl(item.url);
    } else if (item.source === "detected") {
      setTrackNotice(`Start the Node.js media proxy (port 4000) to switch to "${item.label}" in-browser, or open in VLC.`);
    }
    setSettingsTab("main");
  }, []);

  const handleSelectSubtitle = useCallback((subItem) => {
    const v = videoRef.current;
    if (!subItem) {
      setActiveSub(-1);
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      if (v?.textTracks) {
        for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = "disabled";
      }
      setSettingsTab("main");
      return;
    }

    setActiveSub(subItem.id);
    if (subItem.source === "hls" && hlsRef.current) {
      hlsRef.current.subtitleTrack = subItem.hlsIdx;
    } else if (v?.textTracks) {
      for (let i = 0; i < v.textTracks.length; i++) {
        const track = v.textTracks[i];
        const match =
          (subItem.source === "native" && i === subItem.nativeIdx) ||
          track.label === subItem.label;
        track.mode = match ? "showing" : "disabled";
      }
    }
    setSettingsTab("main");
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = "disabled";
      }
    }

    if (activeSub === -1) {
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      return;
    }

    const selected = subtitleList.find((sub) => sub.id === activeSub);
    if (!selected) return;
    if (selected.source === "hls" && hlsRef.current) {
      hlsRef.current.subtitleTrack = selected.hlsIdx;
      return;
    }

    const selectedTrack = selected.source === "native"
      ? video.textTracks?.[selected.nativeIdx]
      : subtitleTrackRefs.current.get(selected.id)?.track;
    if (selectedTrack) selectedTrack.mode = "showing";
  }, [activeSub, subtitleList, mode]);

  // ── Autoplay countdown ────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    if (!hasNext || countdownRef.current || endTriggered.current) return;
    endTriggered.current = true;
    setCountdown(5);
    countdownRef.current = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  }, [hasNext]);

  const cancelCountdown = useCallback(() => {
    clearInterval(countdownRef.current);
    countdownRef.current = null;
    setCountdown(null);
    endTriggered.current = false;
  }, []);

  // ── Video events ──────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay    = () => {
      if (showResumeRef.current) {
        v.pause();
        return;
      }
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onPause   = () => setIsPlaying(false);
    const onWait    = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onMeta    = () => {
      syncNativeTracks();
      if (pendingSeekRef.current !== null && !hlsRef.current) {
        v.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (!showResumeRef.current) v.play().catch(() => {});
      }
    };
    const onCanPlay = () => { setError(""); syncNativeTracks(); };
    const onTime    = () => {
      setCurrentTime(v.currentTime);
      if (!showResumeRef.current && Math.abs(v.currentTime - lastSaveRef.current) >= 5) {
        savePos(currentTitle, v.currentTime);
        lastSaveRef.current = v.currentTime;
      }
    };
    const onDur = () => {
      if (isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      syncNativeTracks();
    };
    const onVol = () => { setVolume(v.volume); setIsMuted(v.muted); };
    const onEnd = () => { clearPos(currentTitle); startCountdown(); };
    const onErr = () => {
      if (parsedMeta.isMkv || parsedMeta.isSurround) {
        setUnsupportedInfo({
          ext: getFileExtension(rawUrl),
          isMagnet: false,
          isStreamableExternal: true,
          title: "Open in External Player (MKV / DD5.1)",
          reason:
            "Web browsers cannot decode Dolby Digital (DD5.1) or switch Matroska (.mkv) tracks without the media proxy running. Open in VLC/MX Player or start server.js.",
        });
        setMode("unsupported");
      } else {
        setError("Playback error — codec unsupported or expired link.");
      }
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWait);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("ended", onEnd);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWait);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("error", onErr);
    };
  }, [mode, rawUrl, currentTitle, parsedMeta, startCountdown, syncNativeTracks]);

  // ── Fullscreen listener ───────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    const onFS = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        try { window.screen?.orientation?.unlock?.(); } catch {}
      }
    };
    const onIosBegin = () => setIsFullscreen(true);
    const onIosEnd   = () => setIsFullscreen(false);

    ["fullscreenchange", "webkitfullscreenchange"].forEach((e) => document.addEventListener(e, onFS));
    v?.addEventListener("webkitbeginfullscreen", onIosBegin);
    v?.addEventListener("webkitendfullscreen", onIosEnd);

    return () => {
      ["fullscreenchange", "webkitfullscreenchange"].forEach((e) => document.removeEventListener(e, onFS));
      v?.removeEventListener("webkitbeginfullscreen", onIosBegin);
      v?.removeEventListener("webkitendfullscreen", onIosEnd);
    };
  }, [mode]);

  // ── Auto-scroll episode bar ───────────────────────────────────────────
  useEffect(() => {
    if (!epScrollRef.current || !isSeries) return;
    const active = epScrollRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentIndex, isSeries]);

  // ── Cleanup ───────────────────────────────────────────────────────────
  useEffect(() => () => {
    try { hlsRef.current?.destroy(); } catch {}
    clearTimeout(controlsTimer.current);
    clearTimeout(lockTimer.current);
    clearInterval(countdownRef.current);
    clearTimeout(flashTimer.current);
    clearTimeout(gestureTimer.current);
    discoverAbort.current?.abort();
  }, []);

  const goToEpisode = useCallback((idx) => {
    if (!isSeries || idx < 0 || idx >= playlist.length) return;
    cancelCountdown();
    setCurrentIndex(idx);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setShowResume(false);
    showResumeRef.current = false;
    setResumeTime(0);
    setShowSettings(false);
  }, [isSeries, playlist, cancelCountdown]);

  useEffect(() => {
    if (countdown === 0) goToEpisode(currentIndex + 1);
  }, [countdown, currentIndex, goToEpisode]);

  // ── Playback controls ─────────────────────────────────────────────────
  const showFlash = useCallback((type) => {
    clearTimeout(flashTimer.current);
    setPlayFlash(type);
    setFlashKey((k) => k + 1);
    flashTimer.current = setTimeout(() => setPlayFlash(null), 800);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); showFlash("play"); }
    else          { v.pause(); showFlash("pause"); }
    resetControlsTimer();
  }, [showFlash, resetControlsTimer]);

  const handleSurfaceTap = useCallback(() => {
    if (isLocked) {
      revealLockSign();
      return;
    }
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (isTouch) {
      if (showControls) {
        setShowControls(false);
        clearTimeout(controlsTimer.current);
      } else {
        resetControlsTimer();
      }
    } else {
      togglePlay();
    }
  }, [isLocked, revealLockSign, showSettings, showControls, resetControlsTimer, togglePlay]);

  const seekBy = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    const maxDur = Math.max(v.duration || 0, knownDuration || 0);
    v.currentTime = clamp(v.currentTime + delta, 0, maxDur);
    resetControlsTimer();
  }, [knownDuration, resetControlsTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const setVol = useCallback((val) => {
    const v = videoRef.current;
    if (!v) return;
    const vol = clamp(val);
    v.volume = vol;
    if (vol === 0) v.muted = true;
    else if (v.muted) { v.muted = false; setIsMuted(false); }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const v = videoRef.current;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 900;

    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (el?.requestFullscreen) {
          await el.requestFullscreen();
          if (isMobile) {
            try { await window.screen?.orientation?.lock?.("landscape"); } catch {}
          }
        } else if (el?.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (v?.webkitEnterFullscreen) {
          v.webkitEnterFullscreen();
        }

        setShowSettings(false);
        clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        try { window.screen?.orientation?.unlock?.(); } catch {}
      }
    } catch {
      try {
        v?.webkitEnterFullscreen?.();
        clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
      } catch {}
    }
  }, []);

  // ── Resume & Start Over (Fixed for HLS + Proxy Streams) ───────────────
  const handleResume = useCallback(() => {
    const v = videoRef.current;
    const targetSec = Math.floor(resumeTime);
    setShowResume(false);
    showResumeRef.current = false;
    if (!v) return;

    // If playing via proxy remux, restart FFmpeg directly at resumeTime for instant seek
    const currentAudioObj = audioList.find((a) => a.id === activeAudio);
    if (currentAudioObj?.source === "proxy" && currentAudioObj.baseStreamUrl) {
      pendingSeekRef.current = targetSec;
      setIsBuffering(true);
      setDirectUrl(`${currentAudioObj.baseStreamUrl}&start=${targetSec}`);
      return;
    }

    const performSeek = () => {
      v.currentTime = targetSec;
      setCurrentTime(targetSec);
      v.play().catch(() => {});
    };

    if (v.readyState >= 1 && isFinite(v.duration) && v.duration > 0) {
      performSeek();
    } else {
      pendingSeekRef.current = targetSec;
      v.addEventListener("loadedmetadata", performSeek, { once: true });
      v.play().catch(() => {});
    }
  }, [resumeTime, audioList, activeAudio]);

  const handleStartOver = useCallback(() => {
    const v = videoRef.current;
    setShowResume(false);
    showResumeRef.current = false;
    clearPos(currentTitle);
    pendingSeekRef.current = null;
    if (!v) return;
    v.currentTime = 0;
    setCurrentTime(0);
    v.play().catch(() => {});
  }, [currentTitle]);

  // ── Scrub ─────────────────────────────────────────────────────────────
  const effectiveDuration = Math.max(
    isFinite(duration) ? duration : 0,
    knownDuration || 0
  );

  const getPct = useCallback((clientX) => {
    const t = progressRef.current;
    if (!t) return null;
    return clamp((clientX - t.getBoundingClientRect().left) / t.getBoundingClientRect().width);
  }, []);

  const applySeek = useCallback((pct) => {
    const v = videoRef.current;
    if (!v || effectiveDuration <= 0) return;
    const targetSec = pct * effectiveDuration;
    v.currentTime = targetSec;
    setScrubPct(pct * 100);
    setCurrentTime(targetSec);
  }, [effectiveDuration]);

  const onScrubStart = useCallback((e) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    clearTimeout(controlsTimer.current);
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const p = getPct(x);
    if (p !== null) applySeek(p);
    try { progressRef.current?.setPointerCapture(e.pointerId); } catch {}
  }, [getPct, applySeek]);

  const onScrubMove = useCallback((e) => {
    if (!isScrubbing) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const p = getPct(x);
    if (p !== null) applySeek(p);
  }, [isScrubbing, getPct, applySeek]);

  const onScrubEnd = useCallback((e) => {
    if (!isScrubbing) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    setScrubPct(null);
    resetControlsTimer();
    try { progressRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [isScrubbing, resetControlsTimer]);

  // ── Touch gestures ────────────────────────────────────────────────────
  const onGestureStart = useCallback((e) => {
    if (isLocked || mode !== "direct" || showSettings) return;
    const t = e.target;
    if (t.closest("button") || t.closest(".gp-track") || t.closest(".gp-ctrl-bar") || t.closest(".gp-ep-bar") || t.closest(".gp-settings-menu")) return;
    const touch = e.touches[0];
    const v = videoRef.current;
    gestureRef.current = {
      active: true,
      moved: false,
      startX: touch.clientX,
      startY: touch.clientY,
      type: touch.clientX < window.innerWidth / 2 ? "brightness" : "volume",
      startValue:
        touch.clientX < window.innerWidth / 2
          ? brightness
          : v ? (v.muted ? 0 : v.volume * 100) : volume * 100,
    };
  }, [isLocked, mode, showSettings, brightness, volume]);

  const onGestureMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.active || isLocked) return;
    const touch = e.touches[0];
    const deltaY = g.startY - touch.clientY;
    const absDX = Math.abs(touch.clientX - g.startX);
    if (!g.moved) {
      const absDY = Math.abs(deltaY);
      if (absDY >= 14 && absDY > absDX * 1.5) g.moved = true;
      else if (absDX > 18) { g.active = false; return; }
      else return;
    }
    e.preventDefault();
    const change = deltaY * 0.625;
    if (g.type === "volume") {
      const np = Math.max(0, Math.min(100, g.startValue + change));
      setVol(np / 100);
      setGestureOv({ type: "volume", value: Math.round(np) });
    } else {
      const nb = Math.max(20, Math.min(150, g.startValue + change));
      setBrightness(nb);
      setGestureOv({ type: "brightness", value: Math.round(nb) });
    }
    clearTimeout(gestureTimer.current);
  }, [isLocked, setVol]);

  const onGestureEnd = useCallback(() => {
    const g = gestureRef.current;
    if (g.moved) gestureTimer.current = setTimeout(() => setGestureOv(null), 1600);
    gestureRef.current = { ...g, active: false, moved: false };
  }, []);

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || isLocked) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); if (mode === "direct") togglePlay(); }
      if (e.key === "f") toggleFullscreen();
      if (e.key === "m") toggleMute();
      if (e.key === "ArrowLeft")  { e.preventDefault(); seekBy(-10); }
      if (e.key === "ArrowRight") { e.preventDefault(); seekBy(30); }
      if (e.key === "ArrowUp")    { e.preventDefault(); setVol((videoRef.current?.volume ?? 1) + 0.1); }
      if (e.key === "ArrowDown")  { e.preventDefault(); setVol((videoRef.current?.volume ?? 1) - 0.1); }
      if (e.key === "Escape")     { if (showSettings) setShowSettings(false); else if (document.fullscreenElement) toggleFullscreen(); else onClose?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, isLocked, showSettings, togglePlay, toggleFullscreen, toggleMute, seekBy, setVol, onClose]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard?.writeText(rawUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [rawUrl]);

  // ── Derived values & External Player Deep-Links ───────────────────────
  const progress   = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;
  const displayPct = scrubPct !== null ? scrubPct : progress;
  const ringOffset = countdown !== null ? ((5 - countdown) / 5) * 125.7 : 0;
  const gestureBarH = gestureOv
    ? gestureOv.type === "brightness"
      ? Math.min(100, Math.max(0, (gestureOv.value - 20) / 1.3))
      : Math.min(100, Math.max(0, gestureOv.value))
    : 0;
  const episodeLabel = isSeries
    ? currentEp.episode ? `S${currentEp.season ?? 1} · E${currentEp.episode}` : `Ep ${currentIndex + 1}`
    : null;

  const ctrlVisible    = (showControls || isScrubbing) && !isLocked;
  const EP_BAR_H       = isSeries ? 64 : 0;
  const externalVlc    = `vlc://${rawUrl.replace(/^https?:\/\//i, "")}`;
  const externalMx     = `intent:${rawUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(currentTitle)};end`;
  const externalInfuse = `infuse://x-callback-url/play?url=${encodeURIComponent(rawUrl)}`;
  const mountedTracks  = subtitleList.filter(
    (s) => (s.source === "prop" || s.source === "upload" || s.source === "proxy-sub") && s.src
  );

  const isIos     = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);

  const currentQualityLabel =
    qualityList.find((q) => q.id === activeQuality)?.label || (activeQuality === -1 ? "Auto" : "Default");
  const currentAudioLabel =
    audioList.find((a) => a.id === activeAudio)?.label || "Default";
  const currentSubLabel =
    activeSub === -1 ? "Off" : subtitleList.find((s) => s.id === activeSub)?.label || "On";

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="gp-root"
      style={S.root}
      onMouseMove={() => {
        if (isLocked) revealLockSign();
        else resetControlsTimer();
      }}
      onTouchStart={onGestureStart}
      onTouchMove={onGestureMove}
      onTouchEnd={onGestureEnd}
    >
      <input
        ref={subFileInput}
        type="file"
        accept=".srt,.vtt,text/vtt"
        style={{ display: "none" }}
        onChange={handleSubtitleUpload}
      />

      {/* ── DIRECT VIDEO ── */}
      {(mode === "direct" || mode === "discovering") && (
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          style={{
            ...S.video,
            objectFit: isStretched ? "cover" : "contain",
            filter: brightness !== 100 ? `brightness(${brightness / 100})` : undefined,
            display: mode === "direct" ? "block" : "none",
            bottom: isSeries ? EP_BAR_H : 0,
          }}
          playsInline
          preload="auto"
          webkit-playsinline="true"
          x-webkit-airplay="allow"
          onClick={handleSurfaceTap}
          onCanPlay={() => setError("")}
        >
          {mountedTracks.map((sub) => (
            <track
              key={sub.id}
              ref={(node) => {
                if (node) subtitleTrackRefs.current.set(sub.id, node);
                else subtitleTrackRefs.current.delete(sub.id);
              }}
              kind="subtitles"
              label={sub.label}
              srcLang={sub.lang}
              src={sub.src}
              default={activeSub === sub.id}
            />
          ))}
        </video>
      )}

      {/* ── TRANSPARENT LOCK SHIELD ── */}
      {isLocked && mode === "direct" && (
        <div
          style={S.lockShield}
          onClick={(e) => {
            e.stopPropagation();
            revealLockSign();
          }}
        />
      )}

      {/* ── LOCK PEEK BUTTON ── */}
      {isLocked && mode === "direct" && (
        <button
          style={{
            ...S.lockPeek,
            opacity: showLockBadge ? 1 : 0,
            transform: showLockBadge ? "scale(1)" : "scale(0.88)",
            pointerEvents: showLockBadge ? "auto" : "none",
            transition: "opacity 0.28s ease, transform 0.28s ease",
          }}
          onClick={(e) => {
            e.stopPropagation();
            exitLockMode();
          }}
          title="Unlock Controls"
        >
          <Icons.Unlock />
          <span style={{ fontSize: "0.7rem", fontWeight: 700, marginLeft: 6 }}>Unlock</span>
        </button>
      )}

      {/* ── IFRAME / EMBED ── */}
      {mode === "iframe" && (
        <div style={{ ...S.iframeWrap, bottom: isSeries ? EP_BAR_H : 0 }}>
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            title={currentTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
            style={S.iframe}
            onLoad={() => setError("")}
          />
        </div>
      )}

      {/* ── UNSUPPORTED / EXTERNAL PLAYER LAUNCHER CARD ── */}
      {mode === "unsupported" && unsupportedInfo && (
        <div style={S.cardOverlay}>
          <div style={S.glassCard}>
            <div style={S.warnIconWrap}>
              {unsupportedInfo.isStreamableExternal ? <Icons.External /> : <Icons.Archive />}
            </div>
            <span style={S.pillBadge}>{unsupportedInfo.ext}</span>
            <h3 style={S.cardTitle}>{unsupportedInfo.title}</h3>
            <p style={S.cardFile} title={currentTitle}>{currentTitle}</p>
            <p style={S.cardReason}>{unsupportedInfo.reason}</p>

            {unsupportedInfo.isStreamableExternal ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                <div style={S.cardActions}>
                  <a href={externalVlc} style={{ ...S.actionBtn, ...S.actionPrimary }}>
                    <Icons.External /> Open in VLC
                  </a>
                  {isAndroid && (
                    <a href={externalMx} style={{ ...S.actionBtn, ...S.actionSecondary }}>
                      MX Player
                    </a>
                  )}
                  {isIos && (
                    <a href={externalInfuse} style={{ ...S.actionBtn, ...S.actionSecondary }}>
                      Infuse
                    </a>
                  )}
                </div>
                <div style={S.cardActions}>
                  <button style={{ ...S.actionBtn, ...S.actionSecondary }} onClick={handleCopyUrl}>
                    <Icons.Copy /> {copied ? "Copied Link!" : "Copy Link"}
                  </button>
                  <a href={rawUrl} target="_blank" rel="noreferrer" download style={{ ...S.actionBtn, ...S.actionSecondary }}>
                    <Icons.Download /> Download
                  </a>
                </div>
              </div>
            ) : (
              <div style={S.cardActions}>
                <a
                  href={rawUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  style={{ ...S.actionBtn, ...S.actionPrimary }}
                >
                  <Icons.Download /> {unsupportedInfo.isMagnet ? "Open Magnet" : `Download ${unsupportedInfo.ext}`}
                </a>
                <button style={{ ...S.actionBtn, ...S.actionSecondary }} onClick={handleCopyUrl}>
                  <Icons.Copy /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DISCOVERING SPINNER ── */}
      {mode === "discovering" && (
        <div style={S.loaderWrap}>
          <div style={S.spinWrap}>
            <div style={{ ...S.spinRing, ...S.sr1 }} />
            <div style={{ ...S.spinRing, ...S.sr2 }} />
            <div style={{ ...S.spinRing, ...S.sr3 }} />
            <div style={S.spinDot} />
          </div>
          <p style={S.loaderText}>{discoverMsg}</p>
        </div>
      )}

      {/* ── BUFFERING RING ── */}
      {mode === "direct" && isBuffering && (
        <div style={S.bufWrap}><div style={S.bufRing} /></div>
      )}

      {/* ── PLAY/PAUSE FLASH ── */}
      {playFlash && mode === "direct" && (
        <div key={flashKey} style={S.flash}>
          <div style={{ ...S.flashRing, ...(playFlash === "pause" ? S.flashRingPause : {}) }} />
          <div style={S.flashIcon}>{playFlash === "play" ? <Icons.Play /> : <Icons.Pause />}</div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div
        className="gp-header"
        style={{
          ...S.header,
          opacity: ctrlVisible || mode === "iframe" || mode === "unsupported" ? 1 : 0,
          pointerEvents: ctrlVisible || mode === "iframe" || mode === "unsupported" ? "auto" : "none",
          transition: "opacity 0.28s ease",
        }}
      >
        {onClose && (
          <button style={S.backBtn} onClick={onClose} aria-label="Back">
            <Icons.Back />
            <span className="gp-hide-xs" style={{ fontSize: "0.75rem", fontWeight: 700, marginLeft: 4 }}>Back</span>
          </button>
        )}

        <div style={S.titleRow}>
          <span className="gp-title-text" style={S.titleText}>{currentTitle}</span>
          {episodeLabel && <span style={S.epBadge}>{episodeLabel}</span>}
          {engine && <span className="gp-hide-xs" style={S.engineBadge}>{engine}</span>}
        </div>

        <div style={S.topRight}>
          {mode === "iframe" && (
            <div
              className="gp-hide-xs"
              style={{
                ...S.adBadge,
                ...(adBlockStatus === "cross-origin" ? S.adBadgePartial : {}),
              }}
            >
              <Icons.Shield />
              <span style={{ fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.5px" }}>
                {adBlockStatus === "injected" ? "AD BLOCK" : "POPUPS OFF"}
              </span>
            </div>
          )}

          {mode === "direct" && (
            <>
              <button
                style={{ ...S.cornerBtn, ...(isStretched ? S.cornerActive : {}) }}
                onClick={() => { setIsStretched((s) => !s); resetControlsTimer(); }}
                title="Aspect Fill / Fit"
              >
                <Icons.Stretch />
              </button>

              <button style={S.cornerBtn} onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
                {isMuted || volume === 0 ? <Icons.Mute /> : volume < 0.5 ? <Icons.VolumeDown /> : <Icons.VolumeUp />}
              </button>

              <div style={{ position: "relative" }}>
                <button
                  style={{ ...S.cornerBtn, ...(showSettings ? S.cornerActive : {}) }}
                  onClick={() => {
                    setShowSettings((s) => !s);
                    setSettingsTab("main");
                  }}
                  title="Settings (Quality, Audio, Subtitles)"
                  aria-label="Settings"
                >
                  <Icons.Gear />
                </button>

                {showSettings && (
                  <div className="gp-settings-menu" style={S.settingsMenu} onClick={(e) => e.stopPropagation()}>
                    {settingsTab === "main" && (
                      <>
                        <div style={S.menuHeader}>Settings</div>

                        <button style={S.menuRow} onClick={() => setSettingsTab("quality")}>
                          <span style={S.menuRowLeft}>
                            <Icons.Quality />
                            <span>Quality</span>
                          </span>
                          <span style={S.menuRowRight}>
                            <span>{currentQualityLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button style={S.menuRow} onClick={() => setSettingsTab("audio")}>
                          <span style={S.menuRowLeft}>
                            <Icons.Language />
                            <span>Audio</span>
                          </span>
                          <span style={S.menuRowRight}>
                            <span>{currentAudioLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button style={S.menuRow} onClick={() => setSettingsTab("subtitles")}>
                          <span style={S.menuRowLeft}>
                            <Icons.Subtitles />
                            <span>Subtitles</span>
                          </span>
                          <span style={S.menuRowRight}>
                            <span>{currentSubLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>
                      </>
                    )}

                    {settingsTab === "quality" && (
                      <>
                        <button style={S.menuBackRow} onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Video Quality</span>
                        </button>
                        {qualityList.length > 0 ? (
                          qualityList.map((q) => (
                            <button key={q.id} style={S.menuOptionRow} onClick={() => handleSelectQuality(q)}>
                              <span>{q.label}</span>
                              {activeQuality === q.id && <span style={{ color: C.red }}><Icons.Check /></span>}
                            </button>
                          ))
                        ) : (
                          <div style={S.menuEmpty}>Auto (Source Default)</div>
                        )}
                      </>
                    )}

                    {settingsTab === "audio" && (
                      <>
                        <button style={S.menuBackRow} onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Audio Language</span>
                        </button>
                        {audioList.length > 0 ? (
                          audioList.map((a) => (
                            <button key={a.id} style={S.menuOptionRow} onClick={() => handleSelectAudio(a)}>
                              <span>{a.label}</span>
                              {activeAudio === a.id && <span style={{ color: C.red }}><Icons.Check /></span>}
                            </button>
                          ))
                        ) : (
                          <div style={S.menuEmpty}>Original Audio Track</div>
                        )}

                        {trackNotice && (
                          <div style={S.menuNotice}>
                            <p style={{ margin: "0 0 8px", lineHeight: 1.4 }}>{trackNotice}</p>
                            <a href={externalVlc} style={S.menuVlcBtn}>
                              <Icons.External /> Open in VLC
                            </a>
                          </div>
                        )}
                      </>
                    )}

                    {settingsTab === "subtitles" && (
                      <>
                        <button style={S.menuBackRow} onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Subtitles / CC</span>
                        </button>
                        <button style={S.menuOptionRow} onClick={() => handleSelectSubtitle(null)}>
                          <span>Off</span>
                          {activeSub === -1 && <span style={{ color: C.red }}><Icons.Check /></span>}
                        </button>
                        {subtitleList.map((sub) => (
                          <button key={sub.id} style={S.menuOptionRow} onClick={() => handleSelectSubtitle(sub)}>
                            <span>{sub.label}</span>
                            {activeSub === sub.id && <span style={{ color: C.red }}><Icons.Check /></span>}
                          </button>
                        ))}
                        {subtitleList.length === 0 && (
                          <div style={S.menuEmpty}>No embedded subtitles found</div>
                        )}
                        <button
                          style={S.menuUploadBtn}
                          onClick={() => subFileInput.current?.click()}
                        >
                          <Icons.Upload /> Load Subtitle (.srt / .vtt)
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button style={S.cornerBtn} onClick={enterLockMode} title="Lock Screen">
                <Icons.Lock />
              </button>
            </>
          )}

          {mode !== "unsupported" && (
            <button style={S.cornerBtn} onClick={toggleFullscreen} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Icons.FullscreenExit /> : <Icons.Fullscreen />}
            </button>
          )}
        </div>
      </div>

      {/* ── CENTER CONTROLS ── */}
      {mode === "direct" && !isLocked && !showResume && countdown === null && (
        <div
          style={{
            ...S.centerControls,
            bottom: isSeries ? EP_BAR_H : 0,
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? "auto" : "none",
            transition: "opacity 0.25s",
          }}
        >
          {hasPrev && (
            <button className="gp-side-btn" style={S.sideBtn} onClick={() => goToEpisode(currentIndex - 1)}>
              <Icons.Prev /><span style={S.ovLabel}>Prev</span>
            </button>
          )}
          <button className="gp-side-btn" style={S.sideBtn} onClick={() => seekBy(-10)}>
            <Icons.Rewind /><span style={S.ovLabel}>10s</span>
          </button>
          <button className="gp-play-btn" style={S.playBtn} onClick={togglePlay}>
            {isPlaying ? <Icons.Pause /> : <Icons.Play />}
          </button>
          <button className="gp-side-btn" style={S.sideBtn} onClick={() => seekBy(30)}>
            <Icons.Forward /><span style={S.ovLabel}>30s</span>
          </button>
          {hasNext && (
            <button className="gp-side-btn" style={S.sideBtn} onClick={() => goToEpisode(currentIndex + 1)}>
              <Icons.Next /><span style={S.ovLabel}>Next</span>
            </button>
          )}
        </div>
      )}

      {/* ── GESTURE OVERLAYS ── */}
      {gestureOv && !isLocked && (
        <div style={{ ...S.gesturePanel, ...(gestureOv.type === "brightness" ? { left: 18 } : { right: 18 }) }}>
          <span style={{ opacity: 0.85 }}>
            {gestureOv.type === "brightness" ? <Icons.Sun /> : gestureOv.value === 0 ? <Icons.Mute /> : <Icons.VolumeUp />}
          </span>
          <div style={S.gestureTrack}>
            <div
              style={{
                ...S.gestureFill,
                height: `${gestureBarH}%`,
                background: gestureOv.type === "brightness" ? "rgba(255,255,255,0.92)" : C.red,
              }}
            />
          </div>
          <span style={{ fontSize: "0.62rem", fontWeight: 700, fontFamily: F.mono }}>{gestureOv.value}%</span>
        </div>
      )}

      {/* ── RESUME PROMPT ── */}
      {showResume && mode === "direct" && (
        <div style={S.cardOverlay}>
          <div style={S.glassCard}>
            <div style={S.resumeIcon}><Icons.Play /></div>
            <h3 style={S.cardTitle}>Continue Watching?</h3>
            <p style={S.resumeSub}>Paused at {fmt(resumeTime)}</p>
            <div style={S.resumeBar}>
              <div
                style={{
                  ...S.resumeBarFill,
                  width: effectiveDuration > 0 ? `${Math.min(100, (resumeTime / effectiveDuration) * 100)}%` : "30%",
                }}
              />
            </div>
            <div style={S.cardActions}>
              <button style={{ ...S.actionBtn, ...S.actionPrimary }} onClick={handleResume}>
                <Icons.Play /> Resume
              </button>
              <button style={{ ...S.actionBtn, ...S.actionSecondary }} onClick={handleStartOver}>
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AUTOPLAY COUNTDOWN ── */}
      {countdown !== null && hasNext && (
        <div style={S.cardOverlay}>
          <div style={S.glassCard}>
            <p style={S.apLabel}>Up Next</p>
            <p style={S.apTitle}>{playlist[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}</p>
            <div style={S.apRing}>
              <svg viewBox="0 0 48 48" width={62} height={62} style={{ transform: "rotate(-90deg)" }}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke="#e50914"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray="125.7"
                  strokeDashoffset={125.7 - ringOffset}
                  style={{ filter: "drop-shadow(0 0 6px rgba(229,9,20,0.55))", transition: "stroke-dashoffset 0.92s linear" }}
                />
              </svg>
              <span style={S.apNum}>{countdown}</span>
            </div>
            <p style={S.apHint}>Auto-playing in {countdown}s</p>
            <div style={S.cardActions}>
              <button style={S.apNow} onClick={() => { cancelCountdown(); goToEpisode(currentIndex + 1); }}>
                <Icons.Play /> Play Now
              </button>
              <button style={{ ...S.actionBtn, ...S.actionSecondary }} onClick={cancelCountdown}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONTROLS BAR ── */}
      {mode === "direct" && (
        <div
          className="gp-ctrl-bar"
          style={{
            ...S.ctrlBar,
            bottom: isSeries ? EP_BAR_H : 0,
            paddingBottom: isSeries ? 10 : "max(14px, env(safe-area-inset-bottom))",
            opacity: ctrlVisible ? 1 : 0,
            pointerEvents: ctrlVisible ? "auto" : "none",
            transition: "opacity 0.28s ease",
          }}
        >
          <div style={S.progressRow}>
            <span style={S.timeLabel}>{fmt(currentTime)}</span>
            <div
              ref={progressRef}
              className="gp-track"
              style={S.track}
              onPointerDown={onScrubStart}
              onPointerMove={onScrubMove}
              onPointerUp={onScrubEnd}
              onPointerCancel={onScrubEnd}
            >
              <div style={S.trackBg} />
              <div style={{ ...S.trackFill, width: `${displayPct}%` }} />
              <div
                style={{
                  ...S.trackThumb,
                  left: `${displayPct}%`,
                  transform: isScrubbing ? "translate(-50%,-50%) scale(1.35)" : "translate(-50%,-50%)",
                }}
              />
            </div>
            <span style={S.timeLabel}>{fmt(effectiveDuration)}</span>
          </div>

          <div className="gp-vol-row" style={S.volRow}>
            <button style={S.miniIconBtn} onClick={toggleMute} aria-label="Toggle Mute">
              {isMuted || volume === 0 ? <Icons.Mute /> : <Icons.VolumeUp />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              className="gp-vol"
              style={S.volSlider}
              aria-label="Volume"
            />
          </div>
        </div>
      )}

      {/* ── EPISODE BAR ── */}
      {isSeries && (
        <div
          className="gp-ep-bar"
          style={{
            ...S.epBar,
            opacity: ctrlVisible || mode === "iframe" ? 1 : 0,
            pointerEvents: ctrlVisible || mode === "iframe" ? "auto" : "none",
            transition: "opacity 0.28s ease",
          }}
        >
          <button
            style={{ ...S.epNav, opacity: hasPrev ? 1 : 0.25 }}
            onClick={() => hasPrev && goToEpisode(currentIndex - 1)}
            disabled={!hasPrev}
          >
            <Icons.ChevronLeft />
          </button>

          <div ref={epScrollRef} style={S.epScroll}>
            {playlist.map((ep, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={ep.id || idx}
                  data-active={isActive}
                  style={{
                    ...S.epDot,
                    ...(isActive ? S.epDotActive : {}),
                    transform: isActive ? "scale(1.06)" : "scale(1)",
                    transition: "transform 0.18s ease, background 0.18s ease",
                  }}
                  onClick={() => goToEpisode(idx)}
                  title={ep.title || `Episode ${idx + 1}`}
                >
                  <span style={S.epDotNum}>{ep.episode || idx + 1}</span>
                  {isActive && <span style={S.epDotBar} />}
                </button>
              );
            })}
          </div>

          <button
            style={{ ...S.epNav, opacity: hasNext ? 1 : 0.25 }}
            onClick={() => hasNext && goToEpisode(currentIndex + 1)}
            disabled={!hasNext}
          >
            <Icons.ChevronRight />
          </button>
        </div>
      )}

      {/* ── ERROR TOAST ── */}
      {error && mode !== "unsupported" && (
        <div style={{ ...S.errorToast, bottom: isSeries ? EP_BAR_H + 14 : 92 }}>
          <Icons.Warning />
          <span style={{ flex: 1, lineHeight: 1.35 }}>{error}</span>
          <a href={externalVlc} style={S.dlBtn} title="Open in VLC Player">
            <Icons.External /> VLC
          </a>
          <a href={rawUrl} target="_blank" rel="noreferrer" download style={S.dlBtn}>
            <Icons.Download /> Save
          </a>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

// ─── Keyframes & Responsive CSS ───────────────────────────────────────────────
const CSS = `
@keyframes gp-spin       { to { transform: rotate(360deg); } }
@keyframes gp-spin-rev   { to { transform: rotate(-360deg); } }
@keyframes gp-dot        { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(-50%,-50%) scale(0.3);opacity:0.2} }
@keyframes gp-flash-ring { 0%{opacity:0;transform:scale(0.4) rotate(-8deg)}14%{opacity:1;transform:scale(1.1) rotate(1deg)}50%{opacity:1;transform:scale(1.02)}100%{opacity:0;transform:scale(1.35)} }
@keyframes gp-flash-icon { 0%{opacity:0;transform:scale(0.4)}32%{opacity:1;transform:scale(1.2)}55%{transform:scale(0.95)}100%{opacity:0;transform:scale(1.1)} }
@keyframes gp-text-pulse { 0%,100%{opacity:0.35}50%{opacity:0.8} }

input[type=range].gp-vol {
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,0.2);
  border-radius: 999px;
}
input[type=range].gp-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e50914;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(229,9,20,0.6);
}
input[type=range].gp-vol::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e50914;
  border: none;
  cursor: pointer;
}
.gp-ep-bar::-webkit-scrollbar { display: none; }

video::cue {
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: clamp(0.9rem, 2.2vw, 1.35rem);
  text-shadow: 0 2px 4px rgba(0,0,0,0.9);
}

@media (max-width: 640px) {
  .gp-hide-xs { display: none !important; }
  .gp-header {
    padding-top: max(10px, env(safe-area-inset-top)) !important;
    padding-left: max(10px, env(safe-area-inset-left)) !important;
    padding-right: max(10px, env(safe-area-inset-right)) !important;
    height: auto !important;
    min-height: 60px !important;
    gap: 6px !important;
  }
  .gp-title-text {
    max-width: 30vw !important;
    font-size: 0.82rem !important;
  }
  .gp-side-btn {
    width: 48px !important;
    height: 48px !important;
    border-radius: 12px !important;
    font-size: 15px !important;
  }
  .gp-play-btn {
    width: 58px !important;
    height: 58px !important;
    font-size: 22px !important;
  }
  .gp-vol-row {
    max-width: 170px !important;
  }
  .gp-settings-menu {
    width: 245px !important;
    right: -36px !important;
  }
}
`;

// ─── Style constants ──────────────────────────────────────────────────────────
const C = {
  red: "#e50914",
  redB: "#ff2535",
  redD: "rgba(229,9,20,0.20)",
  g01: "rgba(14,14,14,0.74)",
  g02: "rgba(16,16,16,0.90)",
  gb: "rgba(255,255,255,0.14)",
  text: "#f0f0f0",
  dim: "rgba(255,255,255,0.58)",
  muted: "rgba(255,255,255,0.36)",
};
const F = {
  font: "'Inter', 'Sora', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
};
const r = (v) => ({ borderRadius: v });
const abs = { position: "absolute" };

const S = {
  root: {
    position: "fixed",
    inset: 0,
    width: "100vw",
    height: "100dvh",
    background: "#000",
    overflow: "hidden",
    fontFamily: F.font,
    zIndex: 99999,
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  },
  video: {
    ...abs,
    top: 0,
    left: 0,
    right: 0,
    width: "100%",
    height: "100%",
    background: "#000",
    display: "block",
    cursor: "pointer",
  },
  iframeWrap: { ...abs, top: 0, left: 0, right: 0 },
  iframe: { width: "100%", height: "100%", border: "none", background: "#000", display: "block" },

  loaderWrap: { ...abs, inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, zIndex: 200 },
  spinWrap: { position: "relative", width: 56, height: 56 },
  spinRing: { ...abs, borderRadius: "50%", border: "2px solid transparent" },
  sr1: { inset: 0, borderTopColor: C.red, borderRightColor: "rgba(229,9,20,0.18)", animation: "gp-spin 0.82s ease-in-out infinite" },
  sr2: { inset: 9, borderTopColor: "rgba(229,9,20,0.42)", animation: "gp-spin-rev 1.08s ease-in-out infinite" },
  sr3: { inset: 18, borderTopColor: "rgba(229,9,20,0.20)", animation: "gp-spin 1.42s ease-in-out infinite" },
  spinDot: { ...abs, width: 8, height: 8, background: C.red, borderRadius: "50%", top: "50%", left: "50%", animation: "gp-dot 1.1s ease-in-out infinite" },
  loaderText: { color: C.muted, fontSize: "0.62rem", fontFamily: F.mono, letterSpacing: "2px", fontWeight: 500, textTransform: "uppercase", animation: "gp-text-pulse 2s ease-in-out infinite" },

  bufWrap: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 190, pointerEvents: "none" },
  bufRing: { width: 44, height: 44, border: "2.5px solid rgba(255,255,255,0.08)", borderTopColor: C.red, borderRadius: "50%", animation: "gp-spin 0.68s linear infinite" },

  flash: { ...abs, top: "50%", left: "50%", width: 88, height: 88, marginLeft: -44, marginTop: -44, pointerEvents: "none", zIndex: 380 },
  flashRing: { ...abs, inset: 0, borderRadius: "50%", background: "radial-gradient(ellipse at 36% 28%, rgba(255,68,78,0.95), rgba(225,10,20,0.98))", border: "1px solid rgba(255,255,255,0.45)", animation: "gp-flash-ring 0.78s ease-out forwards", zIndex: 3 },
  flashRingPause: { background: "radial-gradient(ellipse at 36% 28%, rgba(190,190,200,0.95), rgba(110,110,125,0.98))" },
  flashIcon: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 26, animation: "gp-flash-icon 0.68s cubic-bezier(0.34,1.56,0.64,1) forwards", zIndex: 5 },

  header: {
    ...abs,
    top: 0,
    left: 0,
    right: 0,
    height: 76,
    display: "flex",
    alignItems: "center",
    padding: "max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left))",
    gap: 10,
    background: "linear-gradient(180deg, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.62) 60%, transparent 100%)",
    zIndex: 600,
  },
  backBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: C.g01,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    color: "#fff",
    border: "1px solid " + C.gb,
    padding: "9px 13px",
    ...r(999),
    cursor: "pointer",
    flexShrink: 0,
    minHeight: 38,
    minWidth: 38,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  titleText: {
    color: "#fff",
    fontSize: "0.95rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "min(400px, 42vw)",
    letterSpacing: "-0.2px",
    textShadow: "0 2px 14px rgba(0,0,0,0.95)",
  },
  epBadge: { background: "linear-gradient(135deg,#e50914,#b0000e)", color: "#fff", fontSize: "0.55rem", fontWeight: 800, padding: "3px 7px", ...r(5), textTransform: "uppercase", letterSpacing: "0.8px", flexShrink: 0 },
  engineBadge: { background: "rgba(255,255,255,0.07)", color: C.dim, fontSize: "0.55rem", fontWeight: 600, fontFamily: F.mono, padding: "3px 7px", ...r(5), textTransform: "uppercase", letterSpacing: "0.6px", border: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 },
  topRight: { display: "flex", gap: 6, flexShrink: 0, alignItems: "center" },
  cornerBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: C.g01,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: "1px solid " + C.gb,
    color: C.text,
    ...r(10),
    width: 38,
    height: 38,
    cursor: "pointer",
    fontSize: 16,
  },
  cornerActive: { background: "rgba(229,9,20,0.28)", borderColor: "rgba(229,9,20,0.55)", color: "#fff" },

  settingsMenu: {
    ...abs,
    top: 46,
    right: 0,
    width: 265,
    background: "rgba(18, 18, 20, 0.96)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255,255,255,0.14)",
    ...r(14),
    padding: "6px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.9)",
    zIndex: 900,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  menuHeader: {
    fontSize: "0.66rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: C.muted,
    padding: "6px 10px 4px",
  },
  menuRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#fff",
    padding: "10px 10px",
    ...r(9),
    fontSize: "0.78rem",
    fontWeight: 600,
    fontFamily: F.font,
    cursor: "pointer",
  },
  menuRowLeft: { display: "flex", alignItems: "center", gap: 9, fontSize: "0.8rem" },
  menuRowRight: { display: "flex", alignItems: "center", gap: 4, color: C.dim, fontSize: "0.72rem" },
  menuBackRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "none",
    color: "#fff",
    padding: "8px 10px",
    marginBottom: 4,
    ...r(8),
    fontSize: "0.76rem",
    fontWeight: 700,
    fontFamily: F.font,
    cursor: "pointer",
  },
  menuOptionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    background: "transparent",
    border: "none",
    color: C.text,
    padding: "9px 10px",
    ...r(8),
    fontSize: "0.76rem",
    fontWeight: 500,
    fontFamily: F.font,
    cursor: "pointer",
    textAlign: "left",
  },
  menuEmpty: { padding: "8px 10px", fontSize: "0.7rem", color: C.muted, textAlign: "center", lineHeight: 1.4 },
  menuNotice: {
    marginTop: 6,
    padding: "8px 10px",
    background: "rgba(245, 158, 11, 0.12)",
    border: "1px solid rgba(245, 158, 11, 0.28)",
    ...r(8),
    fontSize: "0.68rem",
    color: "#fde68a",
  },
  menuVlcBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    padding: "7px 10px",
    background: C.red,
    color: "#fff",
    ...r(6),
    fontSize: "0.72rem",
    fontWeight: 700,
    textDecoration: "none",
  },
  menuUploadBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    marginTop: 4,
    padding: "8px 10px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#fff",
    ...r(8),
    fontSize: "0.72rem",
    fontWeight: 600,
    fontFamily: F.font,
    cursor: "pointer",
  },

  adBadge: { display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,180,80,0.16)", border: "1px solid rgba(0,200,80,0.35)", color: "#4ade80", ...r(8), padding: "6px 10px", fontSize: 13, flexShrink: 0 },
  adBadgePartial: { background: "rgba(255,180,0,0.14)", border: "1px solid rgba(255,180,0,0.32)", color: "#facc15" },

  lockShield: { ...abs, inset: 0, zIndex: 800, background: "transparent", cursor: "pointer" },
  lockPeek: {
    ...abs,
    top: "max(16px, env(safe-area-inset-top))",
    right: "max(16px, env(safe-area-inset-right))",
    zIndex: 850,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(185, 12, 20, 0.92)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(255,255,255,0.28)",
    color: "#fff",
    ...r(999),
    padding: "0 14px",
    height: 40,
    cursor: "pointer",
    fontSize: 15,
    boxShadow: "0 8px 28px rgba(0,0,0,0.75)",
  },

  centerControls: { ...abs, top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(12px, 2.5vw, 24px)", zIndex: 350, pointerEvents: "none" },
  sideBtn: { display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "#fff", ...r(14), width: 56, height: 56, background: "rgba(22,22,22,0.82)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer", fontSize: 17, boxShadow: "0 10px 26px rgba(0,0,0,0.7)" },
  ovLabel: { fontSize: "0.52rem", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", opacity: 0.85 },
  playBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 66, height: 66, borderRadius: "50%", background: C.red, border: "none", cursor: "pointer", color: "#fff", fontSize: 26, margin: "0 4px", boxShadow: "0 8px 28px rgba(229,9,20,0.45)" },

  gesturePanel: { ...abs, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, background: C.g02, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid " + C.gb, ...r(20), padding: "14px 10px", minWidth: 46, color: "#fff", zIndex: 750, pointerEvents: "none", fontSize: 14 },
  gestureTrack: { width: 5, height: 88, background: "rgba(255,255,255,0.1)", borderRadius: 999, position: "relative", overflow: "hidden" },
  gestureFill: { ...abs, bottom: 0, left: 0, width: "100%", borderRadius: 999, transition: "height 0.04s linear" },

  cardOverlay: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.84)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", zIndex: 460, padding: 16 },
  glassCard: { background: "linear-gradient(160deg, #171717, #0e0e0e)", border: "1px solid rgba(255,255,255,0.12)", ...r(20), padding: "26px 24px", textAlign: "center", maxWidth: 400, width: "100%", boxShadow: "0 32px 84px rgba(0,0,0,0.95)", display: "flex", flexDirection: "column", alignItems: "center" },
  warnIconWrap: { width: 52, height: 52, borderRadius: "50%", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fbbf24", marginBottom: 12, fontSize: 22 },
  pillBadge: { background: "rgba(245,158,11,0.16)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)", fontSize: "0.58rem", fontWeight: 800, fontFamily: F.mono, padding: "3px 9px", ...r(999), letterSpacing: "1px", marginBottom: 10 },
  cardTitle: { color: "#fff", fontSize: "1.05rem", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.3px" },
  cardFile: { color: C.text, fontSize: "0.72rem", fontFamily: F.mono, background: "rgba(255,255,255,0.05)", padding: "6px 10px", ...r(8), width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 10, border: "1px solid rgba(255,255,255,0.06)" },
  cardReason: { color: C.dim, fontSize: "0.78rem", lineHeight: 1.5, margin: "0 0 18px" },
  cardActions: { display: "flex", gap: 8, width: "100%" },
  actionBtn: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, ...r(11), padding: "11px 12px", fontSize: "0.78rem", fontWeight: 700, fontFamily: F.font, minHeight: 42, cursor: "pointer", textDecoration: "none" },
  actionPrimary: { background: `linear-gradient(135deg, ${C.redB}, ${C.red})`, color: "#fff", border: "none", boxShadow: "0 4px 20px rgba(229,9,20,0.32)" },
  actionSecondary: { background: "rgba(255,255,255,0.07)", color: C.text, border: "1px solid rgba(255,255,255,0.12)" },

  resumeIcon: { width: 48, height: 48, borderRadius: "50%", background: "rgba(229,9,20,0.12)", border: "1px solid rgba(229,9,20,0.32)", display: "flex", alignItems: "center", justifyContent: "center", color: C.red, marginBottom: 12, fontSize: 18 },
  resumeSub: { color: C.dim, fontSize: "0.72rem", fontWeight: 500, marginBottom: 12, fontFamily: F.mono },
  resumeBar: { width: "100%", height: 4, background: "rgba(255,255,255,0.08)", ...r(999), overflow: "hidden", marginBottom: 18 },
  resumeBarFill: { height: "100%", background: `linear-gradient(to right, ${C.red}, ${C.redB})`, ...r(999) },

  apLabel: { color: C.red, fontSize: "0.56rem", fontWeight: 800, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 8 },
  apTitle: { color: "#fff", fontSize: "1rem", fontWeight: 800, marginBottom: 16, lineHeight: 1.4 },
  apRing: { position: "relative", width: 62, height: 62, margin: "0 auto 10px" },
  apNum: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.22rem", fontWeight: 900 },
  apHint: { color: C.dim, fontSize: "0.7rem", marginBottom: 14 },
  apNow: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", color: "#000", border: "none", ...r(11), padding: "11px 16px", fontSize: "0.8rem", fontWeight: 800, fontFamily: F.font, cursor: "pointer", minHeight: 44 },

  ctrlBar: {
    ...abs,
    left: 0,
    right: 0,
    zIndex: 600,
    paddingTop: 32,
    paddingLeft: "max(16px, env(safe-area-inset-left))",
    paddingRight: "max(16px, env(safe-area-inset-right))",
    background: "linear-gradient(transparent, rgba(0,0,0,0.92))",
  },
  progressRow: { display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto" },
  timeLabel: { color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: F.mono, minWidth: 46, textAlign: "center", flexShrink: 0 },
  track: { position: "relative", flex: 1, height: 32, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" },
  trackBg: { ...abs, left: 0, right: 0, top: "50%", height: 4, transform: "translateY(-50%)", background: "rgba(255,255,255,0.22)", ...r(999) },
  trackFill: { ...abs, left: 0, top: "50%", height: 4, transform: "translateY(-50%)", background: `linear-gradient(to right, ${C.red}, ${C.redB})`, ...r(999) },
  trackThumb: { ...abs, top: "50%", width: 16, height: 16, background: "#fff", borderRadius: "50%", pointerEvents: "none", boxShadow: "0 2px 10px rgba(0,0,0,0.85), 0 0 0 2.5px rgba(229,9,20,0.45)" },
  volRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, maxWidth: 220, pointerEvents: "auto" },
  miniIconBtn: { background: "none", border: "none", color: "rgba(255,255,255,0.75)", cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center", fontSize: 15 },
  volSlider: { flex: 1, cursor: "pointer", height: 4 },

  epBar: {
    ...abs,
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
    paddingBottom: "env(safe-area-inset-bottom)",
    zIndex: 620,
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingLeft: "max(10px, env(safe-area-inset-left))",
    paddingRight: "max(10px, env(safe-area-inset-right))",
    background: "rgba(5,5,5,0.96)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  epScroll: { display: "flex", gap: 6, overflowX: "auto", flex: 1, scrollbarWidth: "none", WebkitOverflowScrolling: "touch", padding: "6px 2px", alignItems: "center" },
  epDot: {
    position: "relative",
    flexShrink: 0,
    minWidth: 42,
    height: 40,
    padding: "0 10px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    ...r(10),
    color: C.muted,
    fontSize: "0.78rem",
    fontWeight: 700,
    fontFamily: F.mono,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  },
  epDotActive: { background: "rgba(229,9,20,0.20)", borderColor: "rgba(229,9,20,0.6)", color: "#fff", fontWeight: 800 },
  epDotNum: { lineHeight: 1, position: "relative", zIndex: 1 },
  epDotBar: { position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 16, height: 2, background: C.red, borderRadius: 999 },
  epNav: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "50%", color: "#fff", cursor: "pointer", fontSize: 16, flexShrink: 0 },

  errorToast: { ...abs, left: "50%", transform: "translateX(-50%)", background: "rgba(145,10,15,0.96)", backdropFilter: "blur(12px)", color: "#fff", padding: "11px 14px", ...r(12), fontSize: "0.74rem", fontWeight: 600, zIndex: 700, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 10px 36px rgba(0,0,0,0.85)", width: "min(92vw, 480px)", border: "1px solid rgba(255,255,255,0.12)" },
  dlBtn: { display: "inline-flex", alignItems: "center", gap: 4, color: "#fff", background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.18)", ...r(7), padding: "6px 9px", textDecoration: "none", fontSize: "0.68rem", fontWeight: 700, fontFamily: F.font, flexShrink: 0, cursor: "pointer" },
};  