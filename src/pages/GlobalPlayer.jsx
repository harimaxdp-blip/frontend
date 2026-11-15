import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import { normalizeLanguageLabel, resolveMediaSource } from "../utils/mediaSourceResolver";

const PROXY_BASE = process.env.REACT_APP_MEDIA_PROXY_URL || "http://localhost:4000";
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

// ─── Icons (Matching Reference Aesthetic) ────────────────────────────────────
const Icons = {
  Play:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M8 5.5v13l10.5-6.5L8 5.5z"/></svg>,
  Pause:          () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><rect x="6.5" y="5" width="4" height="14" rx="1.5"/><rect x="13.5" y="5" width="4" height="14" rx="1.5"/></svg>,
  Mute:           () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>,
  VolumeUp:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9.5 9.5 0 0 1 0 13"/></svg>,
  VolumeDown:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>,
  // Diagonal red-accented fullscreen arrows matching reference image
  Fullscreen:     () => (
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
  // PiP icon matching reference image (hollow rect + solid bottom-right inset)
  PiP:            () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <rect x="11.5" y="11" width="7.5" height="6" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Clock / Speed icon matching reference image
  ClockSpeed:     () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
      <circle cx="12" cy="12" r="9.5" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  ),
  // Double-chevron skip icons matching reference image ("10 seconds")
  DoubleRewind:   () => (
    <svg viewBox="0 0 36 24" fill="currentColor" width="1em" height="1em">
      <path d="M17.5 4.2v15.6c0 .8-.9 1.3-1.6.8L4.6 12.8c-.6-.4-.6-1.2 0-1.6l11.3-7.8c.7-.5 1.6 0 1.6.8z"/>
      <path d="M31.5 4.2v15.6c0 .8-.9 1.3-1.6.8L18.6 12.8c-.6-.4-.6-1.2 0-1.6l11.3-7.8c.7-.5 1.6 0 1.6.8z"/>
    </svg>
  ),
  DoubleForward:  () => (
    <svg viewBox="0 0 36 24" fill="currentColor" width="1em" height="1em">
      <path d="M4.5 4.2v15.6c0 .8.9 1.3 1.6.8l11.3-7.8c.6-.4.6-1.2 0-1.6L6.1 3.4c-.7-.5-1.6 0-1.6.8z"/>
      <path d="M18.5 4.2v15.6c0 .8.9 1.3 1.6.8l11.3-7.8c.6-.4.6-1.2 0-1.6L20.1 3.4c-.7-.5-1.6 0-1.6.8z"/>
    </svg>
  ),
  Back:           () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  Prev:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>,
  Next:           () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>,
  Stretch:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9h8v6H8z"/></svg>,
  Lock:           () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Unlock:         () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
  Gear:           () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Check:          () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><polyline points="20 6 9 17 4 12"/></svg>,
  Subtitles:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></svg>,
  Language:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Quality:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15V9l3 3 3-3v6"/><path d="M17 9v6"/></svg>,
  Upload:         () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Sun:            () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Warning:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Download:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Archive:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  External:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Copy:           () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Shield:         () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>,
  ChevronLeft:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><polyline points="15 18 9 12 15 6"/></svg>,
  ChevronRight:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><polyline points="9 18 15 12 9 6"/></svg>,
  Keyboard:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>,
};

