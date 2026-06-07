import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Hls from "hls.js";
import DeviceControl from "../plugins/deviceControl";

import "./Movies2.css";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import {
  FaPlay, FaPause, FaExpand, FaCompress,
  FaVolumeMute, FaVolumeUp, FaVolumeDown,
  FaStepForward, FaStepBackward,
  FaChevronLeft, FaRedo, FaUndo,
  FaExclamationTriangle, FaDownload,
  FaLock, FaUnlock, FaSun, FaArrowsAlt,
} from "react-icons/fa";

// ─── Format helpers ───────────────────────────────────────────────────────────
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
function isStreamUrl(url) {
  return /download\.php.*stream=1/i.test(url);
}
function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

// ─── Service Worker ───────────────────────────────────────────────────────────
let swRegistered = false;
async function ensureServiceWorker() {
  if (swRegistered) return true;
  if (!("serviceWorker" in navigator)) return false;
  try {
    const check = await fetch("/video-sw.js", { method: "HEAD" });
    const mime  = check.headers.get("content-type") ?? "";
    if (!check.ok || mime.includes("text/html")) return false;
    const reg = await navigator.serviceWorker.register("/video-sw.js", { scope: "/" });
    await new Promise(resolve => {
      if (reg.active) { resolve(); return; }
      const w = reg.installing || reg.waiting;
      if (!w) { resolve(); return; }
      w.addEventListener("statechange", () => { if (w.state === "activated") resolve(); });
      setTimeout(resolve, 3000);
    });
    swRegistered = true;
    return true;
  } catch { return false; }
}

