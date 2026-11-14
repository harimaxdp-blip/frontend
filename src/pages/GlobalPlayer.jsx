import React, { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";

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

// ─── URL / format detection ───────────────────────────────────────────────────
const RE_HLS     = /\.m3u8($|\?)/i;
const RE_DASH    = /\.mpd($|\?)/i;
const RE_ARCHIVE = /\.(zip|rar|7z|tar|gz|iso|torrent|exe|apk)($|\?)/i;
const RE_MKV_AVI = /\.(mkv|avi|wmv|flv)($|\?)/i;
const RE_DIRECT  = /\.(mp4|m3u8|webm|mkv|avi|mov|ts|flv|ogv|3gp|wmv)($|\?)/i;

function getCleanFileName(url) {
  try {
    const pathname = new URL(url).pathname;
    const raw = pathname.split("/").pop() || "Media File";
    return decodeURIComponent(raw).replace(/[_-]+/g, " ");
  } catch {
    return "Media File";
  }
}

function getFileExtension(url) {
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
    // 1. Check Content-Type via HEAD first so we NEVER download multi-GB binary files
    const head = await fetch(pageUrl, { method: "HEAD", signal, mode: "cors", credentials: "omit" }).catch(() => null);
    if (head && head.ok) {
      const cType = (head.headers.get("content-type") || "").toLowerCase();
      if (cType.includes("zip") || cType.includes("octet-stream") || cType.includes("x-rar")) {
        return { errorType: "archive" };
      }
      if (cType.startsWith("video/") || cType.includes("mpegurl")) {
        return { streamUrl: pageUrl };
      }
      if (!cType.includes("text/html")) {
        return null;
      }
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
  Sun:            () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>,
  Warning:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>,
  Download:       () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>,
  Archive:        () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>,
  External:       () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>,
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
// GLOBAL PLAYER
// ═══════════════════════════════════════════════════════════════════════════════
export default function GlobalPlayer({ url, title, playlist = null, startIndex = 0, onClose }) {
  const videoRef       = useRef(null);
  const containerRef   = useRef(null);
  const progressRef    = useRef(null);
  const hlsRef         = useRef(null);
  const iframeRef      = useRef(null);
  const controlsTimer  = useRef(null);
  const isScrubbingRef = useRef(false);
  const lastSaveRef    = useRef(0);
  const gestureRef     = useRef({ active: false, moved: false, type: null, startX: 0, startY: 0, startValue: 0 });
  const gestureTimer   = useRef(null);
  const flashTimer     = useRef(null);
  const countdownRef   = useRef(null);
  const endTriggered   = useRef(false);
  const discoverAbort  = useRef(null);
  const epScrollRef    = useRef(null);

  const isSeries     = Array.isArray(playlist) && playlist.length > 1;
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const currentEp    = isSeries ? playlist[currentIndex] : { link: url, title };
  const rawUrl       = currentEp?.link || currentEp?.url || url || "";
  const currentTitle = currentEp?.title || title || getCleanFileName(rawUrl);
  const hasNext      = isSeries && currentIndex < playlist.length - 1;
  const hasPrev      = isSeries && currentIndex > 0;

  // mode: "discovering" | "direct" | "iframe" | "unsupported" | "error"
  const [mode, setMode]               = useState("discovering");
  const [directUrl, setDirectUrl]     = useState("");
  const [iframeUrl, setIframeUrl]     = useState("");
  const [engine, setEngine]           = useState("");
  const [discoverMsg, setDiscoverMsg] = useState("Detecting stream…");
  const [unsupportedInfo, setUnsupportedInfo] = useState(null);

  const [isPlaying, setIsPlaying]       = useState(false);
  const [currentTime, setCurrentTime]   = useState(0);
  const [duration, setDuration]         = useState(0);
  const [volume, setVolume]             = useState(1);
  const [isMuted, setIsMuted]           = useState(false);
  const [isBuffering, setIsBuffering]   = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing]   = useState(false);
  const [scrubPct, setScrubPct]         = useState(null);
  const [isStretched, setIsStretched]   = useState(false);
  const [isLocked, setIsLocked]         = useState(false);
  const [error, setError]               = useState("");
  const [brightness, setBrightness]     = useState(100);
  const [gestureOv, setGestureOv]       = useState(null);
  const [playFlash, setPlayFlash]       = useState(null);
  const [flashKey, setFlashKey]         = useState(0);
  const [countdown, setCountdown]       = useState(null);
  const [showResume, setShowResume]     = useState(false);
  const [resumeTime, setResumeTime]     = useState(0);
  const adBlockStatus = useAdBlock(iframeRef);

  // ── Controls hide timer ───────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    if (isScrubbingRef.current) return;
    controlsTimer.current = setTimeout(() => setShowControls(false), 3200);
  }, []);

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
    setDirectUrl("");
    setIframeUrl("");
    setUnsupportedInfo(null);
    endTriggered.current = false;
    lastSaveRef.current = 0;

    try { hlsRef.current?.destroy(); } catch {}
    hlsRef.current = null;

    const saved = loadPos(currentTitle);
    if (saved > 10) { setResumeTime(saved); setShowResume(true); }
    else            { setShowResume(false); setResumeTime(0); }

    const discover = async () => {
      // 1. Archive / Non-Streamable Binary Check (.zip, .rar, .7z, .iso, etc.)
      if (RE_ARCHIVE.test(rawUrl)) {
        const ext = getFileExtension(rawUrl);
        setEngine(ext);
        setUnsupportedInfo({
          ext,
          title: `Compressed ${ext} Archive Cannot Stream`,
          reason: `Browsers cannot stream or extract .${ext.toLowerCase()} archives directly inside a web video player. Download the archive first, extract the video files, and play them locally (e.g., VLC or Infuse).`,
          canVlc: false,
        });
        setMode("unsupported");
        return;
      }

      // 2. YouTube Embed
      const ytId = getYouTubeId(rawUrl);
      if (ytId) {
        if (ctrl.signal.aborted) return;
        setIframeUrl(`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&playsinline=1&modestbranding=1&rel=0`);
        setEngine("YouTube");
        setMode("iframe");
        return;
      }

      // 3. Direct Media URL
      if (isDirectUrl(rawUrl)) {
        if (ctrl.signal.aborted) return;
        setDirectUrl(rawUrl);
        setEngine("");
        setMode("direct");
        return;
      }

      // 4. Safe Page Scrape (HEAD checked first so multi-GB binaries aren't fetched)
      setDiscoverMsg("Extracting stream from page…");
      const result = await scrapeDirectUrl(rawUrl, ctrl.signal);
      if (ctrl.signal.aborted) return;

      if (result?.errorType === "archive") {
        setEngine("ARCHIVE");
        setUnsupportedInfo({
          ext: "ARCHIVE",
          title: "Downloadable Archive Detected",
          reason: "This URL points to a binary archive file rather than a playable video stream. Please download it to your device to extract and watch.",
          canVlc: false,
        });
        setMode("unsupported");
        return;
      }

      if (result?.streamUrl) {
        setDirectUrl(result.streamUrl);
        setEngine("Scraped");
        setMode("direct");
        return;
      }

      // 5. Fallback Embed
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
  }, [currentIndex, rawUrl, currentTitle]);

  // ── Init direct video engine ──────────────────────────────────────────
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
          fragLoadingTimeOut: 20000,
          manifestLoadingTimeOut: 15000,
        });
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) {
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else setError("HLS stream error.");
          }
        });
        setEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        video.play().catch(() => {});
        setEngine("HLS-Native");
      } else {
        setError("HLS not supported on this browser.");
      }
    } else if (RE_DASH.test(directUrl)) {
      video.src = directUrl;
      video.load();
      video.play().catch(() => {});
      setEngine("DASH");
    } else {
      video.src = directUrl;
      video.load();
      video.play().catch(() => {});
      setEngine(RE_MKV_AVI.test(directUrl) ? "MKV/Experimental" : "Native");
    }

    return () => {
      try { hlsRef.current?.destroy(); } catch {}
      hlsRef.current = null;
    };
  }, [mode, directUrl]);

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
    const onPlay    = () => { setIsPlaying(true); setIsBuffering(false); };
    const onPause   = () => setIsPlaying(false);
    const onWait    = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setError("");
    const onTime    = () => {
      setCurrentTime(v.currentTime);
      if (Math.abs(v.currentTime - lastSaveRef.current) >= 5) {
        savePos(currentTitle, v.currentTime);
        lastSaveRef.current = v.currentTime;
      }
    };
    const onDur = () => setDuration(v.duration);
    const onVol = () => { setVolume(v.volume); setIsMuted(v.muted); };
    const onEnd = () => { clearPos(currentTitle); startCountdown(); };
    const onErr = () => {
      const isMkv = RE_MKV_AVI.test(directUrl);
      setError(
        isMkv
          ? "Browser cannot decode MKV / DD5.1 audio natively. Open in VLC or download."
          : "Playback error — codec or container unsupported by browser."
      );
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWait);
    v.addEventListener("playing", onPlaying);
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
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("error", onErr);
    };
  }, [mode, directUrl, currentTitle, startCountdown]);

  // ── Fullscreen listener (Desktop + iOS Safari) ────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    const onFS = () =>
      setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
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
    setResumeTime(0);
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
    if (isLocked) return;
    // On touch devices, tapping toggles HUD visibility first instead of pausing unexpectedly
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
  }, [isLocked, showControls, resetControlsTimer, togglePlay]);

  const seekBy = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration || 0);
    resetControlsTimer();
  }, [resetControlsTimer]);

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
    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (el?.requestFullscreen) await el.requestFullscreen();
        else if (el?.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iPhone Safari fallback
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      }
    } catch {
      try { v?.webkitEnterFullscreen?.(); } catch {}
    }
  }, []);

  // ── Resume ────────────────────────────────────────────────────────────
  const handleResume = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => { v.currentTime = resumeTime; v.play().catch(() => {}); setShowResume(false); };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [resumeTime]);

  const handleStartOver = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    clearPos(currentTitle);
    v.currentTime = 0;
    v.play().catch(() => {});
    setShowResume(false);
  }, [currentTitle]);

  // ── Scrub ─────────────────────────────────────────────────────────────
  const getPct = useCallback((clientX) => {
    const t = progressRef.current;
    if (!t) return null;
    return clamp((clientX - t.getBoundingClientRect().left) / t.getBoundingClientRect().width);
  }, []);

  const applySeek = useCallback((pct) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = pct * v.duration;
    setScrubPct(pct * 100);
    setCurrentTime(pct * v.duration);
  }, []);

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
    if (isLocked || mode !== "direct") return;
    const t = e.target;
    if (t.closest("button") || t.closest(".gp-track") || t.closest(".gp-ctrl-bar") || t.closest(".gp-ep-bar")) return;
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
  }, [isLocked, mode, brightness, volume]);

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
      if (e.target.tagName === "INPUT") return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); if (mode === "direct") togglePlay(); }
      if (e.key === "f") toggleFullscreen();
      if (e.key === "m") toggleMute();
      if (e.key === "ArrowLeft")  { e.preventDefault(); seekBy(-10); }
      if (e.key === "ArrowRight") { e.preventDefault(); seekBy(30); }
      if (e.key === "ArrowUp")    { e.preventDefault(); setVol((videoRef.current?.volume ?? 1) + 0.1); }
      if (e.key === "ArrowDown")  { e.preventDefault(); setVol((videoRef.current?.volume ?? 1) - 0.1); }
      if (e.key === "Escape")     { if (document.fullscreenElement) toggleFullscreen(); else onClose?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, togglePlay, toggleFullscreen, toggleMute, seekBy, setVol, onClose]);

  // ── Derived values ────────────────────────────────────────────────────
  const progress   = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayPct = scrubPct !== null ? scrubPct : progress;
  const ringOffset = countdown !== null ? ((5 - countdown) / 5) * 125.7 : 0;
  const gestureBarH = gestureOv
    ? gestureOv.type === "brightness"
      ? Math.min(100, Math.max(0, (gestureOv.value - 20) / 1.3))
      : Math.min(100, Math.max(0, gestureOv.value))
    : 0;
  const episodeLabel = isSeries
    ? currentEp?.episode ? `S${currentEp.season ?? 1} · E${currentEp.episode}` : `Ep ${currentIndex + 1}`
    : null;

  const ctrlVisible = (showControls || isScrubbing) && !isLocked;
  const EP_BAR_H    = isSeries ? 64 : 0;
  const externalVlc = `vlc://${(directUrl || rawUrl).replace(/^https?:\/\//i, "")}`;

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="gp-root"
      style={S.root}
      onMouseMove={resetControlsTimer}
      onTouchStart={onGestureStart}
      onTouchMove={onGestureMove}
      onTouchEnd={onGestureEnd}
    >
      {/* ── DIRECT VIDEO ── */}
      {(mode === "direct" || mode === "discovering") && (
        <video
          ref={videoRef}
          style={{
            ...S.video,
            objectFit: isStretched ? "cover" : "contain",
            filter: brightness !== 100 ? `brightness(${brightness / 100})` : undefined,
            display: mode === "direct" ? "block" : "none",
            bottom: isSeries ? EP_BAR_H : 0,
          }}
          autoPlay
          playsInline
          preload="auto"
          webkit-playsinline="true"
          x-webkit-airplay="allow"
          onClick={handleSurfaceTap}
          onCanPlay={() => setError("")}
        />
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

      {/* ── UNSUPPORTED / ARCHIVE CARD (.zip, .rar, etc.) ── */}
      {mode === "unsupported" && unsupportedInfo && (
        <div style={S.cardOverlay}>
          <div style={S.glassCard}>
            <div style={S.warnIconWrap}>
              <Icons.Archive />
            </div>
            <span style={S.pillBadge}>{unsupportedInfo.ext} ARCHIVE</span>
            <h3 style={S.cardTitle}>{unsupportedInfo.title}</h3>
            <p style={S.cardFile} title={currentTitle}>{currentTitle}</p>
            <p style={S.cardReason}>{unsupportedInfo.reason}</p>
            <div style={S.cardActions}>
              <a
                href={rawUrl}
                target="_blank"
                rel="noreferrer"
                download
                style={{ ...S.actionBtn, ...S.actionPrimary }}
              >
                <Icons.Download /> Download {unsupportedInfo.ext}
              </a>
              {onClose && (
                <button style={{ ...S.actionBtn, ...S.actionSecondary }} onClick={onClose}>
                  Go Back
                </button>
              )}
            </div>
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

      {/* ── HEADER (Safe-Area Aware for iPhone Notch / Dynamic Island) ── */}
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
              title={
                adBlockStatus === "injected"
                  ? "Popup/redirect ads blocked, plus in-page ad scripts stripped"
                  : "Popup/redirect ads blocked via iframe sandbox."
              }
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
              <button
                style={{ ...S.cornerBtn, ...(isLocked ? S.cornerLock : {}) }}
                onClick={() => {
                  if (isLocked) { setIsLocked(false); resetControlsTimer(); }
                  else { setIsLocked(true); setShowControls(false); clearTimeout(controlsTimer.current); }
                }}
                title={isLocked ? "Unlock Screen" : "Lock Screen"}
              >
                {isLocked ? <Icons.Unlock /> : <Icons.Lock />}
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

      {/* ── LOCK PEEK ── */}
      {isLocked && mode === "direct" && (
        <button
          style={S.lockPeek}
          onClick={() => { setIsLocked(false); resetControlsTimer(); }}
          title="Unlock Controls"
        >
          <Icons.Unlock />
        </button>
      )}

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
              <div style={{ ...S.resumeBarFill, width: duration > 0 ? `${(resumeTime / duration) * 100}%` : "30%" }} />
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
            <span style={S.timeLabel}>{fmt(duration)}</span>
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

      {/* ── ERROR TOAST (With Download + External VLC fallback) ── */}
      {error && mode !== "unsupported" && (
        <div style={{ ...S.errorToast, bottom: isSeries ? EP_BAR_H + 14 : 92 }}>
          <Icons.Warning />
          <span style={{ flex: 1, lineHeight: 1.35 }}>{error}</span>
          <a href={externalVlc} style={S.dlBtn} title="Open in VLC Player">
            <Icons.External /> VLC
          </a>
          <a href={directUrl || rawUrl} target="_blank" rel="noreferrer" download style={S.dlBtn}>
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

/* Mobile & iPhone Responsive Adjustments */
@media (max-width: 640px) {
  .gp-hide-xs { display: none !important; }
  .gp-header {
    padding-top: max(10px, env(safe-area-inset-top)) !important;
    padding-left: max(12px, env(safe-area-inset-left)) !important;
    padding-right: max(12px, env(safe-area-inset-right)) !important;
    height: auto !important;
    min-height: 64px !important;
  }
  .gp-title-text {
    max-width: 44vw !important;
    font-size: 0.84rem !important;
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
    max-width: 180px !important;
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
    minHeight: 40,
    minWidth: 40,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  titleText: {
    color: "#fff",
    fontSize: "0.95rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "min(420px, 46vw)",
    letterSpacing: "-0.2px",
    textShadow: "0 2px 14px rgba(0,0,0,0.95)",
  },
  epBadge: { background: "linear-gradient(135deg,#e50914,#b0000e)", color: "#fff", fontSize: "0.55rem", fontWeight: 800, padding: "3px 7px", ...r(5), textTransform: "uppercase", letterSpacing: "0.8px", flexShrink: 0 },
  engineBadge: { background: "rgba(255,255,255,0.07)", color: C.dim, fontSize: "0.55rem", fontWeight: 600, fontFamily: F.mono, padding: "3px 7px", ...r(5), textTransform: "uppercase", letterSpacing: "0.6px", border: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 },
  topRight: { display: "flex", gap: 7, flexShrink: 0, alignItems: "center" },
  cornerBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: C.g01,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: "1px solid " + C.gb,
    color: C.text,
    ...r(11),
    width: 40,
    height: 40,
    cursor: "pointer",
    fontSize: 16,
  },
  cornerActive: { background: "rgba(229,9,20,0.28)", borderColor: "rgba(229,9,20,0.55)", color: "#fff" },
  cornerLock: { background: "rgba(175,0,0,0.92)", borderColor: "rgba(229,9,20,0.6)", color: "#fff" },

  adBadge: { display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,180,80,0.16)", border: "1px solid rgba(0,200,80,0.35)", color: "#4ade80", ...r(8), padding: "6px 10px", fontSize: 13, flexShrink: 0 },
  adBadgePartial: { background: "rgba(255,180,0,0.14)", border: "1px solid rgba(255,180,0,0.32)", color: "#facc15" },

  lockPeek: {
    ...abs,
    top: "max(14px, env(safe-area-inset-top))",
    right: "max(14px, env(safe-area-inset-right))",
    zIndex: 820,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(175,0,0,0.92)",
    border: "1px solid rgba(229,9,20,0.6)",
    color: "#fff",
    ...r(11),
    width: 42,
    height: 42,
    cursor: "pointer",
    fontSize: 16,
  },

  centerControls: { ...abs, top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(12px, 2.5vw, 24px)", zIndex: 350, pointerEvents: "none" },
  sideBtn: { display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "#fff", ...r(14), width: 56, height: 56, background: "rgba(22,22,22,0.82)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer", fontSize: 17, boxShadow: "0 10px 26px rgba(0,0,0,0.7)" },
  ovLabel: { fontSize: "0.52rem", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", opacity: 0.85 },
  playBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 66, height: 66, borderRadius: "50%", background: C.red, border: "none", cursor: "pointer", color: "#fff", fontSize: 26, margin: "0 4px", boxShadow: "0 8px 28px rgba(229,9,20,0.45)" },

  gesturePanel: { ...abs, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, background: C.g02, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid " + C.gb, ...r(20), padding: "14px 10px", minWidth: 46, color: "#fff", zIndex: 750, pointerEvents: "none", fontSize: 14 },
  gestureTrack: { width: 5, height: 88, background: "rgba(255,255,255,0.1)", borderRadius: 999, position: "relative", overflow: "hidden" },
  gestureFill: { ...abs, bottom: 0, left: 0, width: "100%", borderRadius: 999, transition: "height 0.04s linear" },

  // Shared Modal / Unsupported / Resume / Autoplay Overlay
  cardOverlay: { ...abs, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.84)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", zIndex: 460, padding: 16 },
  glassCard: { background: "linear-gradient(160deg, #171717, #0e0e0e)", border: "1px solid rgba(255,255,255,0.12)", ...r(20), padding: "26px 24px", textAlign: "center", maxWidth: 380, width: "100%", boxShadow: "0 32px 84px rgba(0,0,0,0.95)", display: "flex", flexDirection: "column", alignItems: "center" },
  warnIconWrap: { width: 52, height: 52, borderRadius: "50%", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fbbf24", marginBottom: 12, fontSize: 22 },
  pillBadge: { background: "rgba(245,158,11,0.16)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)", fontSize: "0.58rem", fontWeight: 800, fontFamily: F.mono, padding: "3px 9px", ...r(999), letterSpacing: "1px", marginBottom: 10 },
  cardTitle: { color: "#fff", fontSize: "1.05rem", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.3px" },
  cardFile: { color: C.text, fontSize: "0.72rem", fontFamily: F.mono, background: "rgba(255,255,255,0.05)", padding: "6px 10px", ...r(8), width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 10, border: "1px solid rgba(255,255,255,0.06)" },
  cardReason: { color: C.dim, fontSize: "0.78rem", lineHeight: 1.5, margin: "0 0 18px" },
  cardActions: { display: "flex", gap: 10, width: "100%" },
  actionBtn: { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, ...r(11), padding: "11px 14px", fontSize: "0.8rem", fontWeight: 700, fontFamily: F.font, minHeight: 44, cursor: "pointer", textDecoration: "none" },
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
  dlBtn: { display: "inline-flex", alignItems: "center", gap: 4, color: "#fff", background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.18)", ...r(7), padding: "6px 9px", textDecoration: "none", fontSize: "0.68rem", fontWeight: 700, fontFamily: F.font, flexShrink: 0 },
};