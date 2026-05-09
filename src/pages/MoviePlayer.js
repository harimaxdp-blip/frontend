import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Hls from "hls.js";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;

  const playlist     = location.state?.playlist     ?? null;
  const startIndex   = location.state?.currentIndex ?? 0;

  const [currentIndex, setCurrentIndex] = useState(startIndex);

  const isSeries      = Array.isArray(playlist) && playlist.length > 1;
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

  // Lock mode state
  const [isLocked, setIsLocked] = useState(false);
  const [showUnlockHint, setShowUnlockHint] = useState(false);
  const unlockHintTimerRef = useRef(null);

  const hasNext = isSeries && currentIndex < playlist.length - 1;
  const hasPrev = isSeries && currentIndex > 0;
  const TOTAL_SECS = 5;

  // ─── Lock Mode handlers ───────────────────────────────────────────────────
  const handleLock = () => {
    setIsLocked(true);
    setShowUnlockHint(true);
    if (unlockHintTimerRef.current) clearTimeout(unlockHintTimerRef.current);
    unlockHintTimerRef.current = setTimeout(() => setShowUnlockHint(false), 2500);
  };

  const handleUnlock = () => {
    setShowUnlockHint(true);
    if (unlockHintTimerRef.current) clearTimeout(unlockHintTimerRef.current);
    unlockHintTimerRef.current = setTimeout(() => {
      setIsLocked(false);
      setShowUnlockHint(false);
    }, 1500);
  };

  useEffect(() => {
    return () => { if (unlockHintTimerRef.current) clearTimeout(unlockHintTimerRef.current); };
  }, []);

  // ─── Go to episode ────────────────────────────────────────────────────────
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

  // ─── 5-second countdown then go to next (NO auto-play) ───────────────────
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

  // When countdown hits 0 → navigate to next episode but DO NOT auto-play
  useEffect(() => {
    if (countdown === 0) goToEpisode(currentIndex + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const cancelAutoPlay = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(null);
    endTriggeredRef.current = false;
  };

  // ─── Audio sync ───────────────────────────────────────────────────────────
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

  // ─── Source discovery ─────────────────────────────────────────────────────
  useEffect(() => {
    const source = currentEpisode;
    if (!source?.link) { setError("No source found."); setLoading(false); return; }

    const getBestSource = async () => {
      try {
        setLoading(true);
        const url = source.link;

        const ytMatch = url.match(
          /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/
        );
        if (ytMatch) {
          // NO autoplay=1 for YouTube
          setIframeUrl(
            `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=0&modestbranding=1&rel=0&enablejsapi=1`
          );
          setMode("iframe"); return;
        }

        if (url.match(/\.(mp4|m3u8|webm)($|\?)/i)) {
          setDirectUrl(url); setMode("direct"); return;
        }

        const response = await fetch(url).catch(() => null);
        if (response) {
          const html = await response.text();
          const patterns = [
            /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
            /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
          ];
          let found = null;
          for (const re of patterns) {
            const m = html.match(re);
            if (m) { found = m[1].replace(/\\/g, ""); break; }
          }
          if (found) { setDirectUrl(found); setMode("direct"); }
          else        { setIframeUrl(url);  setMode("iframe"); }
        } else {
          setIframeUrl(url); setMode("iframe");
        }
      } catch {
        setIframeUrl(currentEpisode.link); setMode("iframe");
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

  // ─── HLS / Direct init — NO autoplay ─────────────────────────────────────
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
        // MANIFEST_PARSED → do NOT call video.play()
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
      }
    } else {
      video.src = directUrl;
      // Do NOT call video.play() — user must press play
    }
  }, [mode, directUrl]);

  // ─── YouTube / iframe postMessage detection ───────────────────────────────
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

  // ─── Duration-based polling ───────────────────────────────────────────────
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

        {/* ── Lock overlay (covers everything when locked) ── */}
        {isLocked && (
          <div className="lock-overlay" onClick={handleUnlock}>
            <div className={`lock-unlock-hint ${showUnlockHint ? "lock-unlock-hint--visible" : ""}`}>
              <span className="lock-icon">🔒</span>
              <span>Hold to unlock</span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className={`player-header${isLocked ? " player-header--hidden" : ""}`}>
          <button className="over-back-btn" onClick={() => navigate(-1)}>← Back</button>
          <div className="player-title-block">
            <span className="player-movie-title">
              {currentEpisode?.title || movie?.title}
            </span>
            {episodeLabel && (
              <span className="player-episode-badge">{episodeLabel}</span>
            )}
          </div>
          {/* Lock button — mobile only */}
          <button className="lock-btn" onClick={handleLock} title="Lock screen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className="lock-btn-label">Lock</span>
          </button>
        </div>

        {/* Video */}
        <div className="video-viewport">
          {loading && <div className="player-loader"><div className="spinner"></div></div>}

          {mode === "direct" && (
            <video
              ref={videoRef}
              controls
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
            />
          )}

          {/* 5-second countdown overlay */}
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
                  Going to next in {countdown} second{countdown !== 1 ? "s" : ""}…
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
        {isSeries && !isLocked && (
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
        {isSyncActive && mode === "direct" && !isLocked && (
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