// ─── Watch position helpers ───────────────────────────────────────────────────
function watchKey(t) { return `gp-pos-${(t || "u").replace(/\s+/g, "_").toLowerCase()}`; }
function savePos(t, s) { if (!t || !s || s < 5) return; try { localStorage.setItem(watchKey(t), String(Math.floor(s))); } catch {} }
function loadPos(t) { try { return parseInt(localStorage.getItem(watchKey(t)) || "0", 10) || 0; } catch { return 0; } }
function clearPos(t) { try { localStorage.removeItem(watchKey(t)); } catch {} }

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL PLAYER (Broadcast Cinema UI + Dual-Tone Scrubber + Double-Chevron Skip)
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

  const [mode, setMode]                       = useState("discovering");
  const [directUrl, setDirectUrl]             = useState("");
  const [iframeUrl, setIframeUrl]             = useState("");
  const [embedFallback, setEmbedFallback]     = useState(null);
  const [resolvedFallbackSource, setResolvedFallbackSource] = useState(null);
  const [engine, setEngine]                   = useState("");
  const [discoverMsg, setDiscoverMsg]         = useState("Detecting stream…");
  const [unsupportedInfo, setUnsupportedInfo] = useState(null);
  const [copied, setCopied]                   = useState(false);

  const [isPlaying, setIsPlaying]       = useState(false);
  const [currentTime, setCurrentTime]   = useState(0);
  const [duration, setDuration]         = useState(0);
  const [bufferedPct, setBufferedPct]   = useState(0);
  const [knownDuration, setKnownDuration] = useState(0);
  const [volume, setVolume]             = useState(1);
  const [isMuted, setIsMuted]           = useState(false);
  const [volHover, setVolHover]         = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isBuffering, setIsBuffering]   = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP]               = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing]   = useState(false);
  const [scrubPct, setScrubPct]         = useState(null);
  const [hoverTime, setHoverTime]       = useState(null);
  const [isStretched, setIsStretched]   = useState(false);

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
        setResolvedFallbackSource(null);
        if (ctrl.signal.aborted) return;
        probeDirectSource(rawUrl);
        setDirectUrl(rawUrl);
        setEngine("");
        setMode("direct");
        return;
      }

      // 6. Resolve direct media or a provider's documented public API.
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
      if (resolvedFallbackSource) {
        setEmbedFallback({ provider: resolvedFallbackSource.provider, reason: "The resolved stream could not be played; returning to the provider embed." });
        setIframeUrl(resolvedFallbackSource.url);
        setMode("iframe");
        setError("");
      } else if (parsedMeta.isMkv || parsedMeta.isSurround) {
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

  // Double-chevron skip indicator ("10 seconds" like reference image)
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
        setShowSpeedPop(false);
        clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(() => setShowControls(false), 3200);
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        try { window.screen?.orientation?.unlock?.(); } catch {}
      }
    } catch {
      try {
        v?.webkitEnterFullscreen?.();
        clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(() => setShowControls(false), 3200);
      } catch {}
    }
  }, []);

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

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || isLocked) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); if (mode === "direct") togglePlay(); }
      if (e.key === "f") toggleFullscreen();
      if (e.key === "p") togglePiP();
      if (e.key === "m") toggleMute();
      if (e.key === "ArrowLeft")  { e.preventDefault(); triggerSkipRipple("left", -10); }
      if (e.key === "ArrowRight") { e.preventDefault(); triggerSkipRipple("right", 10); }
      if (e.key === "ArrowUp")    { e.preventDefault(); setVol((videoRef.current?.volume ?? 1) + 0.1); }
      if (e.key === "ArrowDown")  { e.preventDefault(); setVol((videoRef.current?.volume ?? 1) - 0.1); }
      if (e.key === "Escape")     {
        if (showSettings || showSpeedPop) { setShowSettings(false); setShowSpeedPop(false); }
        else if (document.fullscreenElement) toggleFullscreen();
        else onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, isLocked, showSettings, showSpeedPop, togglePlay, toggleFullscreen, togglePiP, toggleMute, triggerSkipRipple, setVol, onClose]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard?.writeText(rawUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [rawUrl]);

  // ── Derived values & External Player Deep-Links ───────────────────────
  const progress   = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;
  const displayPct = scrubPct !== null ? scrubPct : progress;
  // Dual-tone scrubber: white played bar + crimson leading segment (matching reference image)
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
  const EP_BAR_H       = isSeries ? 68 : 0;
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

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="gp-root"
      style={{
        ...S.root,
        cursor: mode === "direct" && !ctrlVisible && !isLocked ? "none" : "default",
      }}
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
          <div
            style={{
              ...S.topScrim,
              opacity: ctrlVisible ? 1 : 0,
              transition: "opacity 0.3s ease",
            }}
          />
          <div
            style={{
              ...S.bottomScrim,
              bottom: isSeries ? EP_BAR_H : 0,
              opacity: ctrlVisible ? 1 : 0,
              transition: "opacity 0.3s ease",
            }}
          />
        </>
      )}

      {/* ── DOUBLE-CHEVRON SKIP OVERLAY ("10 seconds" matching reference) ── */}
      {skipRipple && mode === "direct" && (
        <div
          key={skipRipple.key}
          style={{
            ...S.skipZone,
            ...(skipRipple.side === "left" ? { left: "12%" } : { right: "12%" }),
          }}
        >
          <div style={S.skipChevronRow}>
            {skipRipple.side === "left" ? <Icons.DoubleRewind /> : <Icons.DoubleForward />}
          </div>
          <span style={S.skipText}>{skipRipple.amount} seconds</span>
        </div>
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
            transform: showLockBadge ? "translateY(0)" : "translateY(-8px)",
            pointerEvents: showLockBadge ? "auto" : "none",
            transition: "opacity 0.25s ease, transform 0.25s ease",
          }}
          onClick={(e) => {
            e.stopPropagation();
            exitLockMode();
          }}
          title="Unlock Controls"
        >
          <Icons.Unlock />
          <span style={{ fontSize: "0.72rem", fontWeight: 700, marginLeft: 6 }}>
            Screen Locked · Tap to Unlock
          </span>
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
          {embedFallback && (
            <div role="status" style={{ position: "absolute", top: 16, left: 16, zIndex: 40, maxWidth: "min(520px, calc(100% - 32px))", padding: "9px 12px", borderRadius: 8, background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 12, lineHeight: 1.4, pointerEvents: "none" }}>
              Using {embedFallback.provider}'s player: {embedFallback.reason}
            </div>
          )}
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
        <div style={S.bufWrap}>
          <div style={S.bufRing} />
        </div>
      )}

      {/* ── PLAY/PAUSE CENTER FLASH ── */}
      {playFlash && mode === "direct" && (
        <div key={flashKey} style={S.flash}>
          <div style={S.flashRing} />
          <div style={S.flashIcon}>{playFlash === "play" ? <Icons.Play /> : <Icons.Pause />}</div>
        </div>
      )}

      {/* ── TOP HEADER (Vertical Red Accent Bar + Title & Description + Brand Mark) ── */}
      <div
        className="gp-header"
        style={{
          ...S.header,
          opacity: ctrlVisible || mode === "iframe" || mode === "unsupported" ? 1 : 0,
          pointerEvents: ctrlVisible || mode === "iframe" || mode === "unsupported" ? "auto" : "none",
          transition: "opacity 0.28s ease",
        }}
      >
        <div style={S.headerLeft}>
          {onClose && (
            <button className="gp-icon-btn" style={S.backBtn} onClick={onClose} aria-label="Back" title="Back">
              <Icons.Back />
            </button>
          )}

          {/* Crimson Vertical Bar + Title + Description (matching reference image) */}
          <div style={S.titleBlock}>
            <div style={S.redAccentBar} />
            <div style={S.titleTextCol}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span className="gp-title-text" style={S.titleText}>{currentTitle}</span>
                {episodeLabel && <span style={S.epBadge}>{episodeLabel}</span>}
              </div>
              {subDescription && (
                <span className="gp-desc-text" style={S.descText}>{subDescription}</span>
              )}
            </div>
          </div>
        </div>

        {/* Top-Right Brand Mark / Engine Pill + Screen Lock */}
        <div className="gp-top-right" style={S.topRight}>
          {mode === "iframe" && (
            <div
              className="gp-hide-xs"
              style={{
                ...S.adBadge,
                ...(adBlockStatus === "cross-origin" ? S.adBadgePartial : {}),
              }}
            >
              <Icons.Shield />
              <span style={{ fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.6px" }}>
                {adBlockStatus === "injected" ? "AD SHIELD" : "POPUPS OFF"}
              </span>
            </div>
          )}

          {brandLogo ? (
            <span className="gp-hide-xs" style={S.brandLogoText}>{brandLogo}</span>
          ) : (
            engine && <span className="gp-hide-xs" style={S.brandLogoText}>{engine}</span>
          )}

          {mode === "direct" && (
            <>
              <button
                className="gp-icon-btn gp-hide-xs"
                style={{ ...S.topActionBtn, ...(isStretched ? S.topActionActive : {}) }}
                onClick={() => { setIsStretched((s) => !s); resetControlsTimer(); }}
                title="Aspect Fill / Fit"
              >
                <Icons.Stretch />
              </button>
              <button
                className="gp-icon-btn"
                style={S.topActionBtn}
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
        <div style={{ ...S.gesturePanel, ...(gestureOv.type === "brightness" ? { left: 22 } : { right: 22 }) }}>
          <span style={{ opacity: 0.9, fontSize: 16 }}>
            {gestureOv.type === "brightness" ? <Icons.Sun /> : gestureOv.value === 0 ? <Icons.Mute /> : <Icons.VolumeUp />}
          </span>
          <div style={S.gestureTrack}>
            <div
              style={{
                ...S.gestureFill,
                height: `${gestureBarH}%`,
                background: gestureOv.type === "brightness" ? "#fff" : C.red,
              }}
            />
          </div>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, fontFamily: F.mono }}>{gestureOv.value}%</span>
        </div>
      )}

      {/* ── RESUME PROMPT ── */}
      {showResume && mode === "direct" && (
        <div style={S.cardOverlay}>
          <div style={S.glassCard}>
            <div style={S.resumeIcon}><Icons.Play /></div>
            <h3 style={S.cardTitle}>Continue Watching?</h3>
            <p style={S.resumeSub}>Paused at {fmt(resumeTime)}{effectiveDuration > 0 ? ` / ${fmt(effectiveDuration)}` : ""}</p>
            <div style={S.resumeBar}>
              <div
                style={{
                  ...S.resumeBarFill,
                  width: effectiveDuration > 0 ? `${Math.min(100, (resumeTime / effectiveDuration) * 100)}%` : "35%",
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
              <svg viewBox="0 0 48 48" width={64} height={64} style={{ transform: "rotate(-90deg)" }}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke={C.red}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray="125.7"
                  strokeDashoffset={125.7 - ringOffset}
                  style={{ filter: "drop-shadow(0 0 8px rgba(229,9,20,0.65))", transition: "stroke-dashoffset 0.92s linear" }}
                />
              </svg>
              <span style={S.apNum}>{countdown}</span>
            </div>
            <p style={S.apHint}>Starting in {countdown}s</p>
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

      {/* ── BOTTOM BROADCAST CONTROL BAR (Matching Reference Image) ── */}
      {mode === "direct" && (
        <div
          className="gp-ctrl-bar"
          style={{
            ...S.ctrlBar,
            bottom: isSeries ? EP_BAR_H : 0,
            paddingBottom: isSeries ? 10 : "max(18px, env(safe-area-inset-bottom))",
            opacity: ctrlVisible ? 1 : 0,
            pointerEvents: ctrlVisible ? "auto" : "none",
            transition: "opacity 0.25s ease",
          }}
        >
          {/* 1. Full-Width Dual-Tone Scrubber Bar (White Played + Red Active Segment) */}
          <div
            ref={progressRef}
            className="gp-track"
            style={S.track}
            onMouseMove={onTrackHover}
            onMouseLeave={() => !isScrubbing && setHoverTime(null)}
            onPointerDown={onScrubStart}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
          >
            {hoverTime && effectiveDuration > 0 && (
              <div
                style={{
                  ...S.hoverTooltip,
                  left: `${clamp(hoverTime.pct / 100, 0.04, 0.96) * 100}%`,
                }}
              >
                {fmt(hoverTime.sec)}
              </div>
            )}

            <div className="gp-track-rail" style={S.trackBg}>
              {/* Buffered segment */}
              <div style={{ ...S.trackBuffer, width: `${bufferedPct}%` }} />
              {/* White played progress */}
              <div style={{ ...S.trackWhiteFill, width: `${whitePct}%` }} />
              {/* Crimson active leading edge (matching reference image) */}
              {displayPct > 0 && (
                <div
                  style={{
                    ...S.trackRedCap,
                    left: `${whitePct}%`,
                    width: `${capPct}%`,
                  }}
                />
              )}
            </div>
          </div>

          {/* 2. Bottom Transport & Utility Row */}
          <div style={S.bottomRow}>
            {/* Left Group: Red-ringed Play/Pause + Speaker/Volume + 8:26 / 14:48 */}
            <div style={S.bottomLeft}>
              <button
                className="gp-ring-play"
                style={S.ringPlayBtn}
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                title={isPlaying ? "Pause (K)" : "Play (K)"}
              >
                {isPlaying ? <Icons.Pause /> : <Icons.Play />}
              </button>

              {hasPrev && (
                <button className="gp-icon-btn gp-hide-xs" style={S.dockBtn} onClick={() => goToEpisode(currentIndex - 1)} title="Previous Episode">
                  <Icons.Prev />
                </button>
              )}
              {hasNext && (
                <button className="gp-icon-btn gp-hide-xs" style={S.dockBtn} onClick={() => goToEpisode(currentIndex + 1)} title="Next Episode">
                  <Icons.Next />
                </button>
              )}

              {/* Speaker + Smooth Expandable Volume Slider */}
              <div
                style={S.volWrap}
                onMouseEnter={() => setVolHover(true)}
                onMouseLeave={() => setVolHover(false)}
              >
                <button
                  className="gp-icon-btn"
                  style={S.dockBtn}
                  onClick={toggleMute}
                  aria-label="Mute"
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <Icons.Mute /> : volume < 0.5 ? <Icons.VolumeDown /> : <Icons.VolumeUp />}
                </button>
                <div
                  className="gp-hide-xs"
                  style={{
                    ...S.volSliderWrap,
                    width: volHover ? 76 : 0,
                    opacity: volHover ? 1 : 0,
                    marginRight: volHover ? 6 : 0,
                  }}
                >
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

              {/* Timestamp with Crimson Slash ("8:26 / 14:48" matching reference) */}
              <div style={S.timeDisplay}>
                <span style={S.timeCurrent}>{fmt(currentTime)}</span>
                <span style={S.timeSlash}>/</span>
                <span style={S.timeTotal}>{fmt(effectiveDuration)}</span>
              </div>
            </div>

            {/* Right Group: Speed Clock + Settings Gear + PiP + Diagonal Red Fullscreen */}
            <div style={S.bottomRight}>
              {/* Playback Speed Dial */}
              <div style={{ position: "relative" }}>
                <button
                  className="gp-icon-btn"
                  style={{
                    ...S.dockBtn,
                    ...(playbackRate !== 1 || showSpeedPop ? { color: C.redB } : {}),
                  }}
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
                  <div className="gp-settings-menu" style={S.settingsMenu} onClick={(e) => e.stopPropagation()}>
                    <div style={S.menuHeader}>Playback Speed</div>
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        className="gp-menu-row"
                        key={rate}
                        style={S.menuOptionRow}
                        onClick={() => handleSelectSpeed(rate)}
                      >
                        <span>{rate === 1 ? "Normal (1.0x)" : `${rate}x`}</span>
                        {playbackRate === rate && <span style={{ color: C.red }}><Icons.Check /></span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Settings Gear (Quality, Multi-Audio, Subtitles, Shortcuts) */}
              <div style={{ position: "relative" }}>
                <button
                  className="gp-icon-btn"
                  style={{
                    ...S.dockBtn,
                    ...(showSettings ? { color: C.redB, transform: "rotate(30deg)" } : {}),
                  }}
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
                  <div className="gp-settings-menu" style={S.settingsMenu} onClick={(e) => e.stopPropagation()}>
                    {settingsTab === "main" && (
                      <>
                        <div style={S.menuHeader}>Stream Settings</div>

                        <button className="gp-menu-row" style={S.menuRow} onClick={() => setSettingsTab("quality")}>
                          <span style={S.menuRowLeft}>
                            <span style={S.menuIconBox}><Icons.Quality /></span>
                            <span>Quality</span>
                          </span>
                          <span style={S.menuRowRight}>
                            <span style={S.menuPill}>{currentQualityLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button className="gp-menu-row" style={S.menuRow} onClick={() => setSettingsTab("audio")}>
                          <span style={S.menuRowLeft}>
                            <span style={S.menuIconBox}><Icons.Language /></span>
                            <span>Audio Track</span>
                          </span>
                          <span style={S.menuRowRight}>
                            <span style={S.menuPill}>{currentAudioLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button className="gp-menu-row" style={S.menuRow} onClick={() => setSettingsTab("subtitles")}>
                          <span style={S.menuRowLeft}>
                            <span style={S.menuIconBox}><Icons.Subtitles /></span>
                            <span>Subtitles</span>
                          </span>
                          <span style={S.menuRowRight}>
                            <span style={S.menuPill}>{currentSubLabel}</span>
                            <Icons.ChevronRight />
                          </span>
                        </button>

                        <button className="gp-menu-row gp-hide-xs" style={S.menuRow} onClick={() => setSettingsTab("shortcuts")}>
                          <span style={S.menuRowLeft}>
                            <span style={S.menuIconBox}><Icons.Keyboard /></span>
                            <span>Shortcuts</span>
                          </span>
                          <span style={S.menuRowRight}>
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
                            <button className="gp-menu-row" key={q.id} style={S.menuOptionRow} onClick={() => handleSelectQuality(q)}>
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
                            <button className="gp-menu-row" key={a.id} style={S.menuOptionRow} onClick={() => handleSelectAudio(a)}>
                              <span>{a.label}</span>
                              {activeAudio === a.id && <span style={{ color: C.red }}><Icons.Check /></span>}
                            </button>
                          ))
                        ) : (
                          <div style={S.menuEmpty}>Original Audio Track</div>
                        )}

                        {trackNotice && (
                          <div style={S.menuNotice}>
                            <p style={{ margin: "0 0 8px", lineHeight: 1.45 }}>{trackNotice}</p>
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
                        <button className="gp-menu-row" style={S.menuOptionRow} onClick={() => handleSelectSubtitle(null)}>
                          <span>Off</span>
                          {activeSub === -1 && <span style={{ color: C.red }}><Icons.Check /></span>}
                        </button>
                        {subtitleList.map((sub) => (
                          <button className="gp-menu-row" key={sub.id} style={S.menuOptionRow} onClick={() => handleSelectSubtitle(sub)}>
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

                    {settingsTab === "shortcuts" && (
                      <>
                        <button style={S.menuBackRow} onClick={() => setSettingsTab("main")}>
                          <Icons.ChevronLeft />
                          <span>Keyboard Shortcuts</span>
                        </button>
                        <div style={S.shortcutGrid}>
                          <span>Play / Pause</span><kbd style={S.kbd}>Space / K</kbd>
                          <span>Seek ±10s</span><kbd style={S.kbd}>← / →</kbd>
                          <span>Volume</span><kbd style={S.kbd}>↑ / ↓</kbd>
                          <span>Mute</span><kbd style={S.kbd}>M</kbd>
                          <span>Fullscreen</span><kbd style={S.kbd}>F</kbd>
                          <span>Picture-in-Picture</span><kbd style={S.kbd}>P</kbd>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Picture-in-Picture */}
              {supportsPiP && (
                <button
                  className="gp-icon-btn gp-hide-xs"
                  style={{ ...S.dockBtn, ...(isPiP ? { color: C.redB } : {}) }}
                  onClick={togglePiP}
                  title="Picture-in-Picture (P)"
                  aria-label="Picture-in-Picture"
                >
                  <Icons.PiP />
                </button>
              )}

              {/* Diagonal Crimson Fullscreen Icon (matching reference image) */}
              <button
                className="gp-icon-btn"
                style={S.dockBtn}
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
          className="gp-ep-bar"
          style={{
            ...S.epBar,
            opacity: ctrlVisible || mode === "iframe" ? 1 : 0,
            pointerEvents: ctrlVisible || mode === "iframe" ? "auto" : "none",
            transition: "opacity 0.28s ease",
          }}
        >
          <button
            className="gp-icon-btn"
            style={{ ...S.epNav, opacity: hasPrev ? 1 : 0.25 }}
            onClick={() => hasPrev && goToEpisode(currentIndex - 1)}
            disabled={!hasPrev}
            title="Previous Episode"
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
                  }}
                  onClick={() => goToEpisode(idx)}
                  title={ep.title || `Episode ${idx + 1}`}
                >
                  <span style={S.epDotNum}>
                    {ep.episode ? `E${ep.episode}` : idx + 1}
                  </span>
                  {ep.title && (
                    <span className="gp-hide-xs" style={S.epDotTitle}>
                      {ep.title}
                    </span>
                  )}
                  {isActive && <span style={S.epDotBar} />}
                </button>
              );
            })}
          </div>

          <button
            className="gp-icon-btn"
            style={{ ...S.epNav, opacity: hasNext ? 1 : 0.25 }}
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
        <div style={{ ...S.errorToast, bottom: isSeries ? EP_BAR_H + 16 : 96 }}>
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
.gp-root, .gp-root * { box-sizing: border-box; }

@keyframes gp-spin       { to { transform: rotate(360deg); } }
@keyframes gp-spin-rev   { to { transform: rotate(-360deg); } }
@keyframes gp-dot        { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(-50%,-50%) scale(0.35);opacity:0.25} }
@keyframes gp-flash-ring { 0%{opacity:0;transform:scale(0.65)}25%{opacity:1;transform:scale(1)}75%{opacity:0.9;transform:scale(1)}100%{opacity:0;transform:scale(1.2)} }
@keyframes gp-flash-icon { 0%{opacity:0;transform:scale(0.6)}30%{opacity:1;transform:scale(1.08)}75%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.05)} }
@keyframes gp-skip-pop   { 0%{opacity:0;transform:translateY(-50%) scale(0.85)}18%{opacity:1;transform:translateY(-50%) scale(1.04)}32%{transform:translateY(-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-50%) scale(0.96)} }
@keyframes gp-text-pulse { 0%,100%{opacity:0.4}50%{opacity:0.9} }

.gp-icon-btn {
  transition: transform 0.16s ease, color 0.16s ease, opacity 0.16s ease !important;
}
.gp-icon-btn:hover {
  transform: scale(1.1);
  color: #fff !important;
}
.gp-icon-btn:active {
  transform: scale(0.92);
}

.gp-ring-play {
  transition: transform 0.18s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s ease, background 0.2s ease !important;
}
.gp-ring-play:hover {
  transform: scale(1.08);
  background: rgba(229, 9, 20, 0.18) !important;
  box-shadow: 0 0 22px rgba(229, 9, 20, 0.55) !important;
}
.gp-ring-play:active {
  transform: scale(0.94);
}

.gp-menu-row {
  transition: background 0.15s ease;
}
.gp-menu-row:hover {
  background: rgba(255, 255, 255, 0.09) !important;
}

.gp-track:hover .gp-track-rail {
  height: 9px !important;
}
.gp-track-rail {
  transition: height 0.15s ease;
}

input[type=range].gp-vol {
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,0.25);
  border-radius: 999px;
}
input[type=range].gp-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(229,9,20,0.8);
}
input[type=range].gp-vol::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
  cursor: pointer;
}
.gp-ep-bar::-webkit-scrollbar,
.gp-ep-bar div::-webkit-scrollbar { display: none; }

