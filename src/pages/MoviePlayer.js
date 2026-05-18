import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Hls from "hls.js";
import "./Movies2.css";

// ─── Format regexes ───────────────────────────────────────────────────────────
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

// ─── Service Worker registration ──────────────────────────────────────────────
let swRegistered = false;
async function ensureServiceWorker() {
  if (swRegistered) return true;
  if (!("serviceWorker" in navigator)) return false;
  try {
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
      setTimeout(resolve, 3000);
    });
    swRegistered = true;
    return true;
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
      if (window.mpegts) { resolve(window.mpegts); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.js";
      s.onload  = () => window.mpegts ? resolve(window.mpegts) : reject(new Error("mpegts missing"));
      s.onerror = () => reject(new Error("mpegts load failed"));
      document.head.appendChild(s);
    });
  }
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
      swReadyRef.current = ok;
      setSwStatus(ok ? "ready" : "unavailable");
    });
  }, []);

  // ─── Destroy players ─────────────────────────────────────────────────────
  const destroyPlayers = useCallback(() => {
    try { hlsRef.current?.destroy();    } catch {} hlsRef.current    = null;
    try { mpegtsRef.current?.destroy(); } catch {} mpegtsRef.current = null;
    try { audioCtxRef.current?.close(); } catch {} audioCtxRef.current = null;
    delayNodeRef.current = null;
  }, []);

  // ─── Go to episode ────────────────────────────────────────────────────────
  const goToEpisode = useCallback((index) => {
    if (!isSeries || index < 0 || index >= playlist.length) return;
    destroyPlayers();
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
  const startAutoPlayCountdown = useCallback(() => {
    if (!hasNext || countdownRef.current || endTriggeredRef.current) return;
    endTriggeredRef.current = true;
    setCountdown(TOTAL_SECS);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(countdownRef.current); countdownRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [hasNext]);

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
        let scraped = null;
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
            const html = await resp.text();
            const patterns = [
              /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mkv[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.webm[^"'`\s]*?)["'`]/i,
              /["'`](https?:\/\/[^"'`\s]+\.mpd[^"'`\s]*?)["'`]/i,
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
      }
    };

    discover();
    return () => destroyPlayers();
  }, [currentIndex, movie]); // eslint-disable-line

  // ─── Direct player engine init ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;
    // Wait only while SW is still loading — never block if it's done (ready or unavailable)
    if (isCrossOrigin(directUrl) && swStatus === "loading") return;

    const video = videoRef.current;
    destroyPlayers();

    // ── HLS ──────────────────────────────────────────────────────────────────
    if (FORMAT_HLS_RE.test(directUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) { setError("HLS stream error."); setLoading(false); }
        });
        setPlayerEngine("HLS");
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl; video.play().catch(() => {});
        setPlayerEngine("HLS");
      }
      return;
    }

    // ── FLV / TS (mpegts.js, same-origin only) ───────────────────────────────
    if ((FORMAT_FLV_RE.test(directUrl) || FORMAT_TS_RE.test(directUrl)) && !isCrossOrigin(directUrl)) {
      loadMpegts().then((mpegts) => {
        if (!mpegts.isSupported()) throw new Error("MSE not supported");
        const type = FORMAT_FLV_RE.test(directUrl) ? "flv" : "mpegts";
        const p = mpegts.createPlayer({ type, url: directUrl, isLive: false });
        mpegtsRef.current = p;
        p.attachMediaElement(video); p.load(); p.play().catch(() => {});
        p.on(mpegts.Events.ERROR, (_, d) => { setError("Media error: " + (d?.msg ?? "")); setLoading(false); });
        setPlayerEngine("MPEG-TS");
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
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.event === "onStateChange" && (d?.info === 0 || d?.info === "0")) startAutoPlayCountdown();
        if (d?.event === "ended" || d?.type === "ended") startAutoPlayCountdown();
        if (d?.currentTime && d?.duration > 0 && d.currentTime >= d.duration - 2) startAutoPlayCountdown();
      } catch {}
    };
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
  const episodeLabel = isSeries
    ? currentEpisode?.episode
      ? `S${currentEpisode.season ?? 1} · E${currentEpisode.episode}`
      : `Episode ${currentIndex + 1} of ${playlist.length}`
    : null;
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
            )}
          </div>
        </div>

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
                </div>
              </div>
            </div>
          )}
        </div>

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
                  onClick={() => goToEpisode(idx)}
                  title={ep.title || `Episode ${idx + 1}`}
                >
                  {ep.episode || idx + 1}
                </button>
              ))}
            </div>
            <button
              className={`ep-nav-btn${hasNext ? "" : " ep-nav-btn--disabled"}`}
              onClick={() => hasNext && goToEpisode(currentIndex + 1)}
              disabled={!hasNext}
            >
              <span className="ep-nav-label">Next</span> ⏭
            </button>
          </div>
        )}

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
          </div>
        )}

      </div>
    </div>
  );
}