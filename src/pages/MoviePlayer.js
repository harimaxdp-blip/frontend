import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Hls from "hls.js";
import "./Movies2.css";
<<<<<<< HEAD
import { ScreenOrientation } from "@capacitor/screen-orientation";
import {
  FaPlay, FaPause, FaExpand, FaCompress,
  FaVolumeMute, FaVolumeUp, FaVolumeDown,
  FaStepForward, FaStepBackward,
  FaChevronLeft, FaRedo, FaUndo,
  FaMusic, FaSync, FaExclamationTriangle,
  FaDownload, FaCheckCircle, FaTimes,
} from "react-icons/fa";

// ─── Format helpers ───────────────────────────────────────────────────────────
=======

// ─── Format regexes ───────────────────────────────────────────────────────────
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
const FORMAT_DIRECT_RE = /\.(mp4|m3u8|webm|mkv|avi|mov|ts|flv|ogv|3gp|wmv)($|\?)/i;
const FORMAT_HLS_RE    = /\.m3u8($|\?)/i;
const FORMAT_MKV_RE    = /\.mkv($|\?)/i;
const FORMAT_FLV_RE    = /\.flv($|\?)/i;
const FORMAT_TS_RE     = /\.(ts|mts)($|\?)/i;
const FORMAT_DASH_RE   = /\.mpd($|\?)/i;

function getExtension(url) {
  return (url.split("?")[0].split(".").pop() ?? "").toLowerCase();
}
function isCrossOrigin(url) {
  try { return new URL(url).origin !== window.location.origin; }
  catch { return false; }
}

<<<<<<< HEAD
// ─── Ad-block ────────────────────────────────────────────────────────────────
const AD_DOMAINS = [
  "doubleclick.net","googlesyndication.com","googletagmanager.com",
  "googletagservices.com","adservice.google.com","adnxs.com",
  "advertising.com","amazon-adsystem.com","moatads.com","scorecardresearch.com",
  "quantserve.com","outbrain.com","taboola.com","popads.net","popcash.net",
  "trafficjunky.net","exoclick.com","juicyads.com","hilltopads.net",
  "propellerads.com","adsterra.com","clickadu.com","adcash.com",
  "media.net","bidvertiser.com","revcontent.com","mgid.com","content.ad",
];
function isAdUrl(url) {
  try {
    const h = new URL(url).hostname;
    return AD_DOMAINS.some(d => h === d || h.endsWith("." + d));
  } catch { return false; }
}
// Patch fetch & XHR to block ads
const _origFetch = window.fetch;
window.fetch = function(input, init) {
  const url = typeof input === "string" ? input : (input?.url ?? "");
  if (isAdUrl(url)) return Promise.resolve(new Response("", { status: 204 }));
  return _origFetch.call(this, input, init);
};
const _origXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  if (isAdUrl(url)) { this._blocked = true; return; }
  return _origXHROpen.call(this, method, url, ...rest);
};
const _origXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(...args) {
  if (this._blocked) return;
  return _origXHRSend.apply(this, args);
};

// ─── Service Worker ───────────────────────────────────────────────────────────
=======
// ─── Service Worker registration ──────────────────────────────────────────────
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
let swRegistered = false;
async function ensureServiceWorker() {
  if (swRegistered) return true;
  if (!("serviceWorker" in navigator)) return false;
  try {
<<<<<<< HEAD
    const check = await fetch("/video-sw.js", { method: "HEAD" });
    const mime  = check.headers.get("content-type") ?? "";
    if (!check.ok || mime.includes("text/html")) return false;
    const reg = await navigator.serviceWorker.register("/video-sw.js", { scope: "/" });
    await new Promise(resolve => {
      if (reg.active) { resolve(); return; }
      const w = reg.installing || reg.waiting;
      if (!w) { resolve(); return; }
      w.addEventListener("statechange", () => { if (w.state === "activated") resolve(); });
=======
    // Pre-check: verify the file actually exists and is JS, not an HTML 404 page.
    // CRA only serves files from /public/ as static assets — if video-sw.js
    // isn't there yet, this check returns false gracefully instead of throwing.
    const check = await fetch("/video-sw.js", { method: "HEAD" });
    const mime  = check.headers.get("content-type") ?? "";
    if (!check.ok || mime.includes("text/html")) {
      console.warn(
        "[SW] video-sw.js not found or returned HTML. " +
        "Place video-sw.js inside your project's /public/ folder and restart the dev server."
      );
      return false;
    }

    const reg = await navigator.serviceWorker.register("/video-sw.js", { scope: "/" });
    await new Promise((resolve) => {
      if (reg.active) { resolve(); return; }
      const worker = reg.installing || reg.waiting;
      if (!worker) { resolve(); return; }
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") resolve();
      });
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
      setTimeout(resolve, 3000);
    });
    swRegistered = true;
    return true;
<<<<<<< HEAD
  } catch { return false; }
}