// ─── mpegts.js loader ────────────────────────────────────────────────────────
let mpegtsPromise = null;
function loadMpegts() {
  if (!mpegtsPromise) {
    mpegtsPromise = new Promise((resolve, reject) => {
      if (window.mpegts) { resolve(window.mpegts); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.js";
      s.onload  = () => window.mpegts ? resolve(window.mpegts) : reject(new Error("mpegts missing"));
      s.onerror = () => reject(new Error("mpegts load failed"));
      document.head.appendChild(s);
    });
  }
  return mpegtsPromise;
}

// ─── Orientation ─────────────────────────────────────────────────────────────
async function lockLandscape() {
  try { await ScreenOrientation.lock({ orientation: "landscape" }); } catch {}
}
async function unlockOrientation() {
  try { await ScreenOrientation.unlock(); } catch {}
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
const TOTAL_SECS          = 5;
const SAVE_EVERY          = 5;
const DESKTOP_HIDE_DELAY  = 2500;
const MOBILE_HIDE_DELAY   = 3500;
const LOCK_BTN_SHOW_MS    = 2800;
const GESTURE_THRESHOLD   = 12;
const GESTURE_SENSITIVITY = 100 / 220;
const DOUBLE_TAP_MS       = 300;
const HOLD_SEEK_DELAY     = 480;
const HOLD_SEEK_INTERVAL  = 420;

function detectMobile() {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function detectAndroidTV() {
  const ua = navigator.userAgent || navigator.vendor || "";
  return /Android.*TV|GoogleTV|AFT|SHIELD|BRAVIA|SmartTV|Android TV|NetCast|Tizen/i.test(ua);
}

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

  // ─── Core Refs ────────────────────────────────────────────────────────────
  const videoRef         = useRef(null);
  const iframeRef        = useRef(null);
  const containerRef     = useRef(null);
  const viewportRef      = useRef(null);
  const hlsRef           = useRef(null);
  const mpegtsRef        = useRef(null);
  const countdownRef     = useRef(null);
  const endTriggeredRef  = useRef(false);
  const swReadyRef       = useRef(false);
  const controlsTimerRef = useRef(null);
  const lockBtnTimerRef  = useRef(null);
  const progressTrackRef = useRef(null);
  const lastSaveRef      = useRef(0);
  const focusRefs        = useRef({});

  // ─── Mobile / Gesture Refs ───────────────────────────────────────────────
  const isMobileRef            = useRef(false);
  const showControlsRef        = useRef(true);
  const controlsBeforeTouchRef = useRef(true);
  const isScrubbingRef         = useRef(false);
  const lastTouchEndRef        = useRef(0);
  const lastTapRef             = useRef({ time: 0, side: null });
  const tapTimerRef            = useRef(null);
  const holdSeekTimerRef       = useRef(null);
  const holdSeekIntervalRef    = useRef(null);
  const gestureRef             = useRef({
    active: false, moved: false, type: null,
    startX: 0, startY: 0, startValue: 0,
  });
  const gestureTimerRef = useRef(null);
  const flashTimerRef   = useRef(null);

  // ─── State ───────────────────────────────────────────────────────────────
  const [mode, setMode]                               = useState("loading");
  const [directUrl, setDirectUrl]                     = useState("");
  const [iframeUrl, setIframeUrl]                     = useState("");
  const [loading, setLoading]                         = useState(true);
  const [error, setError]                             = useState("");
  const [playerEngine, setPlayerEngine]               = useState("");
  const [swStatus, setSwStatus]                       = useState("loading");

  const [isPlaying, setIsPlaying]                     = useState(false);
  const [currentTime, setCurrentTime]                 = useState(0);
  const [duration, setDuration]                       = useState(0);
  const [volume, setVolume]                           = useState(1.0);
  const [isMuted, setIsMuted]                         = useState(false);
  const [isBuffering, setIsBuffering]                 = useState(false);
  const [isFullscreen, setIsFullscreen]               = useState(false);
  const [iframePlaying, setIframePlaying]             = useState(false);

  const [showControls, setShowControls]               = useState(true);
  const [showVolumeBar, setShowVolumeBar]             = useState(false);
  const [countdown, setCountdown]                     = useState(null);
  const [seekPreview, setSeekPreview]                 = useState(null);
  const [scrubPercent, setScrubPercent]               = useState(null);
  const [isScrubbing, setIsScrubbing]                 = useState(false);

  const [resumeTime, setResumeTime]                   = useState(0);
  const [showResumePrompt, setShowResumePrompt]       = useState(false);
  const [resumeActionLoading, setResumeActionLoading] = useState(null);

  const [isMobile, setIsMobile]                       = useState(false);
  const [isAndroidTV, setIsAndroidTV]                 = useState(false);
  const [tvCursorX, setTvCursorX]                     = useState(50);
  const [tvCursorY, setTvCursorY]                     = useState(50);
  const [brightness, setBrightness]                   = useState(100);
  const [isLocked, setIsLocked]                       = useState(false);
  const [isStretched, setIsStretched]                 = useState(false);
  const [gestureOverlay, setGestureOverlay]           = useState(null);
  const [seekGesture, setSeekGesture]                 = useState(null);
  const [playFlash, setPlayFlash]                     = useState(null);
  const [flashKey, setFlashKey]                       = useState(0);
  const [showLockPeek, setShowLockPeek]               = useState(false);

  // ─── TV focus state ───────────────────────────────────────────────────────
  const [tvFocus, setTvFocus]           = useState("play");
  const [epFocus, setEpFocus]           = useState(currentIndex);
  const [epBarFocused, setEpBarFocused] = useState(false);

  // ─── Register focus ref helper ────────────────────────────────────────────
  const setFocusRef = useCallback((id) => (el) => {
    if (el) focusRefs.current[id] = el;
    else delete focusRefs.current[id];
  }, []);
  const focusId = useCallback((id) => {
    setTvFocus(id);
    const el = focusRefs.current[id];
    if (el) el.focus({ preventScroll: false });
  }, []);

  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);

  // ─── isMobile detection ───────────────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      const m = detectMobile();
      setIsMobile(m);
      isMobileRef.current = m;
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { setIsAndroidTV(detectAndroidTV()); }, []);

  useEffect(() => {
    if (isAndroidTV && mode === "iframe") { setTvCursorX(50); setTvCursorY(50); }
  }, [isAndroidTV, mode]);

  // ─── Controls hide timer ──────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    if (isScrubbingRef.current) return;
    const delay = isMobileRef.current ? MOBILE_HIDE_DELAY : DESKTOP_HIDE_DELAY;
    controlsTimerRef.current = setTimeout(() => setShowControls(false), delay);
  }, []);

  const handleRootTouchStart = useCallback(() => {
    controlsBeforeTouchRef.current = showControlsRef.current;
    if (!isMobileRef.current) {
      setShowControls(true);
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = setTimeout(() => setShowControls(false), DESKTOP_HIDE_DELAY);
    }
  }, []);

  useEffect(() => { if (isPlaying && !isMobileRef.current) resetControlsTimer(); }, [isPlaying]); // eslint-disable-line

  // ─── Service Worker ───────────────────────────────────────────────────────
  useEffect(() => {
    ensureServiceWorker().then(ok => {
      swReadyRef.current = ok;
      setSwStatus(ok ? "ready" : "unavailable");
    });
  }, []);

  // ─── nativeVideoFound event (WebView → direct stream) ────────────────────
  useEffect(() => {
    const handleNativeVideo = (e) => {
      const videoUrl = e.detail?.url;
      if (!videoUrl) return;
      setIframeUrl("");
      setDirectUrl(videoUrl);
      setMode("direct");
      setLoading(false);
    };
    window.addEventListener("nativeVideoFound", handleNativeVideo);
    return () => window.removeEventListener("nativeVideoFound", handleNativeVideo);
  }, []);

  // ─── Fullscreen listener ──────────────────────────────────────────────────
  useEffect(() => {
    const onFS = () => {
      const fs = !!(
        document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement
      );
      setIsFullscreen(fs);
      if (fs) lockLandscape();
      else { unlockOrientation(); setIsLocked(false); setShowLockPeek(false); }
    };
    const evts = ["fullscreenchange","webkitfullscreenchange","mozfullscreenchange","MSFullscreenChange"];
    evts.forEach(e => document.addEventListener(e, onFS));
    return () => evts.forEach(e => document.removeEventListener(e, onFS));
  }, []);

  // ─── Destroy players ──────────────────────────────────────────────────────
  const destroyPlayers = useCallback(() => {
    try { hlsRef.current?.destroy(); }    catch {} hlsRef.current    = null;
    try { mpegtsRef.current?.destroy(); } catch {} mpegtsRef.current = null;
  }, []);

  // ─── Go to episode ────────────────────────────────────────────────────────
  const goToEpisode = useCallback((index) => {
    if (!isSeries || index < 0 || index >= playlist.length) return;
    destroyPlayers();
    clearInterval(countdownRef.current); countdownRef.current = null;
    endTriggeredRef.current = false;
    lastSaveRef.current = 0;
    setCountdown(null); setCurrentIndex(index); setMode("loading"); setLoading(true);
    setError(""); setDirectUrl(""); setIframeUrl(""); setPlayerEngine("");
    setCurrentTime(0); setDuration(0); setIsBuffering(false);
    setShowResumePrompt(false); setResumeTime(0);
    setEpBarFocused(false); setTvFocus("play");
  }, [isSeries, playlist, destroyPlayers]);

  // ─── Auto-play countdown ──────────────────────────────────────────────────
  const startAutoPlayCountdown = useCallback(() => {
    if (!hasNext || countdownRef.current || endTriggeredRef.current) return;
    endTriggeredRef.current = true;
    setCountdown(TOTAL_SECS);
    setTimeout(() => focusId("autoplay-now"), 80);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current); countdownRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [hasNext, focusId]);

  useEffect(() => { if (countdown === 0) goToEpisode(currentIndex + 1); }, [countdown]); // eslint-disable-line

  const cancelAutoPlay = useCallback(() => {
    clearInterval(countdownRef.current); countdownRef.current = null;
    setCountdown(null); endTriggeredRef.current = false;
    setTimeout(() => focusId("play"), 50);
  }, [focusId]);

  // ─── Playback controls ────────────────────────────────────────────────────
  const showPlayFlash = useCallback((type) => {
    clearTimeout(flashTimerRef.current);
    setPlayFlash(type);
    setFlashKey(k => k + 1);
    flashTimerRef.current = setTimeout(() => setPlayFlash(null), 850);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); showPlayFlash("play"); }
    else          { v.pause();               showPlayFlash("pause"); }
    resetControlsTimer();
  }, [showPlayFlash, resetControlsTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = !v.muted; setIsMuted(v.muted);
  }, []);

  const setVolumeLevel = useCallback((val) => {
    const v = videoRef.current; if (!v) return;
    const vol = clamp(val); v.volume = vol; setVolume(vol);
    if (vol === 0) v.muted = true;
    else if (v.muted) { v.muted = false; setIsMuted(false); }
    setShowVolumeBar(true);
    clearTimeout(controlsTimerRef._volTimer);
    controlsTimerRef._volTimer = setTimeout(() => setShowVolumeBar(false), 2000);
    DeviceControl.setVolume?.({ volume: vol }).catch(() => {});
  }, []);

  const showSeekFn = useCallback((t) => {
    setSeekPreview(t);
    clearTimeout(controlsTimerRef._seekTimer);
  }, []);

  const seekBy = useCallback((delta) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration || 0);
    showSeekFn(v.currentTime);
    setShowControls(true);
    resetControlsTimer();
  }, [showSeekFn, resetControlsTimer]);

  const clearHoldSeek = useCallback(() => {
    clearTimeout(holdSeekTimerRef.current);
    clearInterval(holdSeekIntervalRef.current);
    holdSeekTimerRef.current = null;
    holdSeekIntervalRef.current = null;
  }, []);

  const clearTapTimer = useCallback(() => {
    clearTimeout(tapTimerRef.current);
    tapTimerRef.current = null;
  }, []);

  const showSeekGesture = useCallback((side, amount, gestureMode = "tap") => {
    clearTimeout(gestureTimerRef.current);
    setSeekGesture({ side, amount: Math.abs(amount), mode: gestureMode, key: Date.now() });
    gestureTimerRef.current = setTimeout(() => setSeekGesture(null), gestureMode === "hold" ? 700 : 950);
  }, []);

  const seekByGesture = useCallback((side, gestureMode = "tap") => {
    const amount = side === "left" ? -10 : 30;
    seekBy(amount);
    showSeekGesture(side, amount, gestureMode);
    setShowControls(true);
  }, [seekBy, showSeekGesture]);

  const toggleFullscreen = useCallback(async () => {
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
  }, []);

  // ─── Resume handlers ──────────────────────────────────────────────────────
  const handleResume = useCallback(() => {
    const v = videoRef.current; if (!v || resumeActionLoading) return;
    setResumeActionLoading("resume");
    const seek = () => {
      v.currentTime = resumeTime;
      const finish = () => { setShowResumePrompt(false); setTvFocus("play"); setResumeActionLoading(null); };
      v.addEventListener("playing", finish, { once: true });
      v.play().then(() => { if (v.readyState >= 3) finish(); }).catch(() => {
        v.removeEventListener("playing", finish);
        setResumeActionLoading(null);
      });
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [resumeTime, resumeActionLoading]);

  const handleStartOver = useCallback(() => {
    const v = videoRef.current; if (!v || resumeActionLoading) return;
    setResumeActionLoading("startover");
    clearPos(currentEpisode?.title);
    v.currentTime = 0;
    const finish = () => { setShowResumePrompt(false); setTvFocus("play"); setResumeActionLoading(null); };
    v.addEventListener("playing", finish, { once: true });
    v.play().then(() => { if (v.readyState >= 3) finish(); }).catch(() => {
      v.removeEventListener("playing", finish);
      setResumeActionLoading(null);
    });
  }, [currentEpisode, resumeActionLoading]);

  useEffect(() => {
    if (showResumePrompt) setTimeout(() => focusId("resume-btn"), 80);
  }, [showResumePrompt, focusId]);

  // ─── Lock peek ────────────────────────────────────────────────────────────
  const triggerLockPeek = useCallback(() => {
    setShowLockPeek(true);
    clearTimeout(lockBtnTimerRef.current);
    lockBtnTimerRef.current = setTimeout(() => setShowLockPeek(false), LOCK_BTN_SHOW_MS);
  }, []);

  useEffect(() => () => clearTimeout(lockBtnTimerRef.current), []);

  // ══════════════════════════════════════════════════════════════════════════
  //  GESTURE TOUCH HANDLERS
  // ══════════════════════════════════════════════════════════════════════════
  const handleGestureTouchStart = useCallback((e) => {
    if (isLocked) { triggerLockPeek(); return; }
    if (!isMobileRef.current || mode !== "direct" || showResumePrompt || countdown !== null) return;
    const t = e.target;
    if (
      t.closest("button") || t.closest(".mp-track") ||
      t.closest(".mp-ctrl-bar") || t.closest(".mp-ep-bar") ||
      t.closest(".mp-header") || t.closest(".mp-top-right") ||
      t.closest(".mp-resume-overlay") || t.closest(".mp-autoplay-bg")
    ) return;
    const touch = e.touches[0];
    const isLeft = touch.clientX < window.innerWidth / 2;
    const side = isLeft ? "left" : "right";
    const vidVol = videoRef.current
      ? (videoRef.current.muted ? 0 : videoRef.current.volume * 100)
      : volume * 100;
    clearHoldSeek();
    gestureRef.current = {
      active: true, moved: false, holdSeeking: false,
      startX: touch.clientX, startY: touch.clientY,
      side,
      type: isLeft ? "brightness" : "volume",
      startValue: isLeft ? brightness : vidVol,
    };
    holdSeekTimerRef.current = setTimeout(() => {
      const g = gestureRef.current;
      if (!g.active || g.moved || isLocked || !isMobileRef.current) return;
      g.moved = true; g.holdSeeking = true; g.type = "seek";
      clearTapTimer();
      clearTimeout(controlsTimerRef.current);
      setShowControls(true);
      seekByGesture(side, "hold");
      holdSeekIntervalRef.current = setInterval(() => seekByGesture(side, "hold"), HOLD_SEEK_INTERVAL);
    }, HOLD_SEEK_DELAY);
  }, [isLocked, mode, showResumePrompt, countdown, brightness, volume, triggerLockPeek, clearHoldSeek, clearTapTimer, seekByGesture]);

  const handleGestureTouchMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.active || isLocked || !isMobileRef.current) return;
    if (g.holdSeeking) { if (isFullscreen) e.preventDefault(); return; }
    const touch = e.touches[0];
    const absDeltaX = Math.abs(touch.clientX - g.startX);
    const deltaY    = g.startY - touch.clientY;
    if (!g.moved) {
      const absDeltaY = Math.abs(deltaY);
      if (absDeltaY >= GESTURE_THRESHOLD && absDeltaY > absDeltaX * 1.5) { clearHoldSeek(); g.moved = true; }
      else if (absDeltaX > 18) { clearHoldSeek(); g.active = false; return; }
      else return;
    }
    if (isFullscreen) e.preventDefault();
    const change = deltaY * GESTURE_SENSITIVITY;
    if (g.type === "volume") {
      const newPct = Math.max(0, Math.min(100, g.startValue + change));
      const newVol = newPct / 100;
      const v = videoRef.current;
      if (v) { v.volume = newVol; v.muted = newVol === 0; setIsMuted(v.muted); }
      setVolume(newVol);
      DeviceControl.setVolume?.({ volume: newVol }).catch(() => {});
      setGestureOverlay({ type: "volume", value: Math.round(newPct) });
    } else {
      const newBrightness = Math.max(10, Math.min(100, g.startValue + (change * 1.5)));
      setBrightness(newBrightness);
      DeviceControl.setBrightness?.({ brightness: newBrightness / 100 }).catch(() => {});
      setGestureOverlay({ type: "brightness", value: Math.round(newBrightness) });
    }
    clearTimeout(gestureTimerRef.current);
  }, [isLocked, isFullscreen, clearHoldSeek]);

  const handleGestureTouchEnd = useCallback(() => {
    const g = gestureRef.current;
    const now = Date.now();
    lastTouchEndRef.current = now;
    clearHoldSeek();
    if (isLocked) { gestureRef.current = { ...gestureRef.current, active: false, moved: false }; return; }
    if (g.active && !g.moved && isMobileRef.current && mode === "direct") {
      const isDoubleTap = lastTapRef.current.side === g.side && now - lastTapRef.current.time <= DOUBLE_TAP_MS;
      if (isDoubleTap) {
        clearTapTimer();
        lastTapRef.current = { time: 0, side: null };
        seekByGesture(g.side, "tap");
      } else {
        lastTapRef.current = { time: now, side: g.side };
        clearTapTimer();
        tapTimerRef.current = setTimeout(() => {
          if (controlsBeforeTouchRef.current) {
            setShowControls(false); clearTimeout(controlsTimerRef.current);
          } else { resetControlsTimer(); }
          tapTimerRef.current = null;
        }, DOUBLE_TAP_MS);
      }
    }
    if (g.moved && !g.holdSeeking) gestureTimerRef.current = setTimeout(() => setGestureOverlay(null), 1600);
    if (g.holdSeeking) gestureTimerRef.current = setTimeout(() => setSeekGesture(null), 700);
    gestureRef.current = { ...gestureRef.current, active: false, moved: false, holdSeeking: false };
  }, [isLocked, mode, resetControlsTimer, clearHoldSeek, clearTapTimer, seekByGesture]);

  useEffect(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    viewport.addEventListener("touchstart", handleGestureTouchStart, { passive: true });
    viewport.addEventListener("touchmove",  handleGestureTouchMove,  { passive: false });
    viewport.addEventListener("touchend",   handleGestureTouchEnd,   { passive: true });
    return () => {
      viewport.removeEventListener("touchstart", handleGestureTouchStart);
      viewport.removeEventListener("touchmove",  handleGestureTouchMove);
      viewport.removeEventListener("touchend",   handleGestureTouchEnd);
    };
  }, [handleGestureTouchStart, handleGestureTouchMove, handleGestureTouchEnd]);

  useEffect(() => () => { clearTimeout(gestureTimerRef.current); clearTapTimer(); clearHoldSeek(); }, [clearTapTimer, clearHoldSeek]);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  useEffect(() => {
    let cancelled = false;
    DeviceControl.getStatus?.().then((status) => {
      if (cancelled || !status) return;
      if (typeof status.brightness === "number") setBrightness(Math.round(clamp(status.brightness) * 100));
      if (typeof status.volume === "number") {
        const nativeVolume = clamp(status.volume);
        const v = videoRef.current;
        if (v) { v.volume = nativeVolume; v.muted = nativeVolume === 0; }
        setVolume(nativeVolume); setIsMuted(nativeVolume === 0);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const moveTvCursor = useCallback((dx, dy) => {
    setTvCursorX((prev) => clamp(prev + dx, 3, 97));
    setTvCursorY((prev) => clamp(prev + dy, 3, 97));
  }, []);

  const clickElementAtCursor = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = rect.left + (tvCursorX / 100) * rect.width;
    const y = rect.top  + (tvCursorY / 100) * rect.height;
    const target = document.elementFromPoint(x, y);
    if (target && target !== containerRef.current) { target.click?.(); target.focus?.(); }
  }, [tvCursorX, tvCursorY]);

  const activateMainControl = useCallback((id) => {
    switch (id) {
      case "back":       handleGoBack(); break;
      case "prev":       if (hasPrev) goToEpisode(currentIndex - 1); break;
      case "rewind":     seekBy(-10); break;
      case "play":       togglePlay(); break;
      case "forward":    seekBy(30); break;
      case "next":       if (hasNext) goToEpisode(currentIndex + 1); break;
      case "mute":       toggleMute(); break;
      case "fullscreen": toggleFullscreen(); break;
      default: break;
    }
  }, [handleGoBack, hasPrev, goToEpisode, currentIndex, seekBy, togglePlay, hasNext, toggleMute, toggleFullscreen]);

  // ─── TV D-pad keyboard handler ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const key = e.key;

      if (key === "Escape" || key === "GoBack" || key === "XF86Back") {
        e.preventDefault();
        if (epBarFocused) { setEpBarFocused(false); focusId("play"); return; }
        if (countdown !== null) { cancelAutoPlay(); return; }
        if (showResumePrompt) { handleStartOver(); return; }
        if (isLocked) { setIsLocked(false); setShowLockPeek(false); setShowControls(true); return; }
        if (isFullscreen) { toggleFullscreen(); return; }
        handleGoBack(); return;
      }

      const isTvCursorMode = isAndroidTV && mode === "iframe" && countdown === null && !showResumePrompt;
      if (isTvCursorMode) {
        if (key === "ArrowLeft")  { e.preventDefault(); moveTvCursor(-8, 0); return; }
        if (key === "ArrowRight") { e.preventDefault(); moveTvCursor(8, 0); return; }
        if (key === "ArrowUp")    { e.preventDefault(); moveTvCursor(0, -8); return; }
        if (key === "ArrowDown")  { e.preventDefault(); moveTvCursor(0, 8); return; }
        if (key === "Enter" || key === " ") { e.preventDefault(); clickElementAtCursor(); return; }
      }

      if (isLocked) return;

      if (key === "MediaPlayPause")     { e.preventDefault(); togglePlay(); return; }
      if (key === "MediaRewind")        { e.preventDefault(); seekBy(-10); return; }
      if (key === "MediaFastForward")   { e.preventDefault(); seekBy(30); return; }
      if (key === "MediaStop")          { e.preventDefault(); const v=videoRef.current; if(v){v.pause();v.currentTime=0;} return; }
      if (key === "MediaTrackNext")     { e.preventDefault(); if(hasNext) goToEpisode(currentIndex+1); return; }
      if (key === "MediaTrackPrevious") { e.preventDefault(); if(hasPrev) goToEpisode(currentIndex-1); return; }

      if (key === "ArrowUp" && !epBarFocused) { e.preventDefault(); setVolumeLevel((videoRef.current?.volume ?? 1) + 0.1); resetControlsTimer(); return; }
      if (key === "ArrowDown" && !epBarFocused) { e.preventDefault(); setVolumeLevel((videoRef.current?.volume ?? 1) - 0.1); resetControlsTimer(); return; }

      if (showResumePrompt) {
        if (key === "ArrowLeft" || key === "ArrowRight") { e.preventDefault(); focusId(tvFocus === "resume-btn" ? "startover-btn" : "resume-btn"); }
        if (key === "Enter" || key === " ") { e.preventDefault(); if (tvFocus === "resume-btn") handleResume(); else if (tvFocus === "startover-btn") handleStartOver(); }
        return;
      }

      if (countdown !== null) {
        if (key === "ArrowLeft" || key === "ArrowRight") { e.preventDefault(); focusId(tvFocus === "autoplay-now" ? "autoplay-cancel" : "autoplay-now"); }
        if (key === "Enter" || key === " ") { e.preventDefault(); if (tvFocus === "autoplay-now") { cancelAutoPlay(); goToEpisode(currentIndex + 1); } else if (tvFocus === "autoplay-cancel") cancelAutoPlay(); }
        return;
      }

      if (epBarFocused && isSeries) {
        if (key === "ArrowLeft") {
          e.preventDefault();
          const next = Math.max(0, epFocus - 1); setEpFocus(next);
          const el = focusRefs.current[`ep-${next}`];
          if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }
          return;
        }
        if (key === "ArrowRight") {
          e.preventDefault();
          const next = Math.min(playlist.length - 1, epFocus + 1); setEpFocus(next);
          const el = focusRefs.current[`ep-${next}`];
          if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }
          return;
        }
        if (key === "ArrowUp") { e.preventDefault(); setEpBarFocused(false); focusId("play"); return; }
        if (key === "Enter" || key === " ") { e.preventDefault(); goToEpisode(epFocus); return; }
        return;
      }

      if (key === "ArrowDown" && isSeries) {
        e.preventDefault();
        setEpBarFocused(true); setEpFocus(currentIndex);
        const el = focusRefs.current[`ep-${currentIndex}`];
        if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }
        return;
      }

      const mainOrder = [
        "back",
        ...(hasPrev ? ["prev"] : []),
        "rewind", "play", "forward",
        ...(hasNext ? ["next"] : []),
        "mute", "fullscreen",
      ];

      if (key === "ArrowLeft") {
        e.preventDefault(); resetControlsTimer();
        const idx = mainOrder.indexOf(tvFocus);
        if (idx > 0) focusId(mainOrder[idx - 1]); else seekBy(-10);
        return;
      }
      if (key === "ArrowRight") {
        e.preventDefault(); resetControlsTimer();
        const idx = mainOrder.indexOf(tvFocus);
        if (idx < mainOrder.length - 1) focusId(mainOrder[idx + 1]); else seekBy(30);
        return;
      }

      if (key === "Enter" || key === " ") { e.preventDefault(); activateMainControl(tvFocus); resetControlsTimer(); return; }
      if (key === "k" || key === "K") togglePlay();
      if (key === "f" || key === "F") toggleFullscreen();
      if (key === "m" || key === "M") toggleMute();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activateMainControl, cancelAutoPlay, clickElementAtCursor,
    currentIndex, countdown, epBarFocused, epFocus, toggleMute,
    focusId, goToEpisode, handleGoBack, handleStartOver, handleResume,
    isAndroidTV, isFullscreen, isLocked, isSeries, hasNext, hasPrev,
    mode, moveTvCursor, resetControlsTimer, seekBy, setVolumeLevel,
    showResumePrompt, toggleFullscreen, togglePlay, tvFocus, playlist?.length,
  ]);

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
    setScrubPercent(pct * 100); setCurrentTime(t); setSeekPreview(t);
  }, []);

  const onScrubStart = useCallback((e) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    clearTimeout(controlsTimerRef.current); clearTimeout(controlsTimerRef._seekTimer);
    setShowControls(true); setIsScrubbing(true);
    const pct = getPct(e); if (pct !== null) applySeek(pct);
    try { progressTrackRef.current?.setPointerCapture(e.pointerId); } catch {}
  }, [getPct, applySeek]);

  const onScrubMove = useCallback((e) => {
    if (!isScrubbing) return;
    const pct = getPct(e); if (pct !== null) applySeek(pct);
  }, [isScrubbing, getPct, applySeek]);

  const onScrubEnd = useCallback((e) => {
    if (!isScrubbing) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false); setScrubPercent(null); setShowControls(true); resetControlsTimer();
    try { progressTrackRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [isScrubbing, resetControlsTimer]);

  const onTouchScrubStart = useCallback((e) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    clearTimeout(controlsTimerRef.current); clearTimeout(controlsTimerRef._seekTimer);
    setShowControls(true); setIsScrubbing(true);
    const pct = getPct(e.touches[0]); if (pct !== null) applySeek(pct);
  }, [getPct, applySeek]);

  const onTouchScrubMove = useCallback((e) => {
    e.preventDefault(); if (!isScrubbing) return;
    const pct = getPct(e.touches[0]); if (pct !== null) applySeek(pct);
  }, [isScrubbing, getPct, applySeek]);

  const onTouchScrubEnd = useCallback(() => {
    isScrubbingRef.current = false;
    setIsScrubbing(false); setScrubPercent(null); setShowControls(true); resetControlsTimer();
  }, [resetControlsTimer]);

  const onProgressKey = useCallback((e) => {
    const v = videoRef.current; if (!v) return;
    const dur = v.duration || 0;
    if (e.key === "ArrowLeft")  { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); showSeekFn(v.currentTime); }
    if (e.key === "ArrowRight") { e.preventDefault(); v.currentTime = Math.min(dur, v.currentTime + 5); showSeekFn(v.currentTime); }
    if (e.key === "Home")       { e.preventDefault(); v.currentTime = 0; }
    if (e.key === "End")        { e.preventDefault(); v.currentTime = dur; }
  }, [showSeekFn]);

  // ─── Source discovery ─────────────────────────────────────────────────────
  useEffect(() => {
    const src = currentEpisode;
    if (!src?.link) { setError("No source found."); setLoading(false); return; }

    let cancelled = false;
    const discover = async () => {
      setLoading(true); setError(""); setShowResumePrompt(false); setResumeTime(0);
      const url = src.link;

      try {
        // ── YouTube ──
        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
        if (yt) {
          if (cancelled) return;
          setIframeUrl(`https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&modestbranding=1&rel=0&enablejsapi=1`);
          setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); return;
        }

        // ── Direct video URL ──
        if (FORMAT_DIRECT_RE.test(url) || FORMAT_DASH_RE.test(url) || isStreamUrl(url)) {
          if (cancelled) return;
          // Android: send to ExoPlayer; fall back to in-app video on failure
          if (isAndroid()) {
            try {
              await DeviceControl.openExoPlayer({ url, title: src.title || "" });
              handleGoBack();
            } catch {
              setDirectUrl(url); setMode("direct");
            }
            return;
          }
          setDirectUrl(url); setMode("direct"); return;
        }

        // ── Android non-direct: open in native web player ──
        if (isAndroid()) {
          if (cancelled) return;
          try { await DeviceControl.openWebPlayer({ url, title: src.title || "" }); } catch {}
          handleGoBack(); return;
        }

        // ── Web: try HTML scrape for embedded stream ──
        let scraped = null;
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
            const html = await resp.text();
            for (const re of [
              /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mkv[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.webm[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mpd[^"'`\s]*?)["'`]/i,
            ]) { const m = html.match(re); if (m) { scraped = m[1].replace(/\\/g,""); break; } }
          }
        } catch {}

        if (cancelled) return;
        if (scraped) { setDirectUrl(scraped); setMode("direct"); }
        else { setIframeUrl(url); setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); }
      } catch {
        if (!cancelled) { setIframeUrl(src.link); setMode("iframe"); setPlayerEngine("iframe"); setLoading(false); }
      }
    };

    discover();
    return () => { cancelled = true; destroyPlayers(); };
  }, [currentIndex, movie]); // eslint-disable-line

  // ─── Direct player engine init ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;
    if (isCrossOrigin(directUrl) && swStatus === "loading") return;

    const video = videoRef.current;
    try { hlsRef.current?.destroy(); }    catch {} hlsRef.current    = null;
    try { mpegtsRef.current?.destroy(); } catch {} mpegtsRef.current = null;

    const saved = loadPos(currentEpisode?.title);
    if (saved > 10) { setResumeTime(saved); setShowResumePrompt(true); }

    if (FORMAT_HLS_RE.test(directUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true, lowLatencyMode: false,
          maxBufferLength: 60, maxMaxBufferLength: 120,
          maxBufferSize: 60 * 1000 * 1000, maxBufferHole: 0.5,
          highBufferWatchdogPeriod: 2, nudgeOffset: 0.2, nudgeMaxRetry: 5,
          startFragPrefetch: true, fragLoadingTimeOut: 20000, manifestLoadingTimeOut: 15000,
        });
        hlsRef.current = hls;
        hls.loadSource(directUrl); hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) {
            if      (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR)   hls.recoverMediaError();
            else { setError("HLS stream error."); setLoading(false); }
          }
        });
        setPlayerEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl; video.play().catch(() => {}); setPlayerEngine("HLS");
      }
      return;
    }

    if ((FORMAT_FLV_RE.test(directUrl) || FORMAT_TS_RE.test(directUrl)) && !isCrossOrigin(directUrl)) {
      loadMpegts().then(mpegts => {
        if (!mpegts.isSupported()) throw new Error("MSE unsupported");
        const type = FORMAT_FLV_RE.test(directUrl) ? "flv" : "mpegts";
        const p = mpegts.createPlayer({ type, url: directUrl, isLive: false, enableWorker: true, lazyLoad: false });
        mpegtsRef.current = p;
        p.attachMediaElement(video); p.load(); p.play().catch(() => {});
        p.on(mpegts.Events.ERROR, (_, d) => { setError("Media error: " + (d?.msg ?? "")); setLoading(false); });
        setPlayerEngine("MPEG-TS");
      }).catch(() => { video.src = directUrl; video.play().catch(() => {}); setPlayerEngine("Native"); });
      return;
    }

    if (swReadyRef.current && isCrossOrigin(directUrl)) video.crossOrigin = "anonymous";
    else video.removeAttribute("crossOrigin");
    video.src = directUrl; video.load(); video.play().catch(() => {});
    setPlayerEngine(FORMAT_MKV_RE.test(directUrl) ? "MKV" : (getExtension(directUrl).toUpperCase() || "Native"));
  }, [mode, directUrl, swStatus]); // eslint-disable-line

  // ─── iframe postMessage ───────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "iframe" || !hasNext) return;
    const onMsg = (e) => {
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.event === "onStateChange" && (d?.info === 0 || d?.info === "0")) startAutoPlayCountdown();
        if (d?.event === "ended" || d?.type === "ended") startAutoPlayCountdown();
        if (d?.currentTime && d?.duration > 0 && d.currentTime >= d.duration - 2) startAutoPlayCountdown();
        if (d?.event === "onStateChange") {
          if (d.info === 1 || d.info === "1") setIframePlaying(true);
          if (d.info === 2 || d.info === "2") setIframePlaying(false);
        }
      } catch {}
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode, hasNext, startAutoPlayCountdown]);

  // ─── Forward TV keys to iframe ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (mode !== "iframe" || !iframeRef.current) return;
      const key = e.key;
      const win = iframeRef.current.contentWindow;
      if (!win) return;
      const isYouTube = /youtube/.test(iframeUrl || "");
      const sendYT = (func, args = []) => {
        try { win.postMessage(JSON.stringify({ event: "command", func, args }), "*"); } catch {}
      };
      const send = (cmd) => { if (isYouTube) sendYT(cmd.func, cmd.args || []); };
      if (key === "MediaPlayPause" || key === "k" || key === "K" || key === "Enter" || key === " ") {
        e.preventDefault();
        if (iframePlaying) send({ func: "pauseVideo" }); else send({ func: "playVideo" }); return;
      }
      if (key === "ArrowUp")   { e.preventDefault(); send({ func: "unMute" }); send({ func: "setVolume", args: [100] }); return; }
      if (key === "ArrowDown") { e.preventDefault(); send({ func: "mute" });   send({ func: "setVolume", args: [0] }); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, iframeUrl, iframePlaying]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => () => {
    destroyPlayers();
    clearInterval(countdownRef.current);
    clearTimeout(controlsTimerRef.current);
    clearTimeout(lockBtnTimerRef.current);
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

  // ─── Derived values ───────────────────────────────────────────────────────
  const episodeLabel = isSeries
    ? currentEpisode?.episode
      ? `S${currentEpisode.season ?? 1} · E${currentEpisode.episode}`
      : `Episode ${currentIndex + 1} of ${playlist.length}`
    : null;
  const showTvCursor = isAndroidTV && mode === "iframe";
  const progress     = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayPct   = scrubPercent !== null ? scrubPercent : progress;
  const ringOffset   = countdown !== null ? ((TOTAL_SECS - countdown) / TOTAL_SECS) * 125.7 : 0;
  const isFocused    = (id) => tvFocus === id;
  const gestureBarHeight = gestureOverlay ? Math.min(100, Math.max(0, gestureOverlay.value)) : 0;
  const lockAvailable = isFullscreen && isMobile && mode === "direct" && !showResumePrompt && countdown === null;

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="mp-root"
      onMouseMove={() => { if (!isMobileRef.current) resetControlsTimer(); }}
      onTouchStart={handleRootTouchStart}
      onClick={() => { if (!isMobileRef.current && !isLocked) resetControlsTimer(); }}
    >
      <div className={`mp-card${isLocked ? " mp-locked" : ""}`}>

        {/* ══ HEADER ══ */}
        <div className={`mp-header ${showControls && !isLocked ? "ctrl-show" : "ctrl-hide"}`}>
          <button
            ref={setFocusRef("back")}
            className={`mp-back-btn${isFocused("back") && !showResumePrompt && countdown === null ? " tv-focus" : ""}`}
            onClick={e => { e.stopPropagation(); handleGoBack(); }}
            onFocus={() => { setTvFocus("back"); resetControlsTimer(); }}
            type="button"
          >
            <FaChevronLeft size={12} />
            <span>Back</span>
          </button>
          <div className="mp-title-row">
            <span className="mp-title">{currentEpisode?.title || movie?.title}</span>
            {episodeLabel && <span className="mp-ep-badge">{episodeLabel}</span>}
            {playerEngine && playerEngine !== "iframe" && (
              <span className="mp-engine-badge">{playerEngine}</span>
            )}
          </div>
        </div>

        {/* ══ VIEWPORT ══ */}
        <div
          className="mp-viewport"
          ref={viewportRef}
          onClick={(e) => {
            if (isLocked) return;
            if (Date.now() - lastTouchEndRef.current < 400) return;
            if (mode === "direct") { togglePlay(); resetControlsTimer(); }
          }}
        >
          {/* Loader */}
          {loading && (
            <div className="mp-loader">
              <div className="mp-spinner"><div/><div/><div/><div/></div>
              <p className="mp-loader-text">{playerEngine ? `${playerEngine} · Loading` : "Loading"}</p>
            </div>
          )}

          {/* Buffer ring */}
          {!loading && isBuffering && mode === "direct" && (
            <div className="mp-buffering"><div className="mp-buf-ring"/></div>
          )}

          {/* ── Native video ── */}
          {mode === "direct" && (
            <video
              ref={videoRef}
              className="mp-video"
              autoPlay playsInline preload="auto"
              webkit-playsinline="true"
              x5-playsinline="true"
              x5-video-player-type="h5"
              x5-video-orientation="landscape"
              style={{ objectFit: isStretched ? "cover" : "contain" }}
              onCanPlay={() => { setLoading(false); setError(""); setIsBuffering(false); }}
              onError={async e => {
                const code = e.target?.error?.code;
                // Format not supported on Android → try ExoPlayer
                if (code === 4 && directUrl) {
                  try {
                    await DeviceControl.openExoPlayer({ url: directUrl, title: currentEpisode?.title || "" });
                    handleGoBack(); return;
                  } catch (err) { console.error("[ExoPlayer fallback]", err); }
                }
                const msg = { 1:"Playback aborted.", 2:"Network error.", 3:"Decoding failed.", 4:"Format not supported." }[code] ?? "Playback error.";
                setError(msg); setLoading(false);
              }}
            />
          )}

          {/* Play/pause flash */}
          {playFlash && !isLocked && (
            <div className="mp-play-flash" key={flashKey}>
              <div className="mp-play-flash-ring" />
              <div className="mp-play-flash-icon">
                {playFlash === "play" ? <FaPlay size={28} /> : <FaPause size={28} />}
              </div>
            </div>
          )}

          {/* Center controls */}
          {mode === "direct" && (showControls || isScrubbing) && !isLocked && !showResumePrompt && countdown === null && (
            <div className="mp-center-controls" onClick={e => e.stopPropagation()}>
              {hasPrev && (
                <button ref={setFocusRef("prev")} className={`mp-ovr-btn mp-ovr-side${isFocused("prev") ? " tv-focus" : ""}`}
                  onClick={() => goToEpisode(currentIndex - 1)} onFocus={() => { setTvFocus("prev"); resetControlsTimer(); }} title="Previous Episode">
                  <FaStepBackward size={16} /><span className="mp-ovr-label">Prev</span>
                </button>
              )}
              <button ref={setFocusRef("rewind")} className={`mp-ovr-btn mp-ovr-side${isFocused("rewind") ? " tv-focus" : ""}`}
                onClick={() => { seekBy(-10); resetControlsTimer(); }} onFocus={() => { setTvFocus("rewind"); resetControlsTimer(); }} title="Rewind 10s">
                <FaUndo size={17} /><span className="mp-ovr-label">10s</span>
              </button>
              <button ref={setFocusRef("play")} className={`mp-ovr-btn mp-ovr-play${isFocused("play") ? " tv-focus" : ""}`}
                onClick={e => { e.stopPropagation(); togglePlay(); }} onFocus={() => { setTvFocus("play"); resetControlsTimer(); }} title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <FaPause size={26} /> : <FaPlay size={26} />}
              </button>
              <button ref={setFocusRef("forward")} className={`mp-ovr-btn mp-ovr-side${isFocused("forward") ? " tv-focus" : ""}`}
                onClick={() => { seekBy(30); resetControlsTimer(); }} onFocus={() => { setTvFocus("forward"); resetControlsTimer(); }} title="Forward 30s">
                <FaRedo size={17} /><span className="mp-ovr-label">30s</span>
              </button>
              {hasNext && (
                <button ref={setFocusRef("next")} className={`mp-ovr-btn mp-ovr-side${isFocused("next") ? " tv-focus" : ""}`}
                  onClick={() => goToEpisode(currentIndex + 1)} onFocus={() => { setTvFocus("next"); resetControlsTimer(); }} title="Next Episode">
                  <FaStepForward size={16} /><span className="mp-ovr-label">Next</span>
                </button>
              )}
            </div>
          )}

          {/* Top-right buttons */}
          {mode === "direct" && (
            <div className={`mp-top-right ${(showControls || isScrubbing) && !isLocked ? "ctrl-show" : "ctrl-hide"}`} onClick={e => e.stopPropagation()}>
              {lockAvailable && (
                <button
                  className={["mp-corner-btn","mp-corner-btn--lock", isLocked ? "mp-corner-btn--lock-active" : "", showLockPeek && isLocked ? "mp-corner-btn--lock-peek" : ""].filter(Boolean).join(" ")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isLocked) { setIsLocked(false); setShowLockPeek(false); clearTimeout(lockBtnTimerRef.current); resetControlsTimer(); }
                    else { setIsLocked(true); setShowControls(false); clearTimeout(controlsTimerRef.current); }
                  }}
                  title={isLocked ? "Unlock controls" : "Lock controls"}
                >
                  {isLocked ? <FaUnlock size={14} /> : <FaLock size={13} />}
                </button>
              )}
              <button ref={setFocusRef("stretch")}
                className={`mp-corner-btn${isStretched ? " mp-corner-btn--active" : ""}${isFocused("stretch") && !showResumePrompt && countdown === null ? " tv-focus" : ""}`}
                onClick={() => { setIsStretched(!isStretched); resetControlsTimer(); }}
                onFocus={() => { setTvFocus("stretch"); resetControlsTimer(); }}
                title={isStretched ? "Fit to screen" : "Stretch to fill"}>
                <FaArrowsAlt size={14} />
              </button>
              <button ref={setFocusRef("mute")}
                className={`mp-corner-btn${isFocused("mute") && !showResumePrompt && countdown === null ? " tv-focus" : ""}`}
                onClick={toggleMute} onFocus={() => { setTvFocus("mute"); resetControlsTimer(); }}
                title={isMuted ? "Unmute" : "Mute"}>
                <VolumeIcon muted={isMuted} volume={volume} size={15} />
              </button>
              <button ref={setFocusRef("fullscreen")}
                className={`mp-corner-btn${isFocused("fullscreen") && !showResumePrompt && countdown === null ? " tv-focus" : ""}`}
                onClick={() => { toggleFullscreen(); resetControlsTimer(); }}
                onFocus={() => { setTvFocus("fullscreen"); resetControlsTimer(); }}
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
                {isFullscreen ? <FaCompress size={14} /> : <FaExpand size={14} />}
              </button>
            </div>
          )}

          {/* Locked peek */}
          {isLocked && showLockPeek && mode === "direct" && (
            <div className="mp-top-right-peek" onClick={e => e.stopPropagation()}>
              <button
                className="mp-corner-btn mp-corner-btn--lock mp-corner-btn--lock-active mp-corner-btn--lock-peek"
                onClick={(e) => { e.stopPropagation(); setIsLocked(false); setShowLockPeek(false); clearTimeout(lockBtnTimerRef.current); resetControlsTimer(); }}
                title="Unlock controls">
                <FaUnlock size={14} />
              </button>
            </div>
          )}

          {/* TV cursor */}
          {showTvCursor && <div className="tv-cursor" style={{ left: `${tvCursorX}%`, top: `${tvCursorY}%` }} />}

          {/* iframe */}
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
                ref={iframeRef}
                tabIndex={0}
                className="mp-iframe"
                onLoad={() => setLoading(false)}
                onFocus={() => { setShowControls(true); resetControlsTimer(); }}
              />
            </div>
          )}

          {/* Seek bubble */}
          {mode === "direct" && isScrubbing && seekPreview !== null && !isLocked && (
            <div className="mp-seek-bubble">
              {seekPreview < currentTime ? <FaStepBackward size={14} style={{ opacity: 0.55 }} /> : <FaStepForward size={14} style={{ opacity: 0.55 }} />}
              <span className="mp-seek-time">{fmt(seekPreview)}</span>
            </div>
          )}

          {/* Seek gesture */}
          {seekGesture && !isLocked && mode === "direct" && (
            <div key={seekGesture.key} className={`mp-tap-seek mp-tap-seek--${seekGesture.side} mp-tap-seek--${seekGesture.mode}`}>
              <div className="mp-tap-seek-ripple" />
              <div className="mp-tap-seek-chip">
                {seekGesture.side === "left" ? <FaUndo size={18} /> : <FaRedo size={18} />}
                <span>{seekGesture.amount}s</span>
              </div>
            </div>
          )}

          {/* Gesture overlays */}
          {gestureOverlay && !isLocked && (
            <div className={`mp-gesture-side mp-gesture-side--${gestureOverlay.type === "brightness" ? "left" : "right"}`}>
              <span className="mp-gesture-icon">
                {gestureOverlay.type === "brightness"
                  ? <FaSun size={15} />
                  : <VolumeIcon muted={gestureOverlay.value === 0} volume={gestureOverlay.value / 100} size={15} />
                }
              </span>
              <div className="mp-gesture-track">
                <div className="mp-gesture-fill" style={{ height: `${gestureBarHeight}%` }} />
              </div>
              <span className="mp-gesture-value">{gestureOverlay.value}%</span>
            </div>
          )}

          {/* Resume prompt */}
          {showResumePrompt && mode === "direct" && (
            <div className="mp-resume-overlay" onClick={e => e.stopPropagation()}>
              <div className="mp-resume-card">
                <div className="mp-resume-icon"><FaPlay size={16} /></div>
                <h3 className="mp-resume-title">Continue Watching?</h3>
                <p className="mp-resume-sub">Paused at {fmt(resumeTime)}</p>
                <div className="mp-resume-bar">
                  <div className="mp-resume-bar-fill" style={{ width: duration > 0 ? `${(resumeTime / duration) * 100}%` : "30%" }} />
                </div>
                <p className="mp-tv-hint">← → navigate · Enter select</p>
                <div className="mp-resume-actions">
                  <button ref={setFocusRef("resume-btn")}
                    className={`mp-resume-btn mp-resume-primary${isFocused("resume-btn") ? " tv-focus" : ""}`}
                    onClick={handleResume} onFocus={() => setTvFocus("resume-btn")}
                    disabled={resumeActionLoading !== null} aria-busy={resumeActionLoading === "resume"}>
                    {resumeActionLoading === "resume" ? <><span className="mp-btn-spinner" aria-hidden="true" /> Loading...</> : <><FaPlay size={10} /> Resume</>}
                  </button>
                  <button ref={setFocusRef("startover-btn")}
                    className={`mp-resume-btn mp-resume-secondary${isFocused("startover-btn") ? " tv-focus" : ""}`}
                    onClick={handleStartOver} onFocus={() => setTvFocus("startover-btn")}
                    disabled={resumeActionLoading !== null} aria-busy={resumeActionLoading === "startover"}>
                    {resumeActionLoading === "startover" ? <><span className="mp-btn-spinner" aria-hidden="true" /> Loading...</> : "Start Over"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Autoplay overlay */}
          {countdown !== null && hasNext && (
            <div className="mp-autoplay-bg">
              <div className="mp-autoplay-card">
                <p className="mp-ap-label">Up Next</p>
                <p className="mp-ap-title">{playlist[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}</p>
                <div className="mp-ap-ring">
                  <svg viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" className="ap-ring-track" />
                    <circle cx="24" cy="24" r="20" className="ap-ring-fill" style={{ strokeDashoffset: `${ringOffset}px` }} />
                  </svg>
                  <span className="ap-ring-num">{countdown}</span>
                </div>
                <p className="mp-ap-hint">Auto-playing in {countdown}s</p>
                <p className="mp-tv-hint">← → navigate · Enter select</p>
                <div className="mp-ap-actions">
                  <button ref={setFocusRef("autoplay-now")} className={`mp-ap-now${isFocused("autoplay-now") ? " tv-focus" : ""}`}
                    onClick={() => { cancelAutoPlay(); goToEpisode(currentIndex + 1); }} onFocus={() => setTvFocus("autoplay-now")}>
                    <FaPlay size={10} /> Play Now
                  </button>
                  <button ref={setFocusRef("autoplay-cancel")} className={`mp-ap-cancel${isFocused("autoplay-cancel") ? " tv-focus" : ""}`}
                    onClick={cancelAutoPlay} onFocus={() => setTvFocus("autoplay-cancel")}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>{/* end viewport */}

        {/* ══ CONTROLS BAR ══ */}
        {mode === "direct" && (
          <div className={`mp-ctrl-bar ${(showControls || isScrubbing) && !isLocked ? "ctrl-show" : "ctrl-hide"}`}>
            <div className="mp-progress-row">
              <span className="mp-time">{fmt(currentTime)}</span>
              <div
                className="mp-track"
                ref={progressTrackRef}
                tabIndex={0}
                role="slider"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(displayPct)} aria-label="Seek"
                onPointerDown={onScrubStart} onPointerMove={onScrubMove} onPointerUp={onScrubEnd} onPointerCancel={onScrubEnd}
                onTouchStart={onTouchScrubStart} onTouchMove={onTouchScrubMove} onTouchEnd={onTouchScrubEnd}
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

        {/* ══ VOLUME OVERLAY ══ */}
        {showVolumeBar && !gestureOverlay && !isLocked && (
          <div className="mp-vol-overlay">
            <VolumeIcon muted={isMuted} volume={volume} size={15} />
            <div className="mp-vol-track">
              <div className="mp-vol-fill" style={{ height: `${isMuted ? 0 : volume * 100}%` }} />
            </div>
            <span className="mp-vol-pct">{isMuted ? "0" : Math.round(volume * 100)}%</span>
          </div>
        )}

        {/* ══ EPISODE NAV BAR ══ */}
        {isSeries && (
          <div className={`mp-ep-bar ${(showControls || isScrubbing) && !isLocked ? "ctrl-show" : "ctrl-hide"}`}>
            <button className={`mp-ep-nav${hasPrev ? "" : " mp-ep-nav--off"}`} onClick={() => hasPrev && goToEpisode(currentIndex - 1)} disabled={!hasPrev}>
              <FaStepBackward size={11} /><span className="mp-ep-nav-lbl">Prev</span>
            </button>
            <div className="mp-ep-scroll">
              {playlist.map((ep, idx) => (
                <button
                  key={ep.id || idx}
                  ref={setFocusRef(`ep-${idx}`)}
                  className={`mp-ep-dot${idx === currentIndex ? " active" : ""}${epBarFocused && epFocus === idx ? " tv-focus" : ""}`}
                  onClick={() => goToEpisode(idx)} onFocus={() => setEpFocus(idx)}
                  title={ep.title || `Episode ${idx + 1}`}>
                  {ep.episode || idx + 1}
                </button>
              ))}
            </div>
            <button className={`mp-ep-nav${hasNext ? "" : " mp-ep-nav--off"}`} onClick={() => hasNext && goToEpisode(currentIndex + 1)} disabled={!hasNext}>
              <span className="mp-ep-nav-lbl">Next</span><FaStepForward size={11} />
            </button>
          </div>
        )}

        {/* ══ ERROR TOAST ══ */}
        {error && (
          <div className="mp-error-toast">
            <FaExclamationTriangle size={13} />
            <span>{error}</span>
            <a href={directUrl} target="_blank" rel="noreferrer" className="mp-dl-btn">
              <FaDownload size={11} /> Download
            </a>
          </div>
        )}

      </div>
    </div>
  );
}