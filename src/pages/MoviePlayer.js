import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Hls from "hls.js";
import "./Movies2.css";

// ─── CORS proxies (tried in order until one works) ────────────────────────────
const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://cors-anywhere.herokuapp.com/${url}`,
];

async function fetchWithProxy(url) {
  // 1. Try direct first (works on localhost / same-origin)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (r.ok) return r;
  } catch {}

  // 2. Try each proxy in sequence
  for (const proxy of CORS_PROXIES) {
    try {
      const r = await fetch(proxy(url), { signal: AbortSignal.timeout(7000) });
      if (r.ok) return r;
    } catch {}
  }
  return null;
}

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;

  const playlist     = location.state?.playlist     ?? null;
  const startIndex   = location.state?.currentIndex ?? 0;

  const [currentIndex, setCurrentIndex] = useState(startIndex);

  const isSeries       = Array.isArray(playlist) && playlist.length > 1;
  const currentEpisode = isSeries ? playlist[currentIndex] : movie;

  const videoRef        = useRef(null);
  const hlsRef          = useRef(null);
  const audioCtxRef     = useRef(null);
  const delayNodeRef    = useRef(null);
  const countdownRef    = useRef(null);
  const endTriggeredRef = useRef(false);

  const [mode, setMode]           = useState("loading");
  const [directUrl, setDirectUrl] = useState("");
  const [iframeUrl, setIframeUrl] = useState("");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [isSyncActive, setIsSyncActive] = useState(false);
  const [audioOffset, setAudioOffset]   = useState(1.0);
  const [countdown, setCountdown]       = useState(null);

  const hasNext = isSeries && currentIndex < playlist.length - 1;
  const hasPrev = isSeries && currentIndex > 0;
  const TOTAL_SECS = 5;

  // ─── Go to episode ──────────────────────────────────────────────────────────
  const goToEpisode = useCallback(
    (index) => {
      if (!isSeries || index < 0 || index >= playlist.length) return;
      if (audioCtxRef.current)  { audioCtxRef.current.close();         audioCtxRef.current = null; delayNodeRef.current = null; }
      if (hlsRef.current)       { hlsRef.current.destroy();             hlsRef.current = null; }
      if (countdownRef.current) { clearInterval(countdownRef.current);  countdownRef.current = null; }
      endTriggeredRef.current = false;
      setCountdown(null);
      setCurrentIndex(index);
      setMode("loading");
      setLoading(true);
      setError("");
      setDirectUrl("");
      setIframeUrl("");
      setIsSyncActive(false);
    },
    [isSeries, playlist]
  );

  // ─── 5-second countdown then auto-play next ────────────────────────────────
  const startAutoPlayCountdown = useCallback(() => {
    if (!hasNext || countdownRef.current || endTriggeredRef.current) return;
    endTriggeredRef.current = true;
    setCountdown(TOTAL_SECS);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [hasNext]);

  useEffect(() => {
    if (countdown === 0) goToEpisode(currentIndex + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const cancelAutoPlay = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(null);
    endTriggeredRef.current = false;
  };

  // ─── Audio sync ─────────────────────────────────────────────────────────────
  const setupAudioGraph = async () => {
    if (!videoRef.current || audioCtxRef.current || mode !== "direct") return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaElementSource(videoRef.current);
      const delayNode = ctx.createDelay(10.0);
      delayNode.delayTime.setValueAtTime(audioOffset, ctx.currentTime);
      source.connect(delayNode);
      delayNode.connect(ctx.destination);
      audioCtxRef.current = ctx;
      delayNodeRef.current = delayNode;
      setIsSyncActive(true);
    } catch { setIsSyncActive(false); }
  };

  useEffect(() => {
    if (delayNodeRef.current && audioCtxRef.current) {
      delayNodeRef.current.delayTime.setTargetAtTime(
        Math.max(0, audioOffset), audioCtxRef.current.currentTime, 0.05
      );
    }
  }, [audioOffset]);

  // ─── Source discovery ───────────────────────────────────────────────────────
  useEffect(() => {
    const source = currentEpisode;
    if (!source?.link) { setError("No source found."); setLoading(false); return; }

    const getBestSource = async () => {
      try {
        setLoading(true);
        setError("");
        const url = source.link;

        // 1. YouTube
        const ytMatch = url.match(
          /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/
        );
        if (ytMatch) {
          setIframeUrl(
            `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1&modestbranding=1&rel=0&enablejsapi=1`
          );
          setMode("iframe");
          return;
        }

        // 2. Already a direct media URL
        if (url.match(/\.(mp4|m3u8|webm)($|\?)/i)) {
          setDirectUrl(url);
          setMode("direct");
          return;
        }

        // 3. Already an embed/iframe URL (contains /embed/ or /player/)
        if (url.match(/\/(embed|player|iframe)\//i) || url.includes("embed")) {
          setIframeUrl(url);
          setMode("iframe");
          return;
        }

        // 4. Scrape with CORS proxy to find direct media link
        const response = await fetchWithProxy(url);
        if (response) {
          const html = await response.text();
          const patterns = [
            /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/i,
            /["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*)["'`]/i,
            /["'`](https?:\/\/[^"'`\s]+\.webm[^"'`\s]*)["'`]/i,
            // Common player source patterns
            /file\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/i,
            /src\s*:\s*["'`](https?:\/\/[^"'`]+\.(?:mp4|m3u8|webm)[^"'`]*)["'`]/i,
          ];
          let found = null;
          for (const re of patterns) {
            const m = html.match(re);
            if (m) { found = m[1].replace(/\\/g, ""); break; }
          }
          if (found) {
            setDirectUrl(found);
            setMode("direct");
          } else {
            // Fallback: embed the page in an iframe
            setIframeUrl(url);
            setMode("iframe");
          }
        } else {
          // Proxy also failed — embed directly as iframe
          setIframeUrl(url);
          setMode("iframe");
        }
      } catch {
        setIframeUrl(currentEpisode.link);
        setMode("iframe");
      } finally {
        setLoading(false);
      }
    };

    getBestSource();

    return () => {
      if (hlsRef.current)      hlsRef.current.destroy();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, movie]);

  // ─── HLS / Direct init ──────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;
    const video = videoRef.current;
    if (hlsRef.current) hlsRef.current.destroy();

    if (directUrl.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            // HLS failed — try iframe fallback
            setDirectUrl("");
            setIframeUrl(currentEpisode?.link || "");
            setMode("iframe");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        video.play().catch(() => {});
      }
    } else {
      video.src = directUrl;
      video.play().catch(() => {});
    }
  }, [mode, directUrl]);

  // ─── YouTube / iframe postMessage detection ─────────────────────────────────
  useEffect(() => {
    if (mode !== "iframe" || !hasNext) return;
    const handleMessage = (e) => {
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.event === "onStateChange" && (data?.info === 0 || data?.info === "0"))
          startAutoPlayCountdown();
        if (data?.event === "ended" || data?.type === "ended" || data?.name === "ended")
          startAutoPlayCountdown();
        if (data?.currentTime && data?.duration && data.duration > 0)
          if (data.currentTime >= data.duration - 2) startAutoPlayCountdown();
      } catch {}
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mode, hasNext, startAutoPlayCountdown]);

  // ─── Duration-based polling ─────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "iframe" || !hasNext) return;
    const epDuration = currentEpisode?.duration ?? null;
    if (!epDuration || epDuration <= 0) return;

    let elapsed = 0;
    let pollerRef = null;

    const startPolling = () => {
      pollerRef = setInterval(() => {
        elapsed += 1;
        if (epDuration - elapsed <= TOTAL_SECS + 2) {
          clearInterval(pollerRef);
          startAutoPlayCountdown();
        }
      }, 1000);
    };

    const grace = setTimeout(startPolling, 3000);
    return () => {
      clearTimeout(grace);
      if (pollerRef) clearInterval(pollerRef);
    };
  }, [mode, hasNext, currentEpisode, startAutoPlayCountdown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  const episodeLabel = isSeries
    ? currentEpisode?.episode
      ? `S${currentEpisode.season ?? 1} · E${currentEpisode.episode}`
      : `Episode ${currentIndex + 1} of ${playlist.length}`
    : null;

  const ringCircumference = 125.7;
  const ringOffset =
    countdown !== null
      ? ((TOTAL_SECS - countdown) / TOTAL_SECS) * ringCircumference
      : 0;

  return (
    <div className="player-page-bg">
      <div className="ultra-card">

        {/* Header */}
        <div className="player-header">
          <button className="over-back-btn" onClick={() => navigate(-1)}>← Back</button>
          <div className="player-title-block">
            <span className="player-movie-title">
              {currentEpisode?.title || movie?.title}
            </span>
            {episodeLabel && (
              <span className="player-episode-badge">{episodeLabel}</span>
            )}
          </div>
        </div>

        {/* Video */}
        <div className="video-viewport">
          {loading && <div className="player-loader"><div className="spinner"></div></div>}

          {mode === "direct" && (
            <video
              ref={videoRef}
              controls autoPlay
              crossOrigin="anonymous"
              onPlay={setupAudioGraph}
              onEnded={startAutoPlayCountdown}
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
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups"
            />
          )}

          {/* 5-second Auto-play Overlay */}
          {countdown !== null && hasNext && (
            <div className="autoplay-overlay">
              <div className="autoplay-card">
                <p className="autoplay-label">UP NEXT</p>
                <p className="autoplay-next-title">
                  {playlist[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}
                </p>

                <div className="autoplay-countdown-ring">
                  <svg viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" className="ring-track" />
                    <circle
                      cx="24" cy="24" r="20"
                      className="ring-fill"
                      style={{ strokeDashoffset: `${ringOffset}px` }}
                    />
                  </svg>
                  <span className="ring-number">{countdown}</span>
                </div>

                <p className="autoplay-hint">
                  Auto-playing in {countdown} second{countdown !== 1 ? "s" : ""}…
                </p>

                <div className="autoplay-actions">
                  <button
                    className="autoplay-btn-play"
                    onClick={() => { cancelAutoPlay(); goToEpisode(currentIndex + 1); }}
                  >
                    ▶ Play Now
                  </button>
                  <button className="autoplay-btn-cancel" onClick={cancelAutoPlay}>
                    ✕ Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Episode Nav Bar */}
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

        {/* Audio Sync */}
        {isSyncActive && mode === "direct" && (
          <div className="sync-control-panel">
            <div className="sync-info">
              <span>Audio Delay: <strong>{audioOffset.toFixed(2)}s</strong></span>
              <button onClick={() => setAudioOffset(1.0)}>Reset</button>
            </div>
            <input type="range" min="0" max="4" step="0.05"
              value={audioOffset}
              onChange={(e) => setAudioOffset(parseFloat(e.target.value))}
            />
          </div>
        )}

        {error && <div className="player-error-toast">{error}</div>}
      </div>
    </div>
  );
}