// ─── mpegts.js loader ────────────────────────────────────────────────────────
let mpegtsPromise = null;
function loadMpegts() {
  if (!mpegtsPromise) {
    mpegtsPromise = new Promise((resolve, reject) => {
=======
  } catch (e) {
    console.warn("[SW] Registration failed:", e);
    return false;
  }
}

// ─── mpegts.js lazy loader ────────────────────────────────────────────────────
let mpegtsScript = null;
function loadMpegts() {
  if (!mpegtsScript) {
    mpegtsScript = new Promise((resolve, reject) => {
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
      if (window.mpegts) { resolve(window.mpegts); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.js";
      s.onload  = () => window.mpegts ? resolve(window.mpegts) : reject(new Error("mpegts missing"));
      s.onerror = () => reject(new Error("mpegts load failed"));
      document.head.appendChild(s);
    });
  }
<<<<<<< HEAD
  return mpegtsPromise;
}

// ─── Orientation ─────────────────────────────────────────────────────────────
async function lockLandscape() {
  try { await ScreenOrientation.lock({ orientation: "landscape" }); } catch {}
}
async function unlockOrientation() {
  try { await ScreenOrientation.unlock(); } catch {}
}

// ─── Ad overlay removal ───────────────────────────────────────────────────────
function removeAdOverlays() {
  const sels = [
    '[class*="ad-"]','[class*="-ad"]','[id*="ad-"]','[id*="-ad"]',
    '[class*="banner"]','[class*="popup"]',
    'ins.adsbygoogle','iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]',
    'iframe[src*="adnxs"]','iframe[src*="exoclick"]','div[data-ad]',
    '[class*="sponsor"]','[class*="promo"]',
  ];
  sels.forEach(sel =>
    document.querySelectorAll(sel).forEach(el => {
      if (!el.closest(".mp-card") && !el.closest("video")) el.remove();
    })
  );
}

// ─── Watch position storage ───────────────────────────────────────────────────
function watchKey(title) {
  return `hm-pos-${(title || "unknown").replace(/\s+/g,"_").toLowerCase()}`;
}
function savePos(title, t) {
  if (!title || !t || t < 5) return;
  try { localStorage.setItem(watchKey(title), String(Math.floor(t))); } catch {}
}
function loadPos(title) {
  try { return parseInt(localStorage.getItem(watchKey(title)) || "0", 10) || 0; } catch { return 0; }
}
function clearPos(title) {
  try { localStorage.removeItem(watchKey(title)); } catch {}
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────
function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function fmt(s) {
  if (!s || isNaN(s)) return "0:00";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}

function VolumeIcon({ muted, volume, size = 16 }) {
  if (muted || volume === 0) return <FaVolumeMute size={size} />;
  if (volume < 0.5)          return <FaVolumeDown size={size} />;
  return <FaVolumeUp size={size} />;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TOTAL_SECS   = 5;
const SAVE_EVERY   = 5;   // seconds
const AUDIO_MIN    = 0;   // seconds (Web Audio DelayNode only supports >= 0)
const AUDIO_MAX    = 5;
const AUDIO_STEP   = 0.05;

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie    = location.state?.movie;

  const handleGoBack = useCallback(() => {
    try { window.history.length > 1 ? navigate(-1) : navigate("/", { replace: true }); }
    catch { navigate("/", { replace: true }); }
  }, [navigate]);

  const playlist   = location.state?.playlist     ?? null;
  const startIndex = location.state?.currentIndex ?? 0;
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  const isSeries       = Array.isArray(playlist) && playlist.length > 1;
  const currentEpisode = isSeries ? playlist[currentIndex] : movie;
  const hasNext        = isSeries && currentIndex < playlist.length - 1;
  const hasPrev        = isSeries && currentIndex > 0;

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const videoRef         = useRef(null);
  const containerRef     = useRef(null);
  const hlsRef           = useRef(null);
  const mpegtsRef        = useRef(null);
  // Audio graph refs — only created when user opens sync panel
  const audioCtxRef      = useRef(null);
  const audioSrcRef      = useRef(null); // MediaElementSourceNode
  const delayNodeRef     = useRef(null);
  const gainNodeRef      = useRef(null);
  // Timers / flags
  const countdownRef     = useRef(null);
  const endTriggeredRef  = useRef(false);
  const swReadyRef       = useRef(false);
  const controlsTimerRef = useRef(null);
  const adObserverRef    = useRef(null);
  const progressTrackRef = useRef(null);
  const lastSaveRef      = useRef(0);
  const audioUnlockedRef = useRef(false);

  // ─── State ────────────────────────────────────────────────────────────────
  const [mode, setMode]                         = useState("loading");
  const [directUrl, setDirectUrl]               = useState("");
  const [iframeUrl, setIframeUrl]               = useState("");
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState("");
  const [playerEngine, setPlayerEngine]         = useState("");
  const [swStatus, setSwStatus]                 = useState("loading");

  // Playback state
  const [isPlaying, setIsPlaying]               = useState(false);
  const [currentTime, setCurrentTime]           = useState(0);
  const [duration, setDuration]                 = useState(0);
  const [volume, setVolume]                     = useState(1);
  const [isMuted, setIsMuted]                   = useState(false);
  const [isBuffering, setIsBuffering]           = useState(false);
  const [isFullscreen, setIsFullscreen]         = useState(false);

  // UI visibility
  const [showControls, setShowControls]         = useState(true);
  const [showVolumeBar, setShowVolumeBar]       = useState(false);
  const [focusedControl, setFocusedControl]     = useState("play");
  const [countdown, setCountdown]               = useState(null);
  const [seekPreview, setSeekPreview]           = useState(null);
  const [scrubPercent, setScrubPercent]         = useState(null);
  const [isScrubbing, setIsScrubbing]           = useState(false);

  // Resume
  const [resumeTime, setResumeTime]             = useState(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  // Audio sync panel — Web Audio graph is ONLY built when user opens this
  const [showAudioPanel, setShowAudioPanel]     = useState(false);
  const [audioDelay, setAudioDelay]             = useState(0);   // seconds delay
  const [audioGraphReady, setAudioGraphReady]   = useState(false);

  // ─── Controls hide timer ──────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3500);
  }, []);

  useEffect(() => { resetControlsTimer(); }, [isPlaying]); // eslint-disable-line

  // ─── Ad observer ─────────────────────────────────────────────────────────
  useEffect(() => {
    removeAdOverlays();
    adObserverRef.current = new MutationObserver(removeAdOverlays);
    adObserverRef.current.observe(document.body, { childList: true, subtree: true });
    return () => adObserverRef.current?.disconnect();
  }, []);

  // ─── Service Worker ───────────────────────────────────────────────────────
  useEffect(() => {
    ensureServiceWorker().then(ok => {
=======
  return mpegtsScript;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;

  const playlist   = location.state?.playlist     ?? null;
  const startIndex = location.state?.currentIndex ?? 0;

  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const isSeries       = Array.isArray(playlist) && playlist.length > 1;
  const currentEpisode = isSeries ? playlist[currentIndex] : movie;

  const videoRef        = useRef(null);
  const hlsRef          = useRef(null);
  const mpegtsRef       = useRef(null);
  const audioCtxRef     = useRef(null);
  const delayNodeRef    = useRef(null);
  const countdownRef    = useRef(null);
  const endTriggeredRef = useRef(false);
  const swReadyRef      = useRef(false);

  const [mode, setMode]               = useState("loading");
  const [directUrl, setDirectUrl]     = useState("");
  const [iframeUrl, setIframeUrl]     = useState("");
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [playerEngine, setPlayerEngine] = useState("");
  const [isSyncActive, setIsSyncActive] = useState(false);
  const [audioOffset, setAudioOffset]   = useState(0);
  const [countdown, setCountdown]       = useState(null);
  // "loading" | "ready" | "unavailable"
  const [swStatus, setSwStatus]         = useState("loading");

  const hasNext = isSeries && currentIndex < playlist.length - 1;
  const hasPrev = isSeries && currentIndex > 0;
  const TOTAL_SECS = 5;

  // ─── Register SW on mount ─────────────────────────────────────────────────
  useEffect(() => {
    ensureServiceWorker().then((ok) => {
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
      swReadyRef.current = ok;
      setSwStatus(ok ? "ready" : "unavailable");
    });
  }, []);

<<<<<<< HEAD
  // ─── Fullscreen listener ──────────────────────────────────────────────────
  useEffect(() => {
    const onFS = () => {
      const fs = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      setIsFullscreen(fs);
      if (fs) lockLandscape(); else unlockOrientation();
    };
    const evts = ["fullscreenchange","webkitfullscreenchange","mozfullscreenchange","MSFullscreenChange"];
    evts.forEach(e => document.addEventListener(e, onFS));
    return () => evts.forEach(e => document.removeEventListener(e, onFS));
  }, []);

  // ─── AUDIO UNLOCK on first user gesture ──────────────────────────────────
  // This is CRITICAL for Android/Chrome — AudioContext must be resumed
  // inside a user gesture. We listen globally and unlock once.
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;
      // If audio graph already created but suspended, resume it now
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener("touchstart", unlock, { passive: true, once: true });
    window.addEventListener("touchend",   unlock, { passive: true, once: true });
    window.addEventListener("click",      unlock, { passive: true, once: true });
    window.addEventListener("keydown",    unlock, { passive: true, once: true });
    return () => {
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("touchend",   unlock);
      window.removeEventListener("click",      unlock);
      window.removeEventListener("keydown",    unlock);
    };
  }, []);

  // ─── BUILD AUDIO GRAPH (only when sync panel is opened) ──────────────────
  // KEY DESIGN: we do NOT call createMediaElementSource on every play.
  // We only build the graph when the user explicitly opens the audio panel.
  // This prevents silence from a broken/suspended AudioContext during normal playback.
  const buildAudioGraph = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    // Already built and working
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      // Just resume if suspended
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume().catch(() => {});
      }
      setAudioGraphReady(true);
      return;
    }

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { setAudioGraphReady(false); return; }

      const ctx = new AC();

      // Resume — this works because buildAudioGraph is called from a button click (user gesture)
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // createMediaElementSource reroutes audio — ONLY do this in the sync panel flow
      const src   = ctx.createMediaElementSource(video);
      const delay = ctx.createDelay(AUDIO_MAX + 0.5);
      const gain  = ctx.createGain();

      delay.delayTime.setValueAtTime(audioDelay, ctx.currentTime);
      gain.gain.setValueAtTime(1.0, ctx.currentTime);

      // Chain: source → delay → gain → speakers
      src.connect(delay);
      delay.connect(gain);
      gain.connect(ctx.destination);

      audioCtxRef.current  = ctx;
      audioSrcRef.current  = src;
      delayNodeRef.current = delay;
      gainNodeRef.current  = gain;
      setAudioGraphReady(true);
    } catch (err) {
      console.warn("[AudioGraph]", err);
      setAudioGraphReady(false);
    }
  }, [audioDelay]); // eslint-disable-line

  // ─── Destroy audio graph so normal playback isn't affected ───────────────
  const destroyAudioGraph = useCallback(() => {
    // Disconnect nodes so audio flows natively through video again
    try { audioSrcRef.current?.disconnect(); }  catch {}
    try { delayNodeRef.current?.disconnect(); } catch {}
    try { gainNodeRef.current?.disconnect(); }  catch {}
    try { audioCtxRef.current?.close(); }       catch {}
    audioCtxRef.current  = null;
    audioSrcRef.current  = null;
    delayNodeRef.current = null;
    gainNodeRef.current  = null;
    setAudioGraphReady(false);
  }, []);

  // ─── Update delay in real time ────────────────────────────────────────────
  const applyAudioDelay = useCallback((val) => {
    const safeVal = clamp(val, AUDIO_MIN, AUDIO_MAX);
    setAudioDelay(safeVal);
    if (delayNodeRef.current && audioCtxRef.current && audioCtxRef.current.state === "running") {
      delayNodeRef.current.delayTime.setTargetAtTime(safeVal, audioCtxRef.current.currentTime, 0.02);
    }
  }, []);

  const resetAudioDelay = useCallback(() => applyAudioDelay(0), [applyAudioDelay]);

  // When panel is opened: build graph. When closed: destroy so audio goes back to normal.
  useEffect(() => {
    if (showAudioPanel) {
      buildAudioGraph();
    } else {
      // Close panel → destroy graph → video audio plays natively again
      destroyAudioGraph();
      setAudioDelay(0);
    }
  }, [showAudioPanel]); // eslint-disable-line

  // ─── Destroy players (video engines) ─────────────────────────────────────
  const destroyPlayers = useCallback(() => {
    try { hlsRef.current?.destroy(); }    catch {} hlsRef.current    = null;
    try { mpegtsRef.current?.destroy(); } catch {} mpegtsRef.current = null;
    destroyAudioGraph();
  }, [destroyAudioGraph]);
=======
  // ─── Destroy players ─────────────────────────────────────────────────────
  const destroyPlayers = useCallback(() => {
    try { hlsRef.current?.destroy();    } catch {} hlsRef.current    = null;
    try { mpegtsRef.current?.destroy(); } catch {} mpegtsRef.current = null;
    try { audioCtxRef.current?.close(); } catch {} audioCtxRef.current = null;
    delayNodeRef.current = null;
  }, []);
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72

  // ─── Go to episode ────────────────────────────────────────────────────────
  const goToEpisode = useCallback((index) => {
    if (!isSeries || index < 0 || index >= playlist.length) return;
    destroyPlayers();
<<<<<<< HEAD
    clearInterval(countdownRef.current); countdownRef.current = null;
    endTriggeredRef.current = false;
    lastSaveRef.current = 0;
    setCountdown(null); setCurrentIndex(index); setMode("loading"); setLoading(true);
    setError(""); setDirectUrl(""); setIframeUrl(""); setPlayerEngine("");
    setCurrentTime(0); setDuration(0); setIsBuffering(false);
    setShowResumePrompt(false); setResumeTime(0);
    setShowAudioPanel(false); setAudioDelay(0);
  }, [isSeries, playlist, destroyPlayers]);

  // ─── Auto-play countdown ──────────────────────────────────────────────────
=======
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    endTriggeredRef.current = false;
    setCountdown(null);
    setCurrentIndex(index);
    setMode("loading");
    setLoading(true);
    setError("");
    setDirectUrl("");
    setIframeUrl("");
    setIsSyncActive(false);
    setPlayerEngine("");
  }, [isSeries, playlist, destroyPlayers]);

  // ─── Auto-play countdown ─────────────────────────────────────────────────
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
  const startAutoPlayCountdown = useCallback(() => {
    if (!hasNext || countdownRef.current || endTriggeredRef.current) return;
    endTriggeredRef.current = true;
    setCountdown(TOTAL_SECS);
    countdownRef.current = setInterval(() => {
<<<<<<< HEAD
      setCountdown(prev => {
=======
      setCountdown((prev) => {
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
        if (prev <= 1) { clearInterval(countdownRef.current); countdownRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [hasNext]);

<<<<<<< HEAD
  useEffect(() => { if (countdown === 0) goToEpisode(currentIndex + 1); }, [countdown]); // eslint-disable-line

  const cancelAutoPlay = useCallback(() => {
    clearInterval(countdownRef.current); countdownRef.current = null;
    setCountdown(null); endTriggeredRef.current = false;
  }, []);

  // ─── Playback controls ────────────────────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current; if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }
  function toggleMute() {
    const v = videoRef.current; if (!v) return;
    v.muted = !v.muted; setIsMuted(v.muted);
  }
  function setVolumeLevel(val) {
    const v = videoRef.current; if (!v) return;
    const vol = clamp(val); v.volume = vol; setVolume(vol);
    if (vol === 0) v.muted = true; else if (v.muted) { v.muted = false; setIsMuted(false); }
    setShowVolumeBar(true); clearTimeout(controlsTimerRef._volTimer);
    controlsTimerRef._volTimer = setTimeout(() => setShowVolumeBar(false), 2000);
  }
  function seekBy(delta) {
    const v = videoRef.current; if (!v) return;
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration || 0);
    showSeekFn(v.currentTime);
  }
  function showSeekFn(t) {
    setSeekPreview(t); clearTimeout(controlsTimerRef._seekTimer);
    controlsTimerRef._seekTimer = setTimeout(() => setSeekPreview(null), 1200);
  }

  async function toggleFullscreen() {
    const el = containerRef.current || document.documentElement;
    try {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement);
      if (!isFs) {
        if      (el.requestFullscreen)       await el.requestFullscreen({ navigationUI: "hide" });
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        else if (el.mozRequestFullScreen)    await el.mozRequestFullScreen();
        else if (el.msRequestFullscreen)     await el.msRequestFullscreen();
        try { await lockLandscape(); setTimeout(() => window.dispatchEvent(new Event("resize")), 300); } catch {}
      } else {
        if      (document.exitFullscreen)       await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen)  await document.mozCancelFullScreen();
        else if (document.msExitFullscreen)     await document.msExitFullscreen();
        await unlockOrientation();
      }
    } catch (e) { console.warn("[FS]", e); }
  }

  // ─── TV Remote / Keyboard ─────────────────────────────────────────────────
  useEffect(() => {
    const CTRL_ORDER = ["prev", "rewind", "play", "forward", "next", "fullscreen"];
    const onKey = (e) => {
      // Don't intercept when typing in an input
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      resetControlsTimer();
      const v = videoRef.current;

      switch (e.key) {
        // ── D-pad LEFT / RIGHT → seek or move focus ──
        case "ArrowLeft":
          e.preventDefault();
          if (mode === "direct" && v) seekBy(-10);
          setFocusedControl(prev => CTRL_ORDER[Math.max(0, CTRL_ORDER.indexOf(prev) - 1)]);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (mode === "direct" && v) seekBy(10);
          setFocusedControl(prev => CTRL_ORDER[Math.min(CTRL_ORDER.length - 1, CTRL_ORDER.indexOf(prev) + 1)]);
          break;

        // ── D-pad UP / DOWN → volume ──
        case "ArrowUp":
          e.preventDefault();
          if (v) setVolumeLevel(v.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (v) setVolumeLevel(v.volume - 0.1);
          break;

        // ── OK / SELECT / ENTER / SPACE → activate focused control ──
        case "Enter":
        case " ":
          e.preventDefault();
          activateFocused();
          break;

        // ── Media keys (Android TV / Bluetooth remote) ──
        case "MediaPlayPause":
          e.preventDefault(); togglePlay(); break;
        case "MediaRewind":
          e.preventDefault(); if (v) seekBy(-10); break;
        case "MediaFastForward":
          e.preventDefault(); if (v) seekBy(30); break;
        case "MediaStop":
          e.preventDefault(); if (v) { v.pause(); v.currentTime = 0; } break;
        case "MediaTrackNext":
          e.preventDefault(); if (hasNext) goToEpisode(currentIndex + 1); break;
        case "MediaTrackPrevious":
          e.preventDefault(); if (hasPrev) goToEpisode(currentIndex - 1); break;

        // ── Keyboard shortcuts ──
        case "k": case "K": togglePlay(); break;
        case "f": case "F": toggleFullscreen(); break;
        case "m": case "M": toggleMute(); break;

        // ── Back / Escape ──
        case "Escape":
        case "GoBack":
        case "XF86Back":
          e.preventDefault();
          if (isFullscreen) toggleFullscreen(); else handleGoBack();
          break;

        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, isFullscreen, hasNext, hasPrev, currentIndex, focusedControl]); // eslint-disable-line

  function activateFocused() {
    const v = videoRef.current;
    switch (focusedControl) {
      case "prev":       if (hasPrev) goToEpisode(currentIndex - 1); break;
      case "rewind":     if (v) seekBy(-10); break;
      case "play":       togglePlay(); break;
      case "forward":    if (v) seekBy(30); break;
      case "next":       if (hasNext) goToEpisode(currentIndex + 1); break;
      case "fullscreen": toggleFullscreen(); break;
      default: break;
    }
  }

  // ─── Scrub bar ────────────────────────────────────────────────────────────
  const getPct = useCallback((e) => {
    const track = progressTrackRef.current; if (!track) return null;
    const rect = track.getBoundingClientRect();
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    return clamp((x - rect.left) / rect.width);
  }, []);

  const applySeek = useCallback((pct) => {
    const v = videoRef.current; if (!v || !isFinite(v.duration)) return;
    const t = pct * v.duration;
    try { v.currentTime = t; } catch {}
    setScrubPercent(pct * 100); setSeekPreview(t);
  }, []);

  const onScrubStart = useCallback((e) => {
    e.preventDefault(); resetControlsTimer(); setIsScrubbing(true);
    const pct = getPct(e); if (pct !== null) applySeek(pct);
    try { progressTrackRef.current?.setPointerCapture(e.pointerId); } catch {}
  }, [resetControlsTimer, getPct, applySeek]);

  const onScrubMove = useCallback((e) => {
    if (!isScrubbing) return;
    const pct = getPct(e); if (pct !== null) applySeek(pct);
  }, [isScrubbing, getPct, applySeek]);

  const onScrubEnd = useCallback((e) => {
    if (!isScrubbing) return;
    setIsScrubbing(false); setScrubPercent(null);
    setTimeout(() => setSeekPreview(null), 800);
    try { progressTrackRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [isScrubbing]);

  // Touch scrub (separate for passive touch)
  const onTouchScrubStart = useCallback((e) => {
    e.preventDefault(); resetControlsTimer(); setIsScrubbing(true);
    const pct = getPct(e.touches[0]); if (pct !== null) applySeek(pct);
  }, [resetControlsTimer, getPct, applySeek]);
  const onTouchScrubMove = useCallback((e) => {
    e.preventDefault(); if (!isScrubbing) return;
    const pct = getPct(e.touches[0]); if (pct !== null) applySeek(pct);
  }, [isScrubbing, getPct, applySeek]);
  const onTouchScrubEnd = useCallback(() => {
    setIsScrubbing(false); setScrubPercent(null);
    setTimeout(() => setSeekPreview(null), 800);
  }, []);

  const onProgressKey = useCallback((e) => {
    const v = videoRef.current; if (!v) return;
    const dur = v.duration || 0;
    if (e.key === "ArrowLeft")  { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); showSeekFn(v.currentTime); }
    if (e.key === "ArrowRight") { e.preventDefault(); v.currentTime = Math.min(dur, v.currentTime + 5); showSeekFn(v.currentTime); }
    if (e.key === "Home")       { e.preventDefault(); v.currentTime = 0; }
    if (e.key === "End")        { e.preventDefault(); v.currentTime = dur; }
  }, []);

  // ─── Source discovery ─────────────────────────────────────────────────────
  useEffect(() => {
    const src = currentEpisode;
    if (!src?.link) { setError("No source found."); setLoading(false); return; }

    let cancelled = false;
    const discover = async () => {
      setLoading(true); setError(""); setShowResumePrompt(false); setResumeTime(0);
      const url = src.link;
      try {
        // YouTube
        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
        if (yt) {
          if (cancelled) return;
          setIframeUrl(`https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&modestbranding=1&rel=0&enablejsapi=1`);
          setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); return;
        }
        // Direct formats
        if (FORMAT_DIRECT_RE.test(url) || FORMAT_DASH_RE.test(url)) {
          if (cancelled) return;
          setDirectUrl(url); setMode("direct"); return;
        }
        // Try to scrape a media URL from the page
=======
  useEffect(() => {
    if (countdown === 0) goToEpisode(currentIndex + 1);
  }, [countdown]); // eslint-disable-line

  const cancelAutoPlay = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(null);
    endTriggeredRef.current = false;
  };

  // ─── Audio delay (Web Audio API) ──────────────────────────────────────────
  const setupAudioGraph = async () => {
    if (!videoRef.current || audioCtxRef.current) return;
    // Only attempt when SW is ready — the SW injects CORS headers that make
    // createMediaElementSource() work on cross-origin video.
    // Without SW, audio still plays normally through the browser, just without
    // the delay-sync control panel.
    if (!swReadyRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaElementSource(videoRef.current);
      const delay = ctx.createDelay(10.0);
      delay.delayTime.setValueAtTime(Math.max(0, audioOffset), ctx.currentTime);
      source.connect(delay);
      delay.connect(ctx.destination);
      audioCtxRef.current = ctx;
      delayNodeRef.current = delay;
      setIsSyncActive(true);
    } catch (err) {
      console.warn("[Audio] Graph setup failed:", err.message);
      setIsSyncActive(false);
    }
  };

  useEffect(() => {
    if (delayNodeRef.current && audioCtxRef.current) {
      delayNodeRef.current.delayTime.setTargetAtTime(
        Math.max(0, audioOffset), audioCtxRef.current.currentTime, 0.05
      );
    }
  }, [audioOffset]);

  // ─── Source discovery ─────────────────────────────────────────────────────
  useEffect(() => {
    const source = currentEpisode;
    if (!source?.link) { setError("No source found."); setLoading(false); return; }

    const discover = async () => {
      setLoading(true); setError("");
      const url = source.link;
      try {
        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
        if (yt) {
          setIframeUrl(`https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&modestbranding=1&rel=0&enablejsapi=1`);
          setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); return;
        }
        if (FORMAT_DIRECT_RE.test(url) || FORMAT_DASH_RE.test(url)) {
          setDirectUrl(url); setMode("direct"); return;
        }
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
        let scraped = null;
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
            const html = await resp.text();
<<<<<<< HEAD
            for (const re of [
=======
            const patterns = [
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
              /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mkv[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.webm[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mpd[^"'`\s]*?)["'`]/i,
<<<<<<< HEAD
            ]) { const m = html.match(re); if (m) { scraped = m[1].replace(/\\/g,""); break; } }
          }
        } catch {}
        if (cancelled) return;
        if (scraped) { setDirectUrl(scraped); setMode("direct"); }
        else { setIframeUrl(url); setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); }
      } catch {
        if (!cancelled) { setIframeUrl(src.link); setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); }
=======
            ];
            for (const re of patterns) {
              const m = html.match(re);
              if (m) { scraped = m[1].replace(/\\/g, ""); break; }
            }
          }
        } catch {}
        if (scraped) { setDirectUrl(scraped); setMode("direct"); }
        else { setIframeUrl(url); setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); }
      } catch {
        setIframeUrl(currentEpisode.link); setMode("iframe"); setPlayerEngine("iframe"); setLoading(false);
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
      }
    };

    discover();
<<<<<<< HEAD
    return () => { cancelled = true; destroyPlayers(); };
=======
    return () => destroyPlayers();
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
  }, [currentIndex, movie]); // eslint-disable-line

  // ─── Direct player engine init ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;
<<<<<<< HEAD
    if (isCrossOrigin(directUrl) && swStatus === "loading") return;

    const video = videoRef.current;

    // ⚠ DO NOT call destroyPlayers here again — source effect already did it.
    // Just destroy any previous engine if switching URLs.
    try { hlsRef.current?.destroy(); }    catch {} hlsRef.current    = null;
    try { mpegtsRef.current?.destroy(); } catch {} mpegtsRef.current = null;
    // Do NOT destroy audio graph here — let it persist if open

    // Check resume position
    const saved = loadPos(currentEpisode?.title);
    if (saved > 10) { setResumeTime(saved); setShowResumePrompt(true); }

    // ── HLS ──
    if (FORMAT_HLS_RE.test(directUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 0.5,
          highBufferWatchdogPeriod: 2,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          startFragPrefetch: true,
          // Better Android compatibility
          fragLoadingTimeOut: 20000,
          manifestLoadingTimeOut: 15000,
        });
=======
    // Wait only while SW is still loading — never block if it's done (ready or unavailable)
    if (isCrossOrigin(directUrl) && swStatus === "loading") return;

    const video = videoRef.current;
    destroyPlayers();

    // ── HLS ──────────────────────────────────────────────────────────────────
    if (FORMAT_HLS_RE.test(directUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_, d) => {
<<<<<<< HEAD
          if (d.fatal) {
            if      (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR)   hls.recoverMediaError();
            else { setError("HLS stream error."); setLoading(false); }
          }
        });
        setPlayerEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl; video.play().catch(() => {}); setPlayerEngine("HLS");
=======
          if (d.fatal) { setError("HLS stream error."); setLoading(false); }
        });
        setPlayerEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl; video.play().catch(() => {});
        setPlayerEngine("HLS");
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
      }
      return;
    }

<<<<<<< HEAD
    // ── FLV / MPEG-TS ──
    if ((FORMAT_FLV_RE.test(directUrl) || FORMAT_TS_RE.test(directUrl)) && !isCrossOrigin(directUrl)) {
      loadMpegts().then(mpegts => {
        if (!mpegts.isSupported()) throw new Error("MSE unsupported");
        const type = FORMAT_FLV_RE.test(directUrl) ? "flv" : "mpegts";
        const p = mpegts.createPlayer({ type, url: directUrl, isLive: false, enableWorker: true, lazyLoad: false });
=======
    // ── FLV / TS (mpegts.js, same-origin only) ───────────────────────────────
    if ((FORMAT_FLV_RE.test(directUrl) || FORMAT_TS_RE.test(directUrl)) && !isCrossOrigin(directUrl)) {
      loadMpegts().then((mpegts) => {
        if (!mpegts.isSupported()) throw new Error("MSE not supported");
        const type = FORMAT_FLV_RE.test(directUrl) ? "flv" : "mpegts";
        const p = mpegts.createPlayer({ type, url: directUrl, isLive: false });
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
        mpegtsRef.current = p;
        p.attachMediaElement(video); p.load(); p.play().catch(() => {});
        p.on(mpegts.Events.ERROR, (_, d) => { setError("Media error: " + (d?.msg ?? "")); setLoading(false); });
        setPlayerEngine("MPEG-TS");
<<<<<<< HEAD
      }).catch(() => { video.src = directUrl; video.play().catch(() => {}); setPlayerEngine("Native"); });
      return;
    }

    // ── Native (mp4, webm, mkv, etc.) ──
    if (swReadyRef.current && isCrossOrigin(directUrl)) video.crossOrigin = "anonymous";
    else video.removeAttribute("crossOrigin");
    video.src = directUrl; video.load(); video.play().catch(() => {});
    setPlayerEngine(FORMAT_MKV_RE.test(directUrl) ? "MKV" : (getExtension(directUrl).toUpperCase() || "Native"));
  }, [mode, directUrl, swStatus]); // eslint-disable-line

  // ─── iframe postMessage for auto-play next episode ────────────────────────
  useEffect(() => {
    if (mode !== "iframe" || !hasNext) return;
    const onMsg = (e) => {
=======
      }).catch(() => {
        video.src = directUrl; video.play().catch(() => {});
        setPlayerEngine("Native");
      });
      return;
    }

    // ── MKV + all other cross-origin formats ─────────────────────────────────
    //
    // CRITICAL: crossOrigin="anonymous" must ONLY be set when the SW is ready.
    //
    // WHY: The browser only allows <video> to load cross-origin content when
    // the server sends Access-Control-Allow-Origin. The CDN does NOT send this.
    // The SW intercepts the request and injects that header — so with SW ready,
    // crossOrigin="anonymous" works fine and enables Web Audio API support.
    // WITHOUT the SW, setting crossOrigin="anonymous" tells the browser to
    // enforce CORS — the CDN fails the check — and the video is blocked entirely.
    //
    // So: SW ready → set crossOrigin → CORS headers injected → audio API works.
    //     SW unavailable → no crossOrigin → browser loads video normally (no audio delay).
    //
    if (swReadyRef.current && isCrossOrigin(directUrl)) {
      video.crossOrigin = "anonymous";
    } else {
      video.removeAttribute("crossOrigin");
    }

    video.src = directUrl;
    video.load();
    video.play().catch(() => {});
    setPlayerEngine(
      FORMAT_MKV_RE.test(directUrl) ? "MKV" : (getExtension(directUrl).toUpperCase() || "Native")
    );

  }, [mode, directUrl, swStatus, destroyPlayers]); // eslint-disable-line

  // ─── iframe postMessage ───────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "iframe" || !hasNext) return;
    const handle = (e) => {
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.event === "onStateChange" && (d?.info === 0 || d?.info === "0")) startAutoPlayCountdown();
        if (d?.event === "ended" || d?.type === "ended") startAutoPlayCountdown();
        if (d?.currentTime && d?.duration > 0 && d.currentTime >= d.duration - 2) startAutoPlayCountdown();
      } catch {}
    };