video::cue {
  background: rgba(8, 8, 10, 0.78);
  backdrop-filter: blur(8px);
  color: #fff;
  font-family: 'Inter', -apple-system, sans-serif;
  font-size: clamp(0.95rem, 2.2vw, 1.35rem);
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  text-shadow: 0 2px 6px rgba(0,0,0,0.95);
}

@media (max-width: 640px) {
  .gp-hide-xs { display: none !important; }
  .gp-root { overscroll-behavior: contain; }
  .gp-header {
    padding-top: max(12px, env(safe-area-inset-top)) !important;
    padding-left: max(12px, env(safe-area-inset-left)) !important;
    padding-right: max(12px, env(safe-area-inset-right)) !important;
    min-height: 62px !important;
  }
  .gp-title-text {
    max-width: min(56vw, 220px) !important;
    font-size: 0.96rem !important;
  }
  .gp-desc-text {
    max-width: min(56vw, 220px) !important;
    font-size: 0.74rem !important;
  }
  .gp-ctrl-bar {
    padding-left: max(12px, env(safe-area-inset-left)) !important;
    padding-right: max(12px, env(safe-area-inset-right)) !important;
    padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)) !important;
  }
  .gp-ring-play {
    width: 38px !important;
    height: 38px !important;
    font-size: 16px !important;
  }
  .gp-settings-menu {
    position: fixed !important;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 74px) !important;
    top: auto !important;
    right: max(10px, env(safe-area-inset-right, 0px)) !important;
    left: auto !important;
    width: min(320px, calc(100vw - 20px)) !important;
    max-height: calc(100dvh - 140px) !important;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .gp-settings-menu > button {
    min-height: 44px !important;
  }
}

