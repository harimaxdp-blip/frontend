import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import {
  detectDirectMediaType,
  MEDIA_PROXY_BASE as PROXY_BASE,
  normalizeLanguageLabel,
  resolveMediaSource,
} from "../utils/mediaSourceResolver";
import "./GlobalPlayer.css";

const EMPTY_LIST = Object.freeze([]);
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
  Play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <path d="M8 5.5v13l10.5-6.5L8 5.5z" />
    </svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <rect x="6.5" y="5" width="4" height="14" rx="1.5" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.5" />
    </svg>
  ),
  Mute: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  ),
  VolumeUp: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
    </svg>
  ),
  VolumeDown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  ),
  Fullscreen: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="#e50914" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <polyline points="15 4 20 4 20 9" />
      <line x1="20" y1="4" x2="14" y2="10" />
      <polyline points="9 20 4 20 4 15" />
      <line x1="4" y1="20" x2="10" y2="14" />
    </svg>
  ),
  FullscreenExit: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="#e50914" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <polyline points="14 10 19 10 19 5" />
      <line x1="14" y1="10" x2="20" y2="4" />
      <polyline points="10 14 5 14 5 19" />
      <line x1="10" y1="14" x2="4" y2="20" />
    </svg>
  ),
  PiP: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <rect x="11.5" y="11" width="7.5" height="6" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  ClockSpeed: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <circle cx="12" cy="12" r="9.5" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  ),
  DoubleRewind: () => (
    <svg viewBox="0 0 36 24" fill="currentColor" width="1em" height="1em">
      <path d="M17.5 4.2v15.6c0 .8-.9 1.3-1.6.8L4.6 12.8c-.6-.4-.6-1.2 0-1.6l11.3-7.8c.7-.5 1.6 0 1.6.8z" />
      <path d="M31.5 4.2v15.6c0 .8-.9 1.3-1.6.8L18.6 12.8c-.6-.4-.6-1.2 0-1.6l11.3-7.8c.7-.5 1.6 0 1.6.8z" />
    </svg>
  ),
  DoubleForward: () => (
    <svg viewBox="0 0 36 24" fill="currentColor" width="1em" height="1em">
      <path d="M4.5 4.2v15.6c0 .8.9 1.3 1.6.8l11.3-7.8c.6-.4.6-1.2 0-1.6L6.1 3.4c-.7-.5-1.6 0-1.6.8z" />
      <path d="M18.5 4.2v15.6c0 .8.9 1.3 1.6.8l11.3-7.8c.6-.4.6-1.2 0-1.6L20.1 3.4c-.7-.5-1.6 0-1.6.8z" />
    </svg>
  ),
  Back: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  Prev: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  ),
  Next: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  ),
  Stretch: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 9h8v6H8z" />
    </svg>
  ),
  Lock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Unlock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  ),
  Gear: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Subtitles: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
    </svg>
  ),
  Language: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  Quality: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 15V9l3 3 3-3v6" />
      <path d="M17 9v6" />
    </svg>
  ),
  Upload: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Sun: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  Warning: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Archive: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  External: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  Copy: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Keyboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
    </svg>
  ),
};