<<<<<<< HEAD
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode, hasNext, startAutoPlayCountdown]);

  // ─── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => () => {
    destroyPlayers();
    clearInterval(countdownRef.current);
    clearTimeout(controlsTimerRef.current);
    unlockOrientation();
  }, []); // eslint-disable-line

  // ─── Video event listeners ────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (Math.abs(video.currentTime - lastSaveRef.current) >= SAVE_EVERY) {
        savePos(currentEpisode?.title, video.currentTime);
        lastSaveRef.current = video.currentTime;
      }
    };
    const onDuration = () => setDuration(video.duration);
    const onPlay     = () => { setIsPlaying(true); setIsBuffering(false); };
    const onPause    = () => setIsPlaying(false);
    const onWaiting  = () => setIsBuffering(true);
    const onPlaying  = () => setIsBuffering(false);
    const onCanPlay  = () => { setLoading(false); setError(""); setIsBuffering(false); };
    const onEnded    = () => { clearPos(currentEpisode?.title); startAutoPlayCountdown(); };
    const onVolume   = () => { setVolume(video.volume); setIsMuted(video.muted); };

    video.addEventListener("timeupdate",     onTimeUpdate);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("play",           onPlay);
    video.addEventListener("pause",          onPause);
    video.addEventListener("waiting",        onWaiting);
    video.addEventListener("playing",        onPlaying);
    video.addEventListener("canplay",        onCanPlay);
    video.addEventListener("ended",          onEnded);
    video.addEventListener("volumechange",   onVolume);
    return () => {
      video.removeEventListener("timeupdate",     onTimeUpdate);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("play",           onPlay);
      video.removeEventListener("pause",          onPause);
      video.removeEventListener("waiting",        onWaiting);
      video.removeEventListener("playing",        onPlaying);
      video.removeEventListener("canplay",        onCanPlay);
      video.removeEventListener("ended",          onEnded);
      video.removeEventListener("volumechange",   onVolume);
    };
  }, [mode, currentEpisode]); // eslint-disable-line

  // ─── Resume handlers ──────────────────────────────────────────────────────
  const handleResume = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    const seek = () => { v.currentTime = resumeTime; v.play().catch(() => {}); setShowResumePrompt(false); };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [resumeTime]);

  const handleStartOver = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    clearPos(currentEpisode?.title);
    v.currentTime = 0; v.play().catch(() => {}); setShowResumePrompt(false);
  }, [currentEpisode]);

  // ─── Derived values ───────────────────────────────────────────────────────