@supports (height: 100dvh) {
  .gp-root { height: 100dvh !important; }
}
`;

// ─── Style constants ──────────────────────────────────────────────────────────
const C = {
  red: "#e50914",
  redB: "#ff1f2d",
  redGlow: "rgba(229, 9, 20, 0.45)",
  glassStrong: "rgba(12, 12, 15, 0.94)",
  border: "rgba(255, 255, 255, 0.14)",
  borderTop: "rgba(255, 255, 255, 0.24)",
  text: "#f5f5f7",
  dim: "rgba(255, 255, 255, 0.65)",
  muted: "rgba(255, 255, 255, 0.42)",
};
const F = {
  font: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
};
const r = (v) => ({ borderRadius: v });
const abs = { position: "absolute" };

const S = {
  root: {
    position: "fixed",
    inset: 0,
    width: "100%",
    height: "100vh",
    background: "#000",
    overflow: "hidden",
    overscrollBehavior: "contain",
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
  topScrim: {
    ...abs,
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    background: "linear-gradient(180deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 55%, transparent 100%)",
    pointerEvents: "none",
    zIndex: 300,
  },
  bottomScrim: {
    ...abs,
    left: 0,
    right: 0,
    height: 150,
    background: "linear-gradient(0deg, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)",
    pointerEvents: "none",
    zIndex: 300,
  },
  iframeWrap: { ...abs, top: 0, left: 0, right: 0 },
  iframe: { width: "100%", height: "100%", border: "none", background: "#000", display: "block" },

  // Double-Chevron Skip Overlay ("10 seconds" matching reference image)
  skipZone: {
    ...abs,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    pointerEvents: "none",
    zIndex: 380,
    animation: "gp-skip-pop 0.85s cubic-bezier(0.22,1,0.36,1) forwards",
  },
  skipChevronRow: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 42,
    lineHeight: 1,
    filter: "drop-shadow(0 4px 18px rgba(0,0,0,0.85))",
  },
  skipText: {
    color: "rgba(255, 255, 255, 0.88)",
    fontSize: "0.88rem",
    fontWeight: 600,
    letterSpacing: "0.2px",
    textShadow: "0 2px 10px rgba(0,0,0,0.9)",
  },

  loaderWrap: { ...abs, inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, zIndex: 200 },
  spinWrap: { position: "relative", width: 58, height: 58 },
  spinRing: { ...abs, borderRadius: "50%", border: "2px solid transparent" },
  sr1: { inset: 0, borderTopColor: C.red, borderRightColor: "rgba(229,9,20,0.22)", animation: "gp-spin 0.8s cubic-bezier(0.5,0.1,0.5,0.9) infinite" },
  sr2: { inset: 9, borderTopColor: "rgba(255,255,255,0.35)", animation: "gp-spin-rev 1.1s linear infinite" },
  sr3: { inset: 18, borderTopColor: "rgba(229,9,20,0.45)", animation: "gp-spin 1.4s linear infinite" },
  spinDot: { ...abs, width: 8, height: 8, background: C.red, borderRadius: "50%", top: "50%", left: "50%", boxShadow: `0 0 12px ${C.red}`, animation: "gp-dot 1.1s ease-in-out infinite" },
  loaderText: { color: C.dim, fontSize: "0.66rem", fontFamily: F.mono, letterSpacing: "2px", fontWeight: 600, textTransform: "uppercase", animation: "gp-text-pulse 2s ease-in-out infinite" },

  bufWrap: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 190, pointerEvents: "none" },
  bufRing: { width: 42, height: 42, border: "3px solid rgba(255,255,255,0.14)", borderTopColor: C.red, borderRadius: "50%", animation: "gp-spin 0.68s linear infinite" },

  flash: { ...abs, top: "50%", left: "50%", width: 76, height: 76, marginLeft: -38, marginTop: -38, pointerEvents: "none", zIndex: 380 },
  flashRing: { ...abs, inset: 0, borderRadius: "50%", background: "rgba(15, 15, 18, 0.72)", backdropFilter: "blur(12px)", border: `2px solid ${C.red}`, boxShadow: `0 0 24px ${C.redGlow}`, animation: "gp-flash-ring 0.68s ease-out forwards", zIndex: 3 },
  flashIcon: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.redB, fontSize: 28, animation: "gp-flash-icon 0.62s ease-out forwards", zIndex: 5 },

  // Top Header (Matching Reference Image: Vertical Red Strip + Title + Description + Right Logo)
  header: {
    ...abs,
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "max(22px, env(safe-area-inset-top)) max(26px, env(safe-area-inset-right)) 12px max(26px, env(safe-area-inset-left))",
    gap: 16,
    zIndex: 600,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
    flex: 1,
  },
  backBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.08)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: "50%",
    width: 38,
    height: 38,
    cursor: "pointer",
    flexShrink: 0,
    fontSize: 18,
  },
  titleBlock: {
    display: "flex",
    alignItems: "stretch",
    gap: 14,
    minWidth: 0,
  },
  redAccentBar: {
    width: 4.5,
    minHeight: 46,
    background: C.red,
    borderRadius: 2,
    flexShrink: 0,
    boxShadow: `0 0 14px ${C.redGlow}`,
  },
  titleTextCol: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    minWidth: 0,
  },
  titleText: {
    color: "#fff",
    fontSize: "1.18rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "min(520px, 52vw)",
    letterSpacing: "-0.2px",
    lineHeight: 1.2,
    textShadow: "0 2px 12px rgba(0,0,0,0.9)",
  },
  descText: {
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: "0.86rem",
    fontWeight: 400,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "min(520px, 52vw)",
    lineHeight: 1.25,
    textShadow: "0 1px 8px rgba(0,0,0,0.9)",
  },
  epBadge: {
    background: C.red,
    color: "#fff",
    fontSize: "0.6rem",
    fontWeight: 800,
    padding: "2px 7px",
    ...r(4),
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    flexShrink: 0,
  },
  topRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    paddingTop: 2,
  },
  brandLogoText: {
    color: "#fff",
    fontSize: "1.05rem",
    fontWeight: 900,
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    opacity: 0.92,
    textShadow: "0 2px 12px rgba(0,0,0,0.85)",
    marginRight: 4,
  },
  topActionBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.78)",
    width: 36,
    height: 36,
    cursor: "pointer",
    fontSize: 18,
  },
  topActionActive: {
    color: C.redB,
  },

  // Bottom Control Dock (Matching Reference Image Layout)
  ctrlBar: {
    ...abs,
    left: 0,
    right: 0,
    zIndex: 600,
    paddingTop: 14,
    paddingLeft: "max(24px, env(safe-area-inset-left))",
    paddingRight: "max(24px, env(safe-area-inset-right))",
  },
  track: {
    position: "relative",
    width: "100%",
    height: 28,
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    touchAction: "none",
    marginBottom: 8,
  },
  hoverTooltip: {
    ...abs,
    bottom: 24,
    transform: "translateX(-50%)",
    background: C.glassStrong,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    border: `1px solid ${C.border}`,
    color: "#fff",
    fontSize: "0.72rem",
    fontWeight: 700,
    fontFamily: F.mono,
    padding: "4px 9px",
    ...r(6),
    pointerEvents: "none",
    boxShadow: "0 6px 18px rgba(0,0,0,0.8)",
    whiteSpace: "nowrap",
  },
  trackBg: {
    ...abs,
    left: 0,
    right: 0,
    top: "50%",
    height: 6.5,
    transform: "translateY(-50%)",
    background: "rgba(110, 114, 124, 0.45)",
    ...r(999),
    overflow: "hidden",
  },
  trackBuffer: {
    ...abs,
    left: 0,
    top: 0,
    bottom: 0,
    background: "rgba(255, 255, 255, 0.22)",
    ...r(999),
  },
  trackWhiteFill: {
    ...abs,
    left: 0,
    top: 0,
    bottom: 0,
    background: "#ffffff",
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
  },
  trackRedCap: {
    ...abs,
    top: 0,
    bottom: 0,
    background: C.red,
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
    boxShadow: `0 0 12px ${C.redGlow}`,
  },

  bottomRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    pointerEvents: "auto",
  },
  bottomLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  bottomRight: {
    display: "flex",
    alignItems: "center",
    gap: 18,
  },
  // Circular red-ringed Play/Pause button matching reference image
  ringPlayBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    height: 42,
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.35)",
    border: `2px solid ${C.red}`,
    color: C.redB,
    cursor: "pointer",
    fontSize: 18,
    flexShrink: 0,
    boxShadow: `0 0 14px rgba(229, 9, 20, 0.25)`,
  },
  dockBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    color: "#ffffff",
    cursor: "pointer",
    padding: 4,
    width: 36,
    height: 36,
    fontSize: 22,
    flexShrink: 0,
  },
  volWrap: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  volSliderWrap: {
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    transition: "width 0.22s ease, opacity 0.2s ease, margin 0.22s ease",
  },
  volSlider: {
    width: 72,
    cursor: "pointer",
    height: 4,
  },
  timeDisplay: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: F.font,
    fontSize: "0.92rem",
    fontWeight: 600,
    letterSpacing: "0.2px",
    whiteSpace: "nowrap",
  },
  timeCurrent: {
    color: "#ffffff",
  },
  timeSlash: {
    color: C.red,
    fontWeight: 800,
  },
  timeTotal: {
    color: "rgba(255, 255, 255, 0.58)",
  },

  // Settings & Speed Popover (opens cleanly upward from bottom-right controls)
  settingsMenu: {
    ...abs,
    bottom: 48,
    right: 0,
    width: 280,
    background: C.glassStrong,
    backdropFilter: "blur(32px) saturate(180%)",
    WebkitBackdropFilter: "blur(32px) saturate(180%)",
    border: `1px solid ${C.border}`,
    borderTopColor: C.borderTop,
    ...r(14),
    padding: "8px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.95)",
    zIndex: 900,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    maxHeight: "min(65vh, 460px)",
    overflowY: "auto",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
  },
  menuHeader: {
    fontSize: "0.64rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "1.2px",
    color: C.muted,
    padding: "6px 10px 6px",
  },
  menuRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#fff",
    padding: "9px 10px",
    ...r(9),
    fontSize: "0.78rem",
    fontWeight: 600,
    fontFamily: F.font,
    cursor: "pointer",
  },
  menuRowLeft: { display: "flex", alignItems: "center", gap: 10, fontSize: "0.8rem" },
  menuIconBox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    ...r(7),
    background: "rgba(255,255,255,0.07)",
    color: C.text,
    fontSize: 14,
  },
  menuRowRight: { display: "flex", alignItems: "center", gap: 6, color: C.dim, fontSize: "0.72rem" },
  menuPill: {
    background: "rgba(255,255,255,0.08)",
    padding: "2px 8px",
    ...r(6),
    fontSize: "0.68rem",
    fontWeight: 600,
    color: C.text,
    maxWidth: 105,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  menuBackRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: "rgba(255,255,255,0.07)",
    border: "none",
    color: "#fff",
    padding: "9px 10px",
    marginBottom: 4,
    ...r(9),
    fontSize: "0.78rem",
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
    padding: "9px 12px",
    ...r(8),
    fontSize: "0.77rem",
    fontWeight: 500,
    fontFamily: F.font,
    cursor: "pointer",
    textAlign: "left",
  },
  menuEmpty: { padding: "10px 10px", fontSize: "0.72rem", color: C.muted, textAlign: "center", lineHeight: 1.45 },
  menuNotice: {
    marginTop: 6,
    padding: "10px 10px",
    background: "rgba(245, 158, 11, 0.12)",
    border: "1px solid rgba(245, 158, 11, 0.28)",
    ...r(10),
    fontSize: "0.69rem",
    color: "#fde68a",
  },
  menuVlcBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    padding: "8px 10px",
    background: C.red,
    color: "#fff",
    ...r(8),
    fontSize: "0.73rem",
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
    padding: "9px 10px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#fff",
    ...r(9),
    fontSize: "0.73rem",
    fontWeight: 600,
    fontFamily: F.font,
    cursor: "pointer",
  },
  shortcutGrid: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "8px 12px",
    alignItems: "center",
    padding: "6px 10px",
    fontSize: "0.73rem",
    color: C.dim,
  },
  kbd: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.18)",
    ...r(5),
    padding: "2px 6px",
    fontSize: "0.65rem",
    fontFamily: F.mono,
    color: "#fff",
    textAlign: "center",
  },

  adBadge: { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", color: "#34d399", ...r(10), padding: "6px 10px", fontSize: 13, flexShrink: 0 },
  adBadgePartial: { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.34)", color: "#fbbf24" },

  lockShield: { ...abs, inset: 0, zIndex: 800, background: "transparent", cursor: "pointer" },
  lockPeek: {
    ...abs,
    top: "max(20px, env(safe-area-inset-top))",
    right: "max(20px, env(safe-area-inset-right))",
    zIndex: 850,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(18, 18, 22, 0.88)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: `1px solid ${C.red}`,
    color: "#fff",
    ...r(999),
    padding: "0 16px",
    height: 40,
    cursor: "pointer",
    fontSize: 15,
    boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
  },

  gesturePanel: {
    ...abs,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    background: C.glassStrong,
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: `1px solid ${C.border}`,
    ...r(22),
    padding: "16px 12px",
    minWidth: 48,
    color: "#fff",
    zIndex: 750,
    pointerEvents: "none",
  },
  gestureTrack: { width: 5, height: 96, background: "rgba(255,255,255,0.12)", borderRadius: 999, position: "relative", overflow: "hidden" },
  gestureFill: { ...abs, bottom: 0, left: 0, width: "100%", borderRadius: 999, transition: "height 0.04s linear" },

  cardOverlay: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", zIndex: 460, padding: 16 },
  glassCard: {
    background: "linear-gradient(165deg, rgba(24,24,28,0.96), rgba(12,12,15,0.98))",
    border: `1px solid ${C.border}`,
    borderTopColor: C.borderTop,
    ...r(20),
    padding: "28px 24px",
    textAlign: "center",
    maxWidth: 410,
    width: "100%",
    boxShadow: "0 32px 90px rgba(0,0,0,0.95)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  warnIconWrap: { width: 54, height: 54, borderRadius: "50%", background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fbbf24", marginBottom: 12, fontSize: 24 },
  pillBadge: { background: "rgba(245,158,11,0.16)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)", fontSize: "0.6rem", fontWeight: 800, fontFamily: F.mono, padding: "3px 10px", ...r(999), letterSpacing: "1px", marginBottom: 10 },
  cardTitle: { color: "#fff", fontSize: "1.1rem", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.3px" },
  cardFile: { color: C.text, fontSize: "0.73rem", fontFamily: F.mono, background: "rgba(255,255,255,0.06)", padding: "7px 11px", ...r(9), width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 10, border: "1px solid rgba(255,255,255,0.08)" },
  cardReason: { color: C.dim, fontSize: "0.79rem", lineHeight: 1.55, margin: "0 0 20px" },
  cardActions: { display: "flex", gap: 10, width: "100%" },
  actionBtn: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, ...r(12), padding: "12px 14px", fontSize: "0.8rem", fontWeight: 700, fontFamily: F.font, minHeight: 44, cursor: "pointer", textDecoration: "none" },
  actionPrimary: { background: `linear-gradient(135deg, ${C.redB}, ${C.red})`, color: "#fff", border: "none", boxShadow: `0 6px 24px ${C.redGlow}` },
  actionSecondary: { background: "rgba(255,255,255,0.08)", color: C.text, border: "1px solid rgba(255,255,255,0.14)" },

  resumeIcon: { width: 52, height: 52, borderRadius: "50%", background: "rgba(229,9,20,0.14)", border: "1px solid rgba(229,9,20,0.36)", display: "flex", alignItems: "center", justifyContent: "center", color: C.red, marginBottom: 12, fontSize: 20 },
  resumeSub: { color: C.dim, fontSize: "0.74rem", fontWeight: 500, marginBottom: 14, fontFamily: F.mono },
  resumeBar: { width: "100%", height: 5, background: "rgba(255,255,255,0.1)", ...r(999), overflow: "hidden", marginBottom: 20 },
  resumeBarFill: { height: "100%", background: `linear-gradient(to right, #fff, ${C.red})`, ...r(999) },

  apLabel: { color: C.redB, fontSize: "0.58rem", fontWeight: 800, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 8 },
  apTitle: { color: "#fff", fontSize: "1.02rem", fontWeight: 800, marginBottom: 16, lineHeight: 1.4 },
  apRing: { position: "relative", width: 64, height: 64, margin: "0 auto 10px" },
  apNum: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.24rem", fontWeight: 900 },
  apHint: { color: C.dim, fontSize: "0.72rem", marginBottom: 16 },
  apNow: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", color: "#000", border: "none", ...r(12), padding: "12px 16px", fontSize: "0.82rem", fontWeight: 800, fontFamily: F.font, cursor: "pointer", minHeight: 44 },

  // Series Episode Dock
  epBar: {
    ...abs,
    left: 0,
    right: 0,
    bottom: 0,
    height: 68,
    paddingBottom: "env(safe-area-inset-bottom)",
    zIndex: 620,
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingLeft: "max(16px, env(safe-area-inset-left))",
    paddingRight: "max(16px, env(safe-area-inset-right))",
    background: "rgba(6, 6, 8, 0.96)",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  epScroll: { display: "flex", gap: 8, overflowX: "auto", flex: 1, scrollbarWidth: "none", WebkitOverflowScrolling: "touch", padding: "6px 2px", alignItems: "center" },
  epDot: {
    position: "relative",
    flexShrink: 0,
    minWidth: 46,
    maxWidth: 180,
    height: 44,
    padding: "0 12px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    ...r(10),
    color: C.dim,
    fontSize: "0.76rem",
    fontWeight: 700,
    fontFamily: F.mono,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    whiteSpace: "nowrap",
    transition: "all 0.18s ease",
  },
  epDotActive: {
    background: "rgba(229,9,20,0.22)",
    borderColor: C.red,
    color: "#fff",
    fontWeight: 800,
  },
  epDotNum: { lineHeight: 1, position: "relative", zIndex: 1 },
  epDotTitle: {
    fontFamily: F.font,
    fontSize: "0.72rem",
    fontWeight: 500,
    opacity: 0.85,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  epDotBar: { position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 18, height: 2.5, background: C.red, borderRadius: 999 },
  epNav: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "50%", color: "#fff", cursor: "pointer", fontSize: 16, flexShrink: 0 },

  errorToast: { ...abs, left: "50%", transform: "translateX(-50%)", background: "rgba(155, 14, 22, 0.94)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", color: "#fff", padding: "12px 16px", ...r(14), fontSize: "0.75rem", fontWeight: 600, zIndex: 700, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.88)", width: "min(92vw, 490px)", border: "1px solid rgba(255,255,255,0.16)" },
  dlBtn: { display: "inline-flex", alignItems: "center", gap: 5, color: "#fff", background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.2)", ...r(8), padding: "6px 10px", textDecoration: "none", fontSize: "0.7rem", fontWeight: 700, fontFamily: F.font, flexShrink: 0, cursor: "pointer" },
};