// ─── Watch position helpers ───────────────────────────────────────────────────
function watchKey(t) {
  return `gp-pos-${(t || "u").replace(/\s+/g, "_").toLowerCase()}`;
}
function savePos(t, s) {
  if (!t || !s || s < 5) return;
  try {
    localStorage.setItem(watchKey(t), String(Math.floor(s)));
  } catch {}
}
function loadPos(t) {
  try {
    return parseInt(localStorage.getItem(watchKey(t)) || "0", 10) || 0;
  } catch {
    return 0;
  }
}
function clearPos(t) {
  try {
    localStorage.removeItem(watchKey(t));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL PLAYER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function GlobalPlayer({
  url,
  title,
  description = "",
  brandLogo = "",
  playlist = null,
  startIndex = 0,
  subtitles = EMPTY_LIST,
  audioTracks: propAudioTracks = EMPTY_LIST,
  qualities: propQualities = EMPTY_LIST,
  onClose,
  initialResolution = null,
  initialResolutions = null,
}) {
  const videoRef          = useRef(null);
  const subtitleTrackRefs = useRef(new Map());
  const containerRef      = useRef(null);
  const progressRef       = useRef(null);
  const hlsRef            = useRef(null);
  const iframeRef         = useRef(null);
  const subFileInput      = useRef(null);
  const controlsTimer     = useRef(null);
  const lockTimer         = useRef(null);
  const isScrubbingRef    = useRef(false);
  const lastSaveRef       = useRef(0);
  const pendingSeekRef    = useRef(null);
  const dashRef           = useRef(null);
  const showResumeRef     = useRef(false);
  const gestureRef        = useRef({ active: false, moved: false, type: null, startX: 0, startY: 0, startValue: 0 });
  const gestureTimer      = useRef(null);
  const flashTimer        = useRef(null);
  const countdownRef      = useRef(null);
  const endTriggered      = useRef(false);
  const discoverAbort     = useRef(null);
  const epScrollRef       = useRef(null);
  const tapTimerRef       = useRef(null);
  const lastTapRef        = useRef({ time: 0, side: null });
  const skipRippleTimer   = useRef(null);

  const isSeries = Array.isArray(playlist) && playlist.length > 1;
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  const currentEp = useMemo(
    () => (isSeries ? playlist[currentIndex] || {} : { link: url, title, description }),
    [isSeries, playlist, currentIndex, url, title, description]
  );

  const rawUrl = currentEp.link || currentEp.url || url || "";
  const rawTitleStr = String(currentEp.title ?? title ?? "").trim();
  const currentTitle =
    rawTitleStr && rawTitleStr !== "0" ? rawTitleStr : getCleanFileName(rawUrl);

  const parsedMeta = useMemo(() => parseMediaMetadataFromUrl(rawUrl), [rawUrl]);

  const hasNext = isSeries && currentIndex < playlist.length - 1;
  const hasPrev = isSeries && currentIndex > 0;

  const [mode, setMode]                                 = useState("discovering");
  const [directUrl, setDirectUrl]                       = useState("");
  const [directMediaType, setDirectMediaType]           = useState("");
  const [directReferrerPolicy, setDirectReferrerPolicy] = useState("");
  const [iframeUrl, setIframeUrl]                       = useState("");
  const [embedFallback, setEmbedFallback]               = useState(null);
  const [resolvedFallbackSource, setResolvedFallbackSource] = useState(null);
  const [engine, setEngine]                             = useState("");
  const [discoverMsg, setDiscoverMsg]                   = useState("Detecting stream…");
  const [unsupportedInfo, setUnsupportedInfo]           = useState(null);
  const [copied, setCopied]                             = useState(false);

  const [isPlaying, setIsPlaying]             = useState(false);
  const [currentTime, setCurrentTime]         = useState(0);
  const [duration, setDuration]               = useState(0);
  const [bufferedPct, setBufferedPct]         = useState(0);
  const [knownDuration, setKnownDuration]     = useState(0);
  const [volume, setVolume]                   = useState(1);
  const [isMuted, setIsMuted]                 = useState(false);
  const [volHover, setVolHover]               = useState(false);
  const [playbackRate, setPlaybackRate]       = useState(1);
  const [isBuffering, setIsBuffering]         = useState(false);
  const [isFullscreen, setIsFullscreen]       = useState(false);
  const [isCssFullscreen, setIsCssFullscreen] = useState(false);
  const [isPiP, setIsPiP]                     = useState(false);
  const [showControls, setShowControls]       = useState(true);
  const [isScrubbing, setIsScrubbing]         = useState(false);
  const [scrubPct, setScrubPct]               = useState(null);
  const [hoverTime, setHoverTime]             = useState(null);
  const [isStretched, setIsStretched]         = useState(false);

  const [isLocked, setIsLocked]           = useState(false);
  const [showLockBadge, setShowLockBadge] = useState(false);

  const [showSettings, setShowSettings]   = useState(false);
  const [showSpeedPop, setShowSpeedPop]   = useState(false);
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
  const [skipRipple, setSkipRipple]     = useState(null);
  const [countdown, setCountdown]       = useState(null);
  const [showResume, setShowResume]     = useState(false);
  const [resumeTime, setResumeTime]     = useState(0);
  const adBlockStatus = useAdBlock(iframeRef);

  useEffect(() => {
    showResumeRef.current = showResume;
  }, [showResume]);

  // ── Enforce inline playback attributes directly on DOM node for iOS WebKit ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.setAttribute("playsinline", "true");
    v.setAttribute("webkit-playsinline", "true");
    v.playsInline = true;
    v.controls = false;
  }, [mode, directUrl]);

  // ── Controls hide timer (3.2 seconds) ─────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    if (isScrubbingRef.current || showSettings || showSpeedPop) return;
    controlsTimer.current = setTimeout(() => {
      setShowControls(false);
      setShowSettings(false);
      setShowSpeedPop(false);
    }, 3200);
  }, [showSettings, showSpeedPop]);

  useEffect(() => {
    if (showSettings || showSpeedPop) {
      clearTimeout(controlsTimer.current);
      setShowControls(true);
    } else if (!isLocked) {
      resetControlsTimer();
    }
  }, [showSettings, showSpeedPop, isLocked, resetControlsTimer]);

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
    setShowSpeedPop(false);
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
    if (!probeRes.ok) {
      const error = new Error("Probe failed");
      error.status = probeRes.status;
      throw error;
    }
    const probeData = await probeRes.json();
    if (!signal?.aborted) applyProbeData(probeData, mediaHttpUrl);
    return probeData;
  }, [applyProbeData]);

  // ── Helper: Remux MKV / DD5.1 Directly via Proxy (Single CDN Connection) ──
  const initProxyMedia = useCallback(
    async (mediaHttpUrl, ctrl, startAtSec = 0) => {
      const fallbackLangs = parseMediaMetadataFromUrl(mediaHttpUrl).detectedAudio;
      if (fallbackLangs.length > 0 && propAudioTracks.length === 0) {
        setAudioList(
          fallbackLangs.map((audio, idx) => ({
            id: idx,
            label: audio.label,
            lang: audio.lang,
            source: "proxy",
            baseStreamUrl: `${PROXY_BASE}/api/hls/master.m3u8?url=${encodeURIComponent(mediaHttpUrl)}&audio=${idx}`,
          }))
        );
        setActiveAudio(0);
      }

      setQualityList([{ id: -1, label: "Original" }]);
      setActiveQuality(-1);
      setTrackNotice("");

      setDiscoverMsg("Reading MKV audio & subtitle tracks…");
      fetchMediaProbe(mediaHttpUrl, ctrl.signal).catch(() => {});

      if (ctrl.signal.aborted) return true;

      setDiscoverMsg("Remuxing 4K HEVC & transcoding DD5.1 audio to AAC…");
      const startParam = startAtSec > 0 ? `&start=${Math.floor(startAtSec)}` : "";
      setDirectMediaType("hls");
      setDirectUrl(
        `${PROXY_BASE}/api/hls/master.m3u8?url=${encodeURIComponent(mediaHttpUrl)}&audio=0${startParam}`
      );
      setEngine("HLS-Remux");
      setMode("direct");
      return true;
    },
    [propAudioTracks.length, fetchMediaProbe]
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
    setDirectMediaType("");
    setDirectReferrerPolicy("");
    setIframeUrl("");
    setEmbedFallback(null);
    setResolvedFallbackSource(null);
    setKnownDuration(0);
    setDuration(0);
    setCurrentTime(0);
    setBufferedPct(0);
    setPlaybackRate(1);
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
    setShowSpeedPop(false);
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
            setTrackNotice(`Media proxy (${PROXY_BASE}) is unavailable to switch audio tracks in-browser. Retry or open in VLC.`);
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
            setDirectMediaType(detectDirectMediaType(streamUrl) || "");
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
          reason: `Media proxy (${PROXY_BASE}) could not connect to torrent peers or is waking up. Retry in a few seconds, or open in qBittorrent / Flud.`,
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

      // 3. MKV / AVI / DD5.1 Multi-Audio Live Remux via Backend Proxy
      if (RE_MKV_AVI.test(rawUrl) || parsedMeta.isSurround) {
        await initProxyMedia(rawUrl, ctrl);
        return;
      }

      // Resolve every web source through the common classifier and provider resolver.
      setDiscoverMsg("Checking supported source…");
      const initialForEpisode = initialResolutions?.[currentIndex] ||
        (currentIndex === startIndex ? initialResolution : null);
      const result = initialForEpisode || await resolveMediaSource(rawUrl, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;

      if (result?.status === "resolved" && result.streamUrl) {
        setResolvedFallbackSource(result.provider && result.provider !== "Direct Stream" ? { url: rawUrl, provider: result.provider } : null);
        const providerSubs = (await Promise.all((result.subtitles || []).map(async (sub, idx) => ({
          id: `provider-${currentIndex}-${idx}`,
          label: normalizeLanguageLabel(sub.label, sub.lang, idx),
          lang: sub.lang || "",
          src: await prepareSubtitleSrc(sub.src || sub.url),
          source: "provider",
        })))).filter((sub) => sub.src);
        setSubtitleList((prev) => [
          ...prev.filter((sub) => sub.source !== "provider"),
          ...providerSubs,
        ]);
        if (providerSubs.length && !(currentEp.subtitles?.length || subtitles?.length)) {
          setActiveSub(providerSubs[0].id);
        }
        if (result.audioTracks?.length) {
          setAudioList(result.audioTracks.map((track, idx) => ({
            id: idx,
            label: normalizeLanguageLabel(track.label, track.lang, idx),
            lang: track.lang || "",
            source: "provider",
          })));
        }
        probeDirectSource(result.streamUrl);
        setDirectMediaType(result.mediaType || detectDirectMediaType(result.streamUrl) || "");
        setDirectReferrerPolicy(result.referrerPolicy || "");
        setDirectUrl(result.streamUrl);
        setEngine(result.provider || "Direct Stream");
        setMode("direct");
        return;
      }

      if (result?.status === "unsupported" || result?.status === "error") {
        setError(result.reason || "This source is not supported.");
        setMode("error");
        return;
      }

      setResolvedFallbackSource(null);
      setEmbedFallback({ provider: result?.provider || "External source", reason: result?.fallbackReason || "No supported direct stream was exposed." });
      setDiscoverMsg("Opening the provider's official embed player…");
      setIframeUrl(result?.embedUrl || rawUrl);
      setEngine(result?.provider || "Embed");
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
    subtitles,
    initialResolution,
    initialResolutions,
    startIndex,
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
    try { dashRef.current?.reset(); } catch {}
    dashRef.current = null;
    const fallbackToProvider = () => {
      if (!resolvedFallbackSource) return false;
      setEmbedFallback({
        provider: resolvedFallbackSource.provider,
        reason: "The resolved stream could not be played; returning to the provider player.",
      });
      setIframeUrl(resolvedFallbackSource.url);
      setMode("iframe");
      setError("");
      return true;
    };

    if (directMediaType === "dash" || RE_DASH.test(directUrl)) {
      let disposed = false;
      let dashPlayer = null;
      setDiscoverMsg("Loading DASH playback engine…");
      import("dashjs").then(({ default: dashjs }) => {
        if (disposed) return;
        dashPlayer = dashjs.MediaPlayer().create();
        dashRef.current = dashPlayer;
        dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
          const bitrates = dashPlayer.getBitrateInfoListFor("video") || [];
          if (bitrates.length) {
            setQualityList([
              { id: -1, label: "Auto" },
              ...bitrates.map((item) => ({
                id: item.qualityIndex,
                label: item.height ? `${item.height}p` : `${Math.round((item.bitrate || 0) / 1000)} kbps`,
              })),
            ]);
            setActiveQuality(-1);
          }

          const audioTracks = dashPlayer.getTracksFor("audio") || [];
          setAudioList(audioTracks.map((track, idx) => ({
            id: idx,
            dashTrack: track,
            label: normalizeLanguageLabel(track.lang || track.label, track.lang, idx),
            lang: track.lang || "",
            source: "dash",
          })));

          const textTracks = dashPlayer.getTracksFor("text") || [];
          setSubtitleList((prev) => [
            ...prev.filter((sub) => ["prop", "upload", "proxy-sub", "provider"].includes(sub.source)),
            ...textTracks.map((track, idx) => ({
              id: `dash-${idx}`,
              dashIdx: idx,
              dashTrack: track,
              label: normalizeLanguageLabel(track.lang || track.label, track.lang, idx),
              lang: track.lang || "",
              source: "dash",
            })),
          ]);
        });
        dashPlayer.on(dashjs.MediaPlayer.events.ERROR, () => {
          setError(
            resolvedFallbackSource
              ? "DASH playback failed. Retry or choose the provider player."
              : "DASH playback failed. Check stream availability and CORS access, then retry."
          );
        });
        dashPlayer.initialize(video, directUrl, !showResumeRef.current);
        setEngine("DASH");
      }).catch(() => {
        if (!disposed) setError("The DASH playback engine could not be loaded.");
      });
      return () => {
        disposed = true;
        dashPlayer?.reset();
        if (dashRef.current === dashPlayer) dashRef.current = null;
      };
    }

    if (directMediaType === "hls" || RE_HLS.test(directUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          maxBufferLength: 60,
          startFragPrefetch: true,
          fragLoadingTimeOut: 60000,
          manifestLoadingTimeOut: 95000,
          levelLoadingTimeOut: 60000,
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
                label: normalizeLanguageLabel(t.name, t.lang, idx),
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
              label: normalizeLanguageLabel(t.name, t.lang, idx),
              lang: t.lang || "",
              source: "hls",
            }));
            const activeTrack = hls.subtitleTrack;
            if (activeTrack >= 0) setActiveSub(`hls-${activeTrack}`);
            setSubtitleList((prev) => [
              ...prev.filter((s) => ["prop", "upload", "proxy-sub", "provider"].includes(s.source)),
              ...hlsSubs,
            ]);
          }
        });

        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) {
            const statusCode = d.response?.code;
            const serverMsg = d.response?.text || "";
            if (statusCode === 429) {
              setError("CDN rate-limited (429). Wait 60 seconds and tap Retry, or open in VLC.");
            } else if (/403|410|expired|Forbidden/i.test(serverMsg)) {
              setError("CDN link token expired (403). Generate a fresh download/stream link.");
            } else if (statusCode === 502 || statusCode === 504) {
              setError(
                serverMsg
                  ? `Remux failed: ${serverMsg.slice(0, 140)}`
                  : "Proxy remux timed out or CDN rejected connection. Check server.js logs or open in VLC."
              );
            } else if (resolvedFallbackSource) {
              setError("Direct playback failed. Retry or choose the provider player.");
            } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setError(`Media proxy (${PROXY_BASE}) unreachable or waking up. Tap Retry in a few seconds, or open in VLC.`);
            } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
              setError("Browser cannot decode 4K HEVC (H.265). Try Edge/Safari or open in VLC.");
            } else {
              setError("HLS stream error. Retry playback or open in VLC.");
            }
          }
        });
        if (!directUrl.includes("/api/hls/")) setEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        if (!showResumeRef.current) video.play().catch(() => {});
        setEngine("HLS-Native");
      } else if (!fallbackToProvider()) {
        setError("HLS not supported on this browser.");
      }
    } else {
      video.src = directUrl;
      video.load();
      if (!showResumeRef.current) video.play().catch(() => {});
      setEngine((currentEngine) => currentEngine || (RE_MKV_AVI.test(directUrl) ? "MKV" : "Native"));
    }

    return () => {
      try { hlsRef.current?.destroy(); } catch {}
      hlsRef.current = null;
      try { dashRef.current?.reset(); } catch {}
      dashRef.current = null;
    };
  }, [mode, directUrl, directMediaType, resolvedFallbackSource, rawUrl]);

  // ── Detect Native HTML5 Audio & Subtitle Tracks ────────────────────────
  const syncNativeTracks = useCallback(() => {
    const v = videoRef.current;
    if (!v || hlsRef.current || dashRef.current) return;

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
          const customOnly = prev.filter((s) => ["prop", "upload", "proxy-sub", "provider"].includes(s.source));
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
    } else if (dashRef.current) {
      dashRef.current.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: item.id === -1 } } },
      });
      if (item.id >= 0) dashRef.current.setQualityFor("video", item.id);
    } else if (item.url && videoRef.current) {
      const v = videoRef.current;
      pendingSeekRef.current = v.currentTime;
      setDirectMediaType(detectDirectMediaType(item.url) || "");
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
      setDirectMediaType("hls");
      setDirectUrl(`${item.baseStreamUrl}&start=${seekSec}`);
    } else if (hlsRef.current) {
      hlsRef.current.audioTrack = item.id;
    } else if (item.source === "dash" && dashRef.current && item.dashTrack) {
      dashRef.current.setCurrentTrack(item.dashTrack);
    } else if (v?.audioTracks && v.audioTracks.length > item.id) {
      for (let i = 0; i < v.audioTracks.length; i++) {
        v.audioTracks[i].enabled = i === item.id;
      }
    } else if (item.url && v) {
      pendingSeekRef.current = v.currentTime;
      setDirectMediaType(detectDirectMediaType(item.url) || "");
      setDirectUrl(item.url);
    } else if (item.source === "detected") {
      setTrackNotice(`Media proxy (${PROXY_BASE}) is unavailable to switch to "${item.label}" in-browser, or open in VLC.`);
    }
    setSettingsTab("main");
  }, []);

  const handleSelectSubtitle = useCallback((subItem) => {
    const v = videoRef.current;
    if (!subItem) {
      setActiveSub(-1);
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      if (dashRef.current) dashRef.current.setTextTrack(-1);
      if (v?.textTracks) {
        for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = "disabled";
      }
      setSettingsTab("main");
      return;
    }

    setActiveSub(subItem.id);
    if (subItem.source === "hls" && hlsRef.current) {
      hlsRef.current.subtitleTrack = subItem.hlsIdx;
    } else if (subItem.source === "dash" && dashRef.current) {
      dashRef.current.setTextTrack(subItem.dashIdx);
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

  const handleSelectSpeed = useCallback((rate) => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedPop(false);
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
      if (dashRef.current) dashRef.current.setTextTrack(-1);
      return;
    }

    const selected = subtitleList.find((sub) => sub.id === activeSub);
    if (!selected) return;
    if (selected.source === "hls" && hlsRef.current) {
      hlsRef.current.subtitleTrack = selected.hlsIdx;
      return;
    }
    if (selected.source === "dash" && dashRef.current) {
      dashRef.current.setTextTrack(selected.dashIdx);
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
    const onProgress = () => {
      const dur = Math.max(isFinite(v.duration) ? v.duration : 0, knownDuration || 0);
      if (dur > 0 && v.buffered.length > 0) {
        const end = v.buffered.end(v.buffered.length - 1);
        setBufferedPct(Math.min(100, (end / dur) * 100));
      }
    };
    const onDur = () => {
      if (isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      syncNativeTracks();
    };
    const onVol = () => { setVolume(v.volume); setIsMuted(v.muted); };
    const onRate = () => setPlaybackRate(v.playbackRate);
    const onEnterPiP = () => setIsPiP(true);
    const onLeavePiP = () => setIsPiP(false);
    const onEnd = () => { clearPos(currentTitle); startCountdown(); };
    const onErr = () => {
      if (parsedMeta.isMkv || parsedMeta.isSurround) {
        setUnsupportedInfo({
          ext: getFileExtension(rawUrl),
          isMagnet: false,
          isStreamableExternal: true,
          title: "Open in External Player (4K MKV / DD5.1)",
          reason:
            "This browser could not decode the 4K HEVC / Dolby 5.1 stream or the media proxy is offline. Open directly in VLC, Infuse, or MX Player.",
        });
        setMode("unsupported");
      } else {
        setError(
          resolvedFallbackSource
            ? "Direct playback failed. Retry or choose the provider player."
            : "Playback error — codec unsupported or expired link."
        );
      }
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWait);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("progress", onProgress);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("enterpictureinpicture", onEnterPiP);
    v.addEventListener("leavepictureinpicture", onLeavePiP);
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
      v.removeEventListener("progress", onProgress);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("enterpictureinpicture", onEnterPiP);
      v.removeEventListener("leavepictureinpicture", onLeavePiP);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("error", onErr);
    };
  }, [mode, rawUrl, currentTitle, parsedMeta, knownDuration, startCountdown, syncNativeTracks, resolvedFallbackSource]);

  // ── Fullscreen listener (Native + iPhone CSS fallback) ────────────────
  useEffect(() => {
    const onFS = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        setIsCssFullscreen(false);
        try { window.screen?.orientation?.unlock?.(); } catch {}
      }
    };

    ["fullscreenchange", "webkitfullscreenchange"].forEach((e) =>
      document.addEventListener(e, onFS)
    );
    return () => {
      ["fullscreenchange", "webkitfullscreenchange"].forEach((e) =>
        document.removeEventListener(e, onFS)
      );
    };
  }, []);

  // ── Auto-scroll episode bar ───────────────────────────────────────────
  useEffect(() => {
    if (!epScrollRef.current || !isSeries) return;
    const active = epScrollRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentIndex, isSeries]);

  // ── Cleanup ───────────────────────────────────────────────────────────
  useEffect(() => () => {
    try { hlsRef.current?.destroy(); } catch {}
    try { dashRef.current?.reset(); } catch {}
    clearTimeout(controlsTimer.current);
    clearTimeout(lockTimer.current);
    clearInterval(countdownRef.current);
    clearTimeout(flashTimer.current);
    clearTimeout(gestureTimer.current);
    clearTimeout(tapTimerRef.current);
    clearTimeout(skipRippleTimer.current);
    discoverAbort.current?.abort();
  }, []);

  const goToEpisode = useCallback((idx) => {
    if (!isSeries || idx < 0 || idx >= playlist.length) return;
    cancelCountdown();
    setCurrentIndex(idx);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPct(0);
    setError("");
    setShowResume(false);
    showResumeRef.current = false;
    setResumeTime(0);
    setShowSettings(false);
    setShowSpeedPop(false);
  }, [isSeries, playlist, cancelCountdown]);

  useEffect(() => {
    if (countdown === 0) goToEpisode(currentIndex + 1);
  }, [countdown, currentIndex, goToEpisode]);

  // ── Playback controls ─────────────────────────────────────────────────
  const showFlash = useCallback((type) => {
    clearTimeout(flashTimer.current);
    setPlayFlash(type);
    setFlashKey((k) => k + 1);
    flashTimer.current = setTimeout(() => setPlayFlash(null), 700);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); showFlash("play"); }
    else          { v.pause(); showFlash("pause"); }
    resetControlsTimer();
  }, [showFlash, resetControlsTimer]);

  const seekBy = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    const maxDur = Math.max(v.duration || 0, knownDuration || 0);
    v.currentTime = clamp(v.currentTime + delta, 0, maxDur);
    resetControlsTimer();
  }, [knownDuration, resetControlsTimer]);

  const triggerSkipRipple = useCallback((side, delta) => {
    clearTimeout(skipRippleTimer.current);
    setSkipRipple((prev) => ({
      side,
      amount: prev && prev.side === side ? prev.amount + Math.abs(delta) : Math.abs(delta),
      key: Date.now(),
    }));
    seekBy(delta);
    skipRippleTimer.current = setTimeout(() => setSkipRipple(null), 850);
  }, [seekBy]);

  // ── Surface Tap & Double-Tap Left/Right Skip ──────────────────────────
  const handleSurfaceClick = useCallback((e) => {
    if (isLocked) {
      revealLockSign();
      return;
    }
    if (showSettings || showSpeedPop) {
      setShowSettings(false);
      setShowSpeedPop(false);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const side = relX < 0.34 ? "left" : relX > 0.66 ? "right" : "center";
    const now = Date.now();
    const isDouble = now - lastTapRef.current.time < 280 && lastTapRef.current.side === side && side !== "center";

    lastTapRef.current = { time: now, side };
    clearTimeout(tapTimerRef.current);

    if (isDouble) {
      lastTapRef.current = { time: 0, side: null };
      triggerSkipRipple(side, side === "left" ? -10 : 10);
      return;
    }

    const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (isTouch) {
      tapTimerRef.current = setTimeout(() => {
        if (showControls) {
          setShowControls(false);
          clearTimeout(controlsTimer.current);
        } else {
          resetControlsTimer();
        }
      }, 220);
    } else {
      tapTimerRef.current = setTimeout(() => {
        togglePlay();
      }, side === "center" ? 0 : 210);
    }
  }, [isLocked, revealLockSign, showSettings, showSpeedPop, showControls, resetControlsTimer, togglePlay, triggerSkipRipple]);

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

  const togglePiP = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      }
    } catch {}
  }, []);

  // ── Fullscreen Toggle (Never triggers Apple native AVPlayer on iPhone) ──
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 900;

    if (document.fullscreenElement || document.webkitFullscreenElement || isCssFullscreen) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } catch {}
      setIsCssFullscreen(false);
      setIsFullscreen(false);
      try { window.screen?.orientation?.unlock?.(); } catch {}
      return;
    }

    try {
      if (el?.requestFullscreen) {
        await el.requestFullscreen();
        if (isMobile) {
          try { await window.screen?.orientation?.lock?.("landscape"); } catch {}
        }
      } else if (el?.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else {
        // iPhone fallback: CSS fullscreen on .gp-root container
        setIsCssFullscreen(true);
        setIsFullscreen(true);
      }
    } catch {
      setIsCssFullscreen(true);
      setIsFullscreen(true);
    }

    setShowSettings(false);
    setShowSpeedPop(false);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3200);
  }, [isCssFullscreen]);

  // ── Resume & Start Over ───────────────────────────────────────────────
  const handleResume = useCallback(() => {
    const v = videoRef.current;
    const targetSec = Math.floor(resumeTime);
    setShowResume(false);
    showResumeRef.current = false;
    if (!v) return;

    const currentAudioObj = audioList.find((a) => a.id === activeAudio);
    if (currentAudioObj?.source === "proxy" && currentAudioObj.baseStreamUrl) {
      pendingSeekRef.current = targetSec;
      setIsBuffering(true);
      setDirectMediaType("hls");
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

  // ── Scrub & Hover Preview ─────────────────────────────────────────────
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
    setHoverTime({ pct: pct * 100, sec: targetSec });
  }, [effectiveDuration]);

  const onTrackHover = useCallback((e) => {
    if (effectiveDuration <= 0) return;
    const p = getPct(e.clientX);
    if (p !== null) setHoverTime({ pct: p * 100, sec: p * effectiveDuration });
  }, [effectiveDuration, getPct]);

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
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const p = getPct(x);
    if (p !== null && effectiveDuration > 0) {
      setHoverTime({ pct: p * 100, sec: p * effectiveDuration });
    }
    if (!isScrubbing) return;
    if (p !== null) applySeek(p);
  }, [isScrubbing, effectiveDuration, getPct, applySeek]);

  const onScrubEnd = useCallback((e) => {
    if (!isScrubbing) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    setScrubPct(null);
    setHoverTime(null);
    resetControlsTimer();
    try { progressRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [isScrubbing, resetControlsTimer]);

  // ── Touch gestures ────────────────────────────────────────────────────
  const onGestureStart = useCallback((e) => {
    if (isLocked || mode !== "direct" || showSettings || showSpeedPop) return;
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
  }, [isLocked, mode, showSettings, showSpeedPop, brightness, volume]);

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

  // ── Keyboard & Android TV Remote Handler ──────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key;
      const isMediaPlayKey = key === "MediaPlayPause" || key === "MediaPlay" || key === "MediaPause" || key === " " || key === "k";
      const isMediaRewind  = key === "MediaRewind" || key === "MediaTrackPrevious";
      const isMediaForward = key === "MediaFastForward" || key === "MediaTrackNext";
      const isBackKey      = key === "Escape" || key === "GoBack" || key === "Backspace" || e.keyCode === 10009;

      if (isLocked) {
        if (isBackKey) {
          e.preventDefault();
          setIsLocked(false);
        }
        return;
      }

      if (isMediaPlayKey) {
        e.preventDefault();
        setShowControls(true);
        if (mode === "direct") togglePlay();
        return;
      }

      if (isMediaRewind) {
        e.preventDefault();
        setShowControls(true);
        triggerSkipRipple("left", -10);
        return;
      }

      if (isMediaForward) {
        e.preventDefault();
        setShowControls(true);
        triggerSkipRipple("right", 10);
        return;
      }

      if (key === "f") { e.preventDefault(); toggleFullscreen(); return; }
      if (key === "p") { e.preventDefault(); togglePiP(); return; }
      if (key === "m") { e.preventDefault(); toggleMute(); return; }

      if (key === "ArrowLeft") {
        e.preventDefault();
        setShowControls(true);
        triggerSkipRipple("left", -10);
        return;
      }
      if (key === "ArrowRight") {
        e.preventDefault();
        setShowControls(true);
        triggerSkipRipple("right", 10);
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        setShowControls(true);
        setVol((videoRef.current?.volume ?? 1) + 0.1);
        return;
      }
      if (key === "ArrowDown") {
        e.preventDefault();
        setShowControls(true);
        setVol((videoRef.current?.volume ?? 1) - 0.1);
        return;
      }

      if (isBackKey) {
        e.preventDefault();
        if (showSettings || showSpeedPop) {
          setShowSettings(false);
          setShowSpeedPop(false);
        } else if (document.fullscreenElement || isCssFullscreen) {
          toggleFullscreen();
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, isLocked, isCssFullscreen, showSettings, showSpeedPop, togglePlay, toggleFullscreen, togglePiP, toggleMute, triggerSkipRipple, setVol, onClose]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard?.writeText(rawUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [rawUrl]);

  // ── Derived values & External Player Deep-Links ───────────────────────
  const progress   = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;
  const displayPct = scrubPct !== null ? scrubPct : progress;
  const capPct     = displayPct > 0 ? Math.min(6, Math.max(2.2, displayPct * 0.14)) : 0;
  const whitePct   = Math.max(0, displayPct - capPct);

  const ringOffset = countdown !== null ? ((5 - countdown) / 5) * 125.7 : 0;
  const gestureBarH = gestureOv
    ? gestureOv.type === "brightness"
      ? Math.min(100, Math.max(0, (gestureOv.value - 20) / 1.3))
      : Math.min(100, Math.max(0, gestureOv.value))
    : 0;
  const episodeLabel = isSeries
    ? currentEp.episode ? `S${currentEp.season ?? 1} · E${currentEp.episode}` : `EP ${currentIndex + 1}`
    : null;

  const ctrlVisible    = (showControls || isScrubbing) && !isLocked;
  const externalVlc    = `vlc://${rawUrl.replace(/^https?:\/\//i, "")}`;
  const externalMx     = `intent:${rawUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(currentTitle)};end`;
  const externalInfuse = `infuse://x-callback-url/play?url=${encodeURIComponent(rawUrl)}`;
  const mountedTracks  = subtitleList.filter(
    (s) => (s.source === "prop" || s.source === "upload" || s.source === "proxy-sub") && s.src
  );

  const isIos     = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const supportsPiP = typeof document !== "undefined" && document.pictureInPictureEnabled;

  const currentQualityLabel =
    qualityList.find((q) => q.id === activeQuality)?.label || (activeQuality === -1 ? "Auto" : "Default");
  const currentAudioLabel =
    audioList.find((a) => a.id === activeAudio)?.label || "Default";
  const currentSubLabel =
    activeSub === -1 ? "Off" : subtitleList.find((s) => s.id === activeSub)?.label || "On";

  const subDescription =
    currentEp.description ||
    description ||
    [
      episodeLabel,
      audioList.length > 0 ? currentAudioLabel : null,
      qualityList.length > 0 ? currentQualityLabel : null,
      parsedMeta.isSurround ? "Dolby 5.1" : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const rootClassName = [
    "gp-root",
    isSeries ? "gp-root--series" : "",
    isCssFullscreen ? "gp-root--css-fs" : "",
    mode === "direct" && !ctrlVisible && !isLocked ? "gp-root--hide-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className={rootClassName}
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
        hidden
        onChange={handleSubtitleUpload}
      />

      {/* ── DIRECT VIDEO ── */}
      {(mode === "direct" || mode === "discovering") && (
        <video
          ref={videoRef}
          referrerPolicy={directReferrerPolicy || undefined}
          className={[
            "gp-video",
            isStretched ? "gp-video--stretch" : "",
            mode !== "direct" ? "gp-video--hidden" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={brightness !== 100 ? { filter: `brightness(${brightness / 100})` } : undefined}
          playsInline
          controls={false}
          preload="auto"
          x-webkit-airplay="allow"
          onClick={handleSurfaceClick}
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

      {/* ── CINEMATIC TOP & BOTTOM SCRIMS ── */}
      {mode === "direct" && !isLocked && (
        <>
          <div className={`gp-top-scrim ${ctrlVisible ? "gp-scrim--visible" : ""}`} />
          <div className={`gp-bottom-scrim ${ctrlVisible ? "gp-scrim--visible" : ""}`} />
        </>
      )}

      {/* ── DOUBLE-CHEVRON SKIP OVERLAY ── */}
      {skipRipple && mode === "direct" && (
        <div
          key={skipRipple.key}
          className={`gp-skip-zone gp-skip-zone--${skipRipple.side}`}
        >
          <div className="gp-skip-chevron-row">
            {skipRipple.side === "left" ? <Icons.DoubleRewind /> : <Icons.DoubleForward />}
          </div>
          <span className="gp-skip-text">{skipRipple.amount} seconds</span>
        </div>
      )}

      {/* ── TRANSPARENT LOCK SHIELD ── */}
      {isLocked && mode === "direct" && (
        <div
          className="gp-lock-shield"
          onClick={(e) => {
            e.stopPropagation();
            revealLockSign();
          }}
        />
      )}

      {/* ── LOCK PEEK BUTTON ── */}
      {isLocked && mode === "direct" && (
        <button
          className={`gp-lock-peek ${showLockBadge ? "gp-lock-peek--visible" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            exitLockMode();
          }}
          title="Unlock Controls"
        >
          <Icons.Unlock />
          <span className="gp-lock-peek-text">Screen Locked · Tap to Unlock</span>
        </button>
      )}

      {/* ── IFRAME / EMBED ── */}
      {mode === "iframe" && (
        <div className="gp-iframe-wrap">
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            title={currentTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
            className="gp-iframe"
            onLoad={() => setError("")}
          />
          {embedFallback && (
            <div role="status" className="gp-embed-banner">
              <span className="gp-embed-banner-text">
                Using <strong>{embedFallback.provider}</strong>'s player: {embedFallback.reason}
              </span>
              <button
                className="gp-embed-dismiss-btn"
                onClick={() => setEmbedFallback(null)}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── UNSUPPORTED / EXTERNAL PLAYER LAUNCHER CARD ── */}
      {mode === "unsupported" && unsupportedInfo && (
        <div className="gp-card-overlay">
          <div className="gp-glass-card">
            <div className="gp-warn-icon-wrap">
              {unsupportedInfo.isStreamableExternal ? <Icons.External /> : <Icons.Archive />}
            </div>
            <span className="gp-pill-badge">{unsupportedInfo.ext}</span>
            <h3 className="gp-card-title">{unsupportedInfo.title}</h3>
            <p className="gp-card-file" title={currentTitle}>{currentTitle}</p>
            <p className="gp-card-reason">{unsupportedInfo.reason}</p>

            {unsupportedInfo.isStreamableExternal ? (
              <div className="gp-card-actions-col">
                <div className="gp-card-actions">
                  <a href={externalVlc} className="gp-action-btn gp-action-btn--primary">
                    <Icons.External /> Open in VLC
                  </a>
                  {isAndroid && (
                    <a href={externalMx} className="gp-action-btn gp-action-btn--secondary">
                      MX Player
                    </a>
                  )}
                  {isIos && (
                    <a href={externalInfuse} className="gp-action-btn gp-action-btn--secondary">
                      Infuse
                    </a>
                  )}
                </div>
                <div className="gp-card-actions">
                  <button className="gp-action-btn gp-action-btn--secondary" onClick={handleCopyUrl}>
                    <Icons.Copy /> {copied ? "Copied Link!" : "Copy Link"}
                  </button>
                  <a href={rawUrl} target="_blank" rel="noreferrer" download className="gp-action-btn gp-action-btn--secondary">
                    <Icons.Download /> Download
                  </a>
                </div>
              </div>
            ) : (
              <div className="gp-card-actions">
                <a
                  href={rawUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="gp-action-btn gp-action-btn--primary"
                >
                  <Icons.Download /> {unsupportedInfo.isMagnet ? "Open Magnet" : `Download ${unsupportedInfo.ext}`}
                </a>
                <button className="gp-action-btn gp-action-btn--secondary" onClick={handleCopyUrl}>
                  <Icons.Copy /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DISCOVERING SPINNER ── */}
      {mode === "discovering" && (
        <div className="gp-loader-wrap">
          <div className="gp-spin-wrap">
            <div className="gp-spin-ring gp-sr1" />
            <div className="gp-spin-ring gp-sr2" />
            <div className="gp-spin-ring gp-sr3" />
            <div className="gp-spin-dot" />
          </div>
          <p className="gp-loader-text">{discoverMsg}</p>
        </div>
      )}

      {/* ── BUFFERING RING ── */}
      {mode === "direct" && isBuffering && (
        <div className="gp-buf-wrap">
          <div className="gp-buf-ring" />
        </div>
      )}

      {/* ── PLAY/PAUSE CENTER FLASH ── */}
      {playFlash && mode === "direct" && (
        <div key={flashKey} className="gp-flash">
          <div className="gp-flash-ring" />
          <div className="gp-flash-icon">
            {playFlash === "play" ? <Icons.Play /> : <Icons.Pause />}
          </div>
        </div>
      )}

      {/* ── TOP HEADER ── */}
      <div
        className={`gp-header ${
          ctrlVisible || mode === "iframe" || mode === "unsupported" ? "gp-header--visible" : ""
        }`}
      >
        <div className="gp-header-left">
          {onClose && (
            <button className="gp-icon-btn gp-back-btn" onClick={onClose} aria-label="Back" title="Back">
              <Icons.Back />
            </button>
          )}

          <div className="gp-title-block">
            <div className="gp-red-accent-bar" />
            <div className="gp-title-text-col">
              <div className="gp-title-row">
                <span className="gp-title-text">{currentTitle}</span>
                {episodeLabel && <span className="gp-ep-badge">{episodeLabel}</span>}
              </div>
              {subDescription && (
                <span className="gp-desc-text">{subDescription}</span>
              )}
            </div>
          </div>
        </div>

        <div className="gp-top-right">
          {mode === "iframe" && (
            <div
              className={`gp-ad-badge gp-hide-xs ${
                adBlockStatus === "cross-origin" ? "gp-ad-badge--partial" : ""
              }`}
            >
              <Icons.Shield />
              <span className="gp-ad-badge-text">
                {adBlockStatus === "injected" ? "AD SHIELD" : "POPUPS OFF"}
              </span>
            </div>
          )}

          {brandLogo ? (
            <span className="gp-brand-logo-text gp-hide-xs">{brandLogo}</span>
          ) : (
            engine && <span className="gp-brand-logo-text gp-hide-xs">{engine}</span>
          )}

          {mode === "direct" && (
            <>
              <button
                className={`gp-icon-btn gp-top-action-btn gp-hide-xs ${
                  isStretched ? "gp-top-action-btn--active" : ""
                }`}
                onClick={() => { setIsStretched((s) => !s); resetControlsTimer(); }}
                title="Aspect Fill / Fit"
              >
                <Icons.Stretch />
              </button>
              <button
                className="gp-icon-btn gp-top-action-btn"
                onClick={enterLockMode}
                title="Lock Screen"
              >
                <Icons.Lock />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── GESTURE OVERLAYS ── */}
      {gestureOv && !isLocked && (
        <div className={`gp-gesture-panel gp-gesture-panel--${gestureOv.type === "brightness" ? "left" : "right"}`}>
          <span className="gp-gesture-icon">
            {gestureOv.type === "brightness" ? (
              <Icons.Sun />
            ) : gestureOv.value === 0 ? (
              <Icons.Mute />
            ) : (
              <Icons.VolumeUp />
            )}
          </span>
          <div className="gp-gesture-track">
            <div
              className={`gp-gesture-fill gp-gesture-fill--${gestureOv.type}`}
              style={{ height: `${gestureBarH}%` }}
            />
          </div>
          <span className="gp-gesture-val">{gestureOv.value}%</span>
        </div>
      )}

      {/* ── RESUME PROMPT ── */}
      {showResume && mode === "direct" && (
        <div className="gp-card-overlay">
          <div className="gp-glass-card">
            <div className="gp-resume-icon"><Icons.Play /></div>
            <h3 className="gp-card-title">Continue Watching?</h3>
            <p className="gp-resume-sub">
              Paused at {fmt(resumeTime)}{effectiveDuration > 0 ? ` / ${fmt(effectiveDuration)}` : ""}
            </p>
            <div className="gp-resume-bar">
              <div
                className="gp-resume-bar-fill"
                style={{
                  width: effectiveDuration > 0 ? `${Math.min(100, (resumeTime / effectiveDuration) * 100)}%` : "35%",
                }}
              />
            </div>
            <div className="gp-card-actions">
              <button className="gp-action-btn gp-action-btn--primary" onClick={handleResume}>
                <Icons.Play /> Resume
              </button>
              <button className="gp-action-btn gp-action-btn--secondary" onClick={handleStartOver}>
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AUTOPLAY COUNTDOWN ── */}
      {countdown !== null && hasNext && (
        <div className="gp-card-overlay">
          <div className="gp-glass-card">
            <p className="gp-ap-label">Up Next</p>
            <p className="gp-ap-title">{playlist[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}</p>
            <div className="gp-ap-ring">
              <svg viewBox="0 0 48 48" width={64} height={64} className="gp-ap-svg">
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke="#e50914"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray="125.7"
                  strokeDashoffset={125.7 - ringOffset}
                  className="gp-ap-circle-progress"
                />
              </svg>
              <span className="gp-ap-num">{countdown}</span>
            </div>
            <p className="gp-ap-hint">Starting in {countdown}s</p>
            <div className="gp-card-actions">
              <button className="gp-ap-now" onClick={() => { cancelCountdown(); goToEpisode(currentIndex + 1); }}>
                <Icons.Play /> Play Now
              </button>
              <button className="gp-action-btn gp-action-btn--secondary" onClick={cancelCountdown}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BOTTOM BROADCAST CONTROL BAR ── */}
      {mode === "direct" && (
        <div className={`gp-ctrl-bar ${ctrlVisible ? "gp-ctrl-bar--visible" : ""}`}>
          <div
            ref={progressRef}
            className="gp-track"
            onMouseMove={onTrackHover}
            onMouseLeave={() => !isScrubbing && setHoverTime(null)}
            onPointerDown={onScrubStart}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
          >
            {hoverTime && effectiveDuration > 0 && (
              <div
                className="gp-hover-tooltip"
                style={{ left: `${clamp(hoverTime.pct / 100, 0.04, 0.96) * 100}%` }}
              >
                {fmt(hoverTime.sec)}
              </div>
            )}

            <div className="gp-track-rail">
              <div className="gp-track-buffer" style={{ width: `${bufferedPct}%` }} />
              <div className="gp-track-white-fill" style={{ width: `${whitePct}%` }} />
              {displayPct > 0 && (
                <div
                  className="gp-track-red-cap"
                  style={{ left: `${whitePct}%`, width: `${capPct}%` }}
                />
              )}
            </div>
          </div>

          <div className="gp-bottom-row">
            <div className="gp-bottom-left">
              <button
                className="gp-ring-play"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                title={isPlaying ? "Pause (K)" : "Play (K)"}
              >
                {isPlaying ? <Icons.Pause /> : <Icons.Play />}
              </button>

              {hasPrev && (
                <button className="gp-icon-btn gp-dock-btn gp-hide-xs" onClick={() => goToEpisode(currentIndex - 1)} title="Previous Episode">
                  <Icons.Prev />
                </button>
              )}
              {hasNext && (
                <button className="gp-icon-btn gp-dock-btn gp-hide-xs" onClick={() => goToEpisode(currentIndex + 1)} title="Next Episode">
                  <Icons.Next />
                </button>
              )}

              <div
                className="gp-vol-wrap"
                onMouseEnter={() => setVolHover(true)}
                onMouseLeave={() => setVolHover(false)}
              >
                <button
                  className="gp-icon-btn gp-dock-btn"
                  onClick={toggleMute}
                  aria-label="Mute"
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <Icons.Mute /> : volume < 0.5 ? <Icons.VolumeDown /> : <Icons.VolumeUp />}
                </button>
                <div className={`gp-vol-slider-wrap gp-hide-xs ${volHover ? "gp-vol-slider-wrap--open" : ""}`}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => setVol(parseFloat(e.target.value))}
                    className="gp-vol"
                    aria-label="Volume"
                  />
                </div>
              </div>

              <div className="gp-time-display">
                <span className="gp-time-current">{fmt(currentTime)}</span>
                <span className="gp-time-slash">/</span>
                <span className="gp-time-total">{fmt(effectiveDuration)}</span>
              </div>
            </div>

            <div className="gp-bottom-right">
              {/* Playback Speed Dial */}
              <div className="gp-popover-anchor">
                <button
                  className={`gp-icon-btn gp-dock-btn ${
                    playbackRate !== 1 || showSpeedPop ? "gp-dock-btn--active" : ""
                  }`}
                  onClick={() => {
                    setShowSpeedPop((s) => !s);
                    setShowSettings(false);
                  }}
                  title={`Playback Speed (${playbackRate}x)`}
                  aria-label="Playback Speed"
                >
                  <Icons.ClockSpeed />
                </button>

                {showSpeedPop && (
                  <div className="gp-settings-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="gp-menu-header">Playback Speed</div>
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        className="gp-menu-option-row"
                        key={rate}
                        onClick={() => handleSelectSpeed(rate)}
                      >
                        <span>{rate === 1 ? "Normal (1.0x)" : `${rate}x`}</span>
                        {playbackRate === rate && (
                          <span className="gp-menu-check"><Icons.Check /></span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Settings Gear */}
              <div className="gp-popover-anchor">
                <button
                  className={`gp-icon-btn gp-dock-btn ${
                    showSettings ? "gp-dock-btn--gear-open" : ""
                  }`}
                  onClick={() => {
                    setShowSettings((s) => !s);
                    setShowSpeedPop(false);
                    setSettingsTab("main");
                  }}
                  title="Settings (Quality, Audio, Subtitles)"
                  aria-label="Settings"
                >
                  <Icons.Gear />
                </button>

                {showSettings && (
                  <div className="gp-settings-menu" onClick={(e) => e.stopPropagation()}>
                    {settingsTab === "main" && (
                      <>
                        <div className="gp-menu-header">Stream Settings</div>

                        <button className="gp-menu-row" onClick={() => setSettingsTab("quality")}>
                          <span className="gp-menu-row-left">
                            <span className="gp-menu-icon-box"><Icons.Quality /></span>
                            <span>Quality</span>
                          </span>
                          <span className="gp-menu-row-right">
                            <span className="gp-menu-pill">{currentQualityLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button className="gp-menu-row" onClick={() => setSettingsTab("audio")}>
                          <span className="gp-menu-row-left">
                            <span className="gp-menu-icon-box"><Icons.Language /></span>
                            <span>Audio Track</span>
                          </span>
                          <span className="gp-menu-row-right">
                            <span className="gp-menu-pill">{currentAudioLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button className="gp-menu-row" onClick={() => setSettingsTab("subtitles")}>
                          <span className="gp-menu-row-left">
                            <span className="gp-menu-icon-box"><Icons.Subtitles /></span>
                            <span>Subtitles</span>
                          </span>
                          <span className="gp-menu-row-right">
                            <span className="gp-menu-pill">{currentSubLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button className="gp-menu-row gp-hide-xs" onClick={() => setSettingsTab("shortcuts")}>
                          <span className="gp-menu-row-left">
                            <span className="gp-menu-icon-box"><Icons.Keyboard /></span>
                            <span>Shortcuts</span>
                          </span>
                          <span className="gp-menu-row-right">
                            <Icons.ChevronRight />
                          </span>
                        </button>
                      </>
                    )}

                    {settingsTab === "quality" && (
                      <>
                        <button className="gp-menu-back-row" onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Video Quality</span>
                        </button>
                        {qualityList.length > 0 ? (
                          qualityList.map((q) => (
                            <button className="gp-menu-option-row" key={q.id} onClick={() => handleSelectQuality(q)}>
                              <span>{q.label}</span>
                              {activeQuality === q.id && (
                                <span className="gp-menu-check"><Icons.Check /></span>
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="gp-menu-empty">Auto (Source Default)</div>
                        )}
                      </>
                    )}

                    {settingsTab === "audio" && (
                      <>
                        <button className="gp-menu-back-row" onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Audio Language</span>
                        </button>
                        {audioList.length > 0 ? (
                          audioList.map((a) => (
                            <button className="gp-menu-option-row" key={a.id} onClick={() => handleSelectAudio(a)}>
                              <span>{a.label}</span>
                              {activeAudio === a.id && (
                                <span className="gp-menu-check"><Icons.Check /></span>
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="gp-menu-empty">Original Audio Track</div>
                        )}

                        {trackNotice && (
                          <div className="gp-menu-notice">
                            <p className="gp-menu-notice-text">{trackNotice}</p>
                            <a href={externalVlc} className="gp-menu-vlc-btn">
                              <Icons.External /> Open in VLC
                            </a>
                          </div>
                        )}
                      </>
                    )}

                    {settingsTab === "subtitles" && (
                      <>
                        <button className="gp-menu-back-row" onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Subtitles / CC</span>
                        </button>
                        <button className="gp-menu-option-row" onClick={() => handleSelectSubtitle(null)}>
                          <span>Off</span>
                          {activeSub === -1 && (
                            <span className="gp-menu-check"><Icons.Check /></span>
                          )}
                        </button>
                        {subtitleList.map((sub) => (
                          <button className="gp-menu-option-row" key={sub.id} onClick={() => handleSelectSubtitle(sub)}>
                            <span>{sub.label}</span>
                            {activeSub === sub.id && (
                              <span className="gp-menu-check"><Icons.Check /></span>
                            )}
                          </button>
                        ))}
                        {subtitleList.length === 0 && (
                          <div className="gp-menu-empty">No embedded subtitles found</div>
                        )}
                        <button
                          className="gp-menu-upload-btn"
                          onClick={() => subFileInput.current?.click()}
                        >
                          <Icons.Upload /> Load Subtitle (.srt / .vtt)
                        </button>
                      </>
                    )}

                    {settingsTab === "shortcuts" && (
                      <>
                        <button className="gp-menu-back-row" onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Keyboard Shortcuts</span>
                        </button>
                        <div className="gp-shortcut-grid">
                          <span>Play / Pause</span><kbd className="gp-kbd">Space / K</kbd>
                          <span>Seek ±10s</span><kbd className="gp-kbd">← / →</kbd>
                          <span>Volume</span><kbd className="gp-kbd">↑ / ↓</kbd>
                          <span>Mute</span><kbd className="gp-kbd">M</kbd>
                          <span>Fullscreen</span><kbd className="gp-kbd">F</kbd>
                          <span>Picture-in-Picture</span><kbd className="gp-kbd">P</kbd>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Picture-in-Picture */}
              {supportsPiP && (
                <button
                  className={`gp-icon-btn gp-dock-btn gp-hide-xs ${
                    isPiP ? "gp-dock-btn--active" : ""
                  }`}
                  onClick={togglePiP}
                  title="Picture-in-Picture (P)"
                  aria-label="Picture-in-Picture"
                >
                  <Icons.PiP />
                </button>
              )}

              {/* Fullscreen */}
              <button
                className="gp-icon-btn gp-dock-btn"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}
                aria-label="Fullscreen"
              >
                {isFullscreen ? <Icons.FullscreenExit /> : <Icons.Fullscreen />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SERIES EPISODE DOCK ── */}
      {isSeries && (
        <div
          className={`gp-ep-bar ${
            ctrlVisible || mode === "iframe" ? "gp-ep-bar--visible" : ""
          }`}
        >
          <button
            className={`gp-icon-btn gp-ep-nav ${!hasPrev ? "gp-ep-nav--disabled" : ""}`}
            onClick={() => hasPrev && goToEpisode(currentIndex - 1)}
            disabled={!hasPrev}
            title="Previous Episode"
          >
            <Icons.ChevronLeft />
          </button>

          <div ref={epScrollRef} className="gp-ep-scroll">
            {playlist.map((ep, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={ep.id || idx}
                  data-active={isActive}
                  className={`gp-ep-dot ${isActive ? "gp-ep-dot--active" : ""}`}
                  onClick={() => goToEpisode(idx)}
                  title={ep.title || `Episode ${idx + 1}`}
                >
                  <span className="gp-ep-dot-num">
                    {ep.episode ? `E${ep.episode}` : idx + 1}
                  </span>
                  {ep.title && (
                    <span className="gp-ep-dot-title gp-hide-xs">
                      {ep.title}
                    </span>
                  )}
                  {isActive && <span className="gp-ep-dot-bar" />}
                </button>
              );
            })}
          </div>

          <button
            className={`gp-icon-btn gp-ep-nav ${!hasNext ? "gp-ep-nav--disabled" : ""}`}
            onClick={() => hasNext && goToEpisode(currentIndex + 1)}
            disabled={!hasNext}
            title="Next Episode"
          >
            <Icons.ChevronRight />
          </button>
        </div>
      )}

      {/* ── ERROR TOAST ── */}
      {error && mode !== "unsupported" && (
        <div className="gp-error-toast">
          <Icons.Warning />
          <span className="gp-error-text">{error}</span>
          {mode === "direct" && directUrl && (
            <button
              type="button"
              className="gp-dl-btn"
              onClick={() => {
                setError("");
                if (hlsRef.current) {
                  hlsRef.current.loadSource(directUrl);
                } else if (dashRef.current) {
                  dashRef.current.attachSource(directUrl);
                } else if (videoRef.current) {
                  videoRef.current.src = directUrl;
                  videoRef.current.load();
                  videoRef.current.play().catch(() => {});
                }
              }}
            >
              Retry
            </button>
          )}
          {mode === "direct" && resolvedFallbackSource && (
            <button
              type="button"
              className="gp-dl-btn"
              onClick={() => {
                setEmbedFallback({
                  provider: resolvedFallbackSource.provider,
                  reason: "Direct playback failed; the provider player is available as a fallback.",
                });
                setIframeUrl(resolvedFallbackSource.url);
                setMode("iframe");
                setError("");
              }}
            >
              Provider
            </button>
          )}
          <a href={externalVlc} className="gp-dl-btn" title="Open in VLC Player">
            <Icons.External /> VLC
          </a>
          <a href={rawUrl} target="_blank" rel="noreferrer" download className="gp-dl-btn">
            <Icons.Download /> Save
          </a>
        </div>
      )}
    </div>
  );
}