=======
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [mode, hasNext, startAutoPlayCountdown]);

  // ─── Duration-based iframe polling ───────────────────────────────────────
  useEffect(() => {
    if (mode !== "iframe" || !hasNext) return;
    const dur = currentEpisode?.duration ?? null;
    if (!dur || dur <= 0) return;
    let elapsed = 0, pol = null;
    const start = () => {
      pol = setInterval(() => {
        elapsed++;
        if (dur - elapsed <= TOTAL_SECS + 2) { clearInterval(pol); startAutoPlayCountdown(); }
      }, 1000);
    };
    const g = setTimeout(start, 3000);
    return () => { clearTimeout(g); if (pol) clearInterval(pol); };
  }, [mode, hasNext, currentEpisode, startAutoPlayCountdown]);

  useEffect(() => () => {
    destroyPlayers();
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []); // eslint-disable-line

  // ─── Labels ──────────────────────────────────────────────────────────────
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
  const episodeLabel = isSeries
    ? currentEpisode?.episode
      ? `S${currentEpisode.season ?? 1} · E${currentEpisode.episode}`
      : `Episode ${currentIndex + 1} of ${playlist.length}`
    : null;
<<<<<<< HEAD
  const progress   = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayPct = scrubPercent !== null ? scrubPercent : progress;
  const ringOffset = countdown !== null ? ((TOTAL_SECS - countdown) / TOTAL_SECS) * 125.7 : 0;

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="mp-root"
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={resetControlsTimer}
    >
      <div className="mp-card">

        {/* ══ HEADER ══ */}
        <div className={`mp-header ${showControls ? "ctrl-show" : "ctrl-hide"}`}>
          <button
            className="mp-back-btn"
            onClick={e => { e.stopPropagation(); handleGoBack(); }}
            type="button"
          >
            <FaChevronLeft size={13} />
            <span>Back</span>
          </button>

          <div className="mp-title-row">
            <span className="mp-title">{currentEpisode?.title || movie?.title}</span>
            {episodeLabel && <span className="mp-ep-badge">{episodeLabel}</span>}
            {playerEngine && playerEngine !== "iframe" && (
              <span className="mp-engine-badge">{playerEngine}</span>
=======
  const ringOffset = countdown !== null ? ((TOTAL_SECS - countdown) / TOTAL_SECS) * 125.7 : 0;

  return (
    <div className="player-page-bg">
      <div className="ultra-card">

        {/* Header */}
        <div className="player-header">
          <button className="over-back-btn" onClick={() => navigate(-1)}>← Back</button>
          <div className="player-title-block">
            <span className="player-movie-title">{currentEpisode?.title || movie?.title}</span>
            {episodeLabel && <span className="player-episode-badge">{episodeLabel}</span>}
            {playerEngine && playerEngine !== "iframe" && (
              <span className="player-engine-badge">{playerEngine}</span>
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
            )}
          </div>
        </div>

<<<<<<< HEAD
        {/* ══ VIEWPORT ══ */}
        <div
          className="mp-viewport"
          onClick={() => { if (mode === "direct") { togglePlay(); resetControlsTimer(); } }}
        >

          {/* Initial loader */}
          {loading && (
            <div className="mp-loader">
              <div className="mp-spinner"><div/><div/><div/><div/></div>
              <p className="mp-loader-text">{playerEngine ? `Loading · ${playerEngine}` : "Loading…"}</p>
            </div>
          )}

          {/* Mid-playback buffer ring */}
          {!loading && isBuffering && mode === "direct" && (
            <div className="mp-buffering"><div className="mp-buf-ring"/></div>
          )}

          {/* ── Native video ── */}
          {mode === "direct" && (
            <video
              ref={videoRef}
              className="mp-video"
              autoPlay
              playsInline
              preload="auto"
              webkit-playsinline="true"
              x5-playsinline="true"
              x5-video-player-type="h5"
              x5-video-orientation="landscape"
              onCanPlay={() => { setLoading(false); setError(""); setIsBuffering(false); }}
              onError={e => {
                const code = e.target?.error?.code;
                const msg = {
                  1: "Playback aborted.",
                  2: "Network error — check connection.",
                  3: "Decoding failed — unsupported codec.",
                  4: FORMAT_MKV_RE.test(directUrl)
                    ? swReadyRef.current ? "MKV unsupported codec (HEVC/H.265)." : "MKV blocked by CORS."
                    : "Format not supported.",
                }[code] ?? "Playback error.";
                setError(msg); setLoading(false);
              }}
            />
          )}

          {/* ── Center controls overlay ── */}
          {mode === "direct" && showControls && !showResumePrompt && (
            <div className="mp-center-controls" onClick={e => e.stopPropagation()}>

              {/* Prev / Rewind */}
              <button
                className={`mp-ovr-btn mp-ovr-side${focusedControl === "rewind" ? " tv-focus" : ""}`}
                onClick={() => hasPrev ? goToEpisode(currentIndex - 1) : seekBy(-10)}
                onFocus={() => setFocusedControl("rewind")}
                title="Rewind 10s"
              >
                <FaUndo size={18} />
                <span className="mp-ovr-label">10s</span>
              </button>

              {/* Play/Pause */}
              <button
                className={`mp-ovr-btn mp-ovr-play${focusedControl === "play" ? " tv-focus" : ""}`}
                onClick={() => { togglePlay(); resetControlsTimer(); }}
                onFocus={() => setFocusedControl("play")}
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <FaPause size={26} /> : <FaPlay size={26} />}
              </button>

              {/* Next / Forward */}
              <button
                className={`mp-ovr-btn mp-ovr-side${focusedControl === "forward" ? " tv-focus" : ""}`}
                onClick={() => hasNext ? goToEpisode(currentIndex + 1) : seekBy(30)}
                onFocus={() => setFocusedControl("forward")}
                title="Forward 30s"
              >
                <FaRedo size={18} />
                <span className="mp-ovr-label">30s</span>
              </button>
            </div>
          )}

          {/* ── Top-right buttons ── */}
          {mode === "direct" && (
            <div className={`mp-top-right ${showControls ? "ctrl-show" : "ctrl-hide"}`} onClick={e => e.stopPropagation()}>
              <button className="mp-corner-btn" onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
                <VolumeIcon muted={isMuted} volume={volume} size={14} />
              </button>
              <button
                className={`mp-corner-btn${showAudioPanel ? " active" : ""}`}
                onClick={e => { e.stopPropagation(); setShowAudioPanel(p => !p); }}
                title="Audio Sync"
              >
                <FaMusic size={14} />
                {audioDelay > 0 && <span className="mp-audio-dot" />}
              </button>
              <button
                className={`mp-corner-btn${focusedControl === "fullscreen" ? " tv-focus" : ""}`}
                onClick={() => { toggleFullscreen(); resetControlsTimer(); }}
                onFocus={() => setFocusedControl("fullscreen")}
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <FaCompress size={14} /> : <FaExpand size={14} />}
              </button>
            </div>
          )}

          {/* ── iframe ── */}
          {mode === "iframe" && (
            <div className="mp-iframe-wrap">
              <div className="mp-ad-shield mp-ad-top" />
              <div className="mp-ad-shield mp-ad-btm" />
              <iframe
                src={iframeUrl}
                title={currentEpisode?.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
                className="mp-iframe"
                onLoad={() => setLoading(false)}
              />
            </div>
          )}

          {/* ── Seek bubble ── */}
          {seekPreview !== null && (
            <div className="mp-seek-bubble">
              {seekPreview < currentTime ? <FaStepBackward size={15} /> : <FaStepForward size={15} />}
              <span className="mp-seek-time">{fmt(seekPreview)}</span>
            </div>
          )}

          {/* ── Resume prompt ── */}
          {showResumePrompt && mode === "direct" && (
            <div className="mp-resume-overlay" onClick={e => e.stopPropagation()}>
              <div className="mp-resume-card">
                <div className="mp-resume-icon"><FaPlay size={16} /></div>
                <h3 className="mp-resume-title">Continue Watching?</h3>
                <p className="mp-resume-sub">Paused at {fmt(resumeTime)}</p>
                <div className="mp-resume-bar">
                  <div className="mp-resume-bar-fill" style={{ width: duration > 0 ? `${(resumeTime / duration) * 100}%` : "30%" }} />
                </div>
                <div className="mp-resume-actions">
                  <button className="mp-resume-btn mp-resume-primary" onClick={handleResume}>
                    <FaPlay size={10} /> Resume
                  </button>
                  <button className="mp-resume-btn mp-resume-secondary" onClick={handleStartOver}>
                    Start Over
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Autoplay overlay ── */}
          {countdown !== null && hasNext && (
            <div className="mp-autoplay-bg">
              <div className="mp-autoplay-card">
                <p className="mp-ap-label">UP NEXT</p>
                <p className="mp-ap-title">{playlist[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}</p>
                <div className="mp-ap-ring">
                  <svg viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" className="ap-ring-track" />
                    <circle cx="24" cy="24" r="20" className="ap-ring-fill" style={{ strokeDashoffset: `${ringOffset}px` }} />
                  </svg>
                  <span className="ap-ring-num">{countdown}</span>
                </div>
                <p className="mp-ap-hint">Auto-playing in {countdown}s</p>
                <div className="mp-ap-actions">
                  <button className="mp-ap-now" onClick={() => { cancelAutoPlay(); goToEpisode(currentIndex + 1); }}>
                    <FaPlay size={10} /> Play Now
                  </button>
                  <button className="mp-ap-cancel" onClick={cancelAutoPlay}>Cancel</button>
=======
        {/* Video */}
        <div className="video-viewport">
          {loading && <div className="player-loader"><div className="spinner"></div></div>}

          {mode === "direct" && (
            <video
              ref={videoRef}
              controls
              autoPlay
              // crossOrigin is NOT a static JSX prop here.
              // It is set imperatively in the effect above, conditioned on swStatus.
              // Reason: if SW is unavailable and crossOrigin="anonymous" is set,
              // the CDN's missing CORS headers will cause ERR_FAILED on the video.
              onPlay={setupAudioGraph}
              onCanPlay={() => { setLoading(false); setError(""); }}
              onEnded={startAutoPlayCountdown}
              onError={(e) => {
                const code = e.target?.error?.code;
                const msg = {
                  1: "Playback aborted.",
                  2: "Network error — check your connection.",
                  3: "Decoding failed — codec not supported in this browser.",
                  4: FORMAT_MKV_RE.test(directUrl)
                    ? swReadyRef.current
                      ? "MKV loaded but codec unsupported (file may use HEVC/H.265)."
                      : "MKV blocked by CORS. Place video-sw.js in /public/ and refresh."
                    : "Format not supported in this browser.",
                }[code] ?? "Playback error.";
                setError(msg);
                setLoading(false);
              }}
              className="native-video"
            />
          )}

          {mode === "iframe" && (
            <iframe
              src={iframeUrl}
              title={currentEpisode?.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="iframe-video"
              onLoad={() => setLoading(false)}
            />
          )}

          {/* Auto-play overlay */}
          {countdown !== null && hasNext && (
            <div className="autoplay-overlay">
              <div className="autoplay-card">
                <p className="autoplay-label">UP NEXT</p>
                <p className="autoplay-next-title">{playlist[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}</p>
                <div className="autoplay-countdown-ring">
                  <svg viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" className="ring-track" />
                    <circle cx="24" cy="24" r="20" className="ring-fill" style={{ strokeDashoffset: `${ringOffset}px` }} />
                  </svg>
                  <span className="ring-number">{countdown}</span>
                </div>
                <p className="autoplay-hint">Auto-playing in {countdown} second{countdown !== 1 ? "s" : ""}…</p>
                <div className="autoplay-actions">
                  <button className="autoplay-btn-play" onClick={() => { cancelAutoPlay(); goToEpisode(currentIndex + 1); }}>▶ Play Now</button>
                  <button className="autoplay-btn-cancel" onClick={cancelAutoPlay}>✕ Cancel</button>
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
                </div>
              </div>
            </div>
          )}
        </div>

<<<<<<< HEAD
        {/* ══ BOTTOM CONTROLS BAR ══ */}
        {mode === "direct" && (
          <div className={`mp-ctrl-bar ${showControls ? "ctrl-show" : "ctrl-hide"}`}>
            <div className="mp-progress-row">
              <span className="mp-time">{fmt(currentTime)}</span>
              <div
                className="mp-track"
                ref={progressTrackRef}
                tabIndex={0}
                role="slider"
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round(displayPct)}
                aria-label="Seek"
                onPointerDown={onScrubStart}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubEnd}
                onPointerCancel={onScrubEnd}
                onTouchStart={onTouchScrubStart}
                onTouchMove={onTouchScrubMove}
                onTouchEnd={onTouchScrubEnd}
                onKeyDown={onProgressKey}
                onClick={e => { if (!isScrubbing) { const p = getPct(e); if (p !== null) applySeek(p); } }}
              >
                <div className="mp-track-bg" />
                <div className="mp-track-fill" style={{ width: `${displayPct}%` }} />
                <div className={`mp-track-thumb${isScrubbing ? " scrubbing" : ""}`} style={{ left: `${displayPct}%` }} />
              </div>
              <span className="mp-time">{fmt(duration)}</span>
            </div>
          </div>
        )}

        {/* ══ AUDIO SYNC PANEL ══
            Audio graph is ONLY built when this panel is open.
            When closed, destroyAudioGraph() is called → video plays audio natively. */}
        {mode === "direct" && showAudioPanel && (
          <div className="mp-audio-panel" onClick={e => e.stopPropagation()}>
            <div className="mp-audio-header">
              <FaMusic size={12} />
              <span>Audio Sync</span>
              {audioDelay > 0 && (
                <span className="mp-audio-active-badge">
                  <FaCheckCircle size={9} /> +{audioDelay.toFixed(2)}s
                </span>
              )}
              {!audioGraphReady && (
                <span className="mp-audio-warn-badge">tap video to enable</span>
              )}
              <button className="mp-audio-close" onClick={() => setShowAudioPanel(false)} title="Close">
                <FaTimes size={12} />
              </button>
            </div>

            <div className="mp-audio-body">
              <div className="mp-audio-display">
                <span className={`mp-audio-value${audioDelay > 0 ? " offset-active" : ""}`}>
                  +{audioDelay.toFixed(2)}
                </span>
                <span className="mp-audio-unit">sec delay</span>
              </div>

              <div className="mp-audio-stepper">
                <button className="mp-step-btn" onClick={() => applyAudioDelay(audioDelay - 0.5)}>−500ms</button>
                <button className="mp-step-btn" onClick={() => applyAudioDelay(audioDelay - 0.1)}>−100ms</button>
                <button className="mp-step-btn" onClick={() => applyAudioDelay(audioDelay - AUDIO_STEP)}>−50ms</button>
                <button className="mp-step-btn mp-step-reset" onClick={resetAudioDelay}>
                  <FaSync size={10} /> Reset
                </button>
                <button className="mp-step-btn" onClick={() => applyAudioDelay(audioDelay + AUDIO_STEP)}>+50ms</button>
                <button className="mp-step-btn" onClick={() => applyAudioDelay(audioDelay + 0.1)}>+100ms</button>
                <button className="mp-step-btn" onClick={() => applyAudioDelay(audioDelay + 0.5)}>+500ms</button>
              </div>

              <div className="mp-audio-slider-row">
                <span className="mp-audio-slider-label">0s</span>
                <input
                  type="range"
                  className="mp-audio-slider"
                  min={0} max={AUDIO_MAX} step="0.01"
                  value={audioDelay}
                  onChange={e => applyAudioDelay(parseFloat(e.target.value))}
                />
                <span className="mp-audio-slider-label">+{AUDIO_MAX}s</span>
              </div>

              <p className="mp-audio-hint">
                If audio lags behind video, increase the delay. Close this panel to restore default audio.
              </p>
            </div>
          </div>
        )}

        {/* ══ VOLUME OVERLAY (TV remote) ══ */}
        {showVolumeBar && (
          <div className="mp-vol-overlay">
            <VolumeIcon muted={isMuted} volume={volume} size={16} />
            <div className="mp-vol-track">
              <div className="mp-vol-fill" style={{ height: `${isMuted ? 0 : volume * 100}%` }} />
            </div>
            <span className="mp-vol-pct">{isMuted ? "0" : Math.round(volume * 100)}%</span>
          </div>
        )}

        {/* ══ EPISODE NAV BAR ══ */}
        {isSeries && (
          <div className={`mp-ep-bar ${showControls ? "ctrl-show" : "ctrl-hide"}`}>
            <button
              className={`mp-ep-nav${hasPrev ? "" : " mp-ep-nav--off"}`}
              onClick={() => hasPrev && goToEpisode(currentIndex - 1)}
              disabled={!hasPrev}
            >
              <FaStepBackward size={11} />
              <span className="mp-ep-nav-lbl">Prev</span>
            </button>
            <div className="mp-ep-scroll">
              {playlist.map((ep, idx) => (
                <button
                  key={ep.id || idx}
                  className={`mp-ep-dot${idx === currentIndex ? " active" : ""}`}
=======
        {/* Episode nav */}
        {isSeries && (
          <div className="episode-nav-bar">
            <button
              className={`ep-nav-btn${hasPrev ? "" : " ep-nav-btn--disabled"}`}
              onClick={() => hasPrev && goToEpisode(currentIndex - 1)}
              disabled={!hasPrev}
            >
              ⏮ <span className="ep-nav-label">Prev</span>
            </button>
            <div className="ep-dots-scroll">
              {playlist.map((ep, idx) => (
                <button
                  key={ep.id || idx}
                  className={`ep-dot${idx === currentIndex ? " ep-dot--active" : ""}`}
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
                  onClick={() => goToEpisode(idx)}
                  title={ep.title || `Episode ${idx + 1}`}
                >
                  {ep.episode || idx + 1}
                </button>
              ))}
            </div>
            <button
<<<<<<< HEAD
              className={`mp-ep-nav${hasNext ? "" : " mp-ep-nav--off"}`}
              onClick={() => hasNext && goToEpisode(currentIndex + 1)}
              disabled={!hasNext}
            >
              <span className="mp-ep-nav-lbl">Next</span>
              <FaStepForward size={11} />
=======
              className={`ep-nav-btn${hasNext ? "" : " ep-nav-btn--disabled"}`}
              onClick={() => hasNext && goToEpisode(currentIndex + 1)}
              disabled={!hasNext}
            >
              <span className="ep-nav-label">Next</span> ⏭
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
            </button>
          </div>
        )}

<<<<<<< HEAD
        {/* ══ ERROR TOAST ══ */}
        {error && (
          <div className="mp-error-toast">
            <FaExclamationTriangle size={13} />
            <span>{error}</span>
            <a href={directUrl} target="_blank" rel="noreferrer" className="mp-dl-btn">
              <FaDownload size={11} /> Download
            </a>
=======
        {/* Audio sync — only shown when Web Audio graph is active */}
        {isSyncActive && mode === "direct" && (
          <div className="sync-control-panel">
            <div className="sync-info">
              <span>Audio Delay: <strong>{audioOffset.toFixed(2)}s</strong></span>
              <button onClick={() => setAudioOffset(0)}>Reset</button>
            </div>
            <input
              type="range" min="0" max="4" step="0.05" value={audioOffset}
              onChange={(e) => setAudioOffset(parseFloat(e.target.value))}
            />
          </div>
        )}

        {error && (
          <div className="player-error-toast">
            <span>{error}</span>
            <a href={directUrl} target="_blank" rel="noreferrer" className="toast-download-btn">⬇ Download</a>
>>>>>>> e3141d289e8cdc1abfcf40fa600149e90e618c72
          </div>
        )}

      </div>
    </div>
  );
}