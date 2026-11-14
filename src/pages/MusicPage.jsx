import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./MusicPage.css";

// ── Sample track data — replace with your real data source ──
const TRACKS = [
  { id: 1, title: "Midnight Drive",   artist: "The Neon Waves",   duration: 238, emoji: "🌙" },
  { id: 2, title: "Electric Feel",    artist: "Synthwave Era",     duration: 252, emoji: "⚡" },
  { id: 3, title: "Ocean Eyes",       artist: "Coastal Dreams",    duration: 221, emoji: "🌊" },
  { id: 4, title: "Neon Lights",      artist: "Chrome Society",    duration: 305, emoji: "🔥" },
  { id: 5, title: "Glass Heart",      artist: "Prism Theory",      duration: 198, emoji: "💎" },
  { id: 6, title: "Last Summer",      artist: "The Pale Hours",    duration: 267, emoji: "🌅" },
];

const VIZ_HEIGHTS = [12,20,34,26,44,38,52,42,36,48,30,20,44,36,24,40,28,46,18,32,44,22,38,16];
const VIZ_DURS   = [0.5,0.7,0.9,0.6,0.8,1.0,0.7,0.55,0.85,0.65,0.75,0.95,0.6,0.8,0.5,0.7,0.9,0.55,0.75,0.65,0.8,0.6,0.7,0.85];

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function MusicPage() {
  const navigate = useNavigate();
  const [playing, setPlaying]       = useState(false);
  const [trackIdx, setTrackIdx]     = useState(0);
  const [progress, setProgress]     = useState(0);   // 0–1
  const [shuffle, setShuffle]       = useState(false);
  const [repeat, setRepeat]         = useState(false);
  const [liked, setLiked]           = useState({});
  const [entered, setEntered]       = useState(false);
  const timerRef = useRef(null);

  const track = TRACKS[trackIdx];
  const elapsed = Math.floor(progress * track.duration);

  // mount animation
  useEffect(() => {
    const t = requestAnimationFrame(() =>
      requestAnimationFrame(() => setEntered(true))
    );
    return () => cancelAnimationFrame(t);
  }, []);

  // progress ticker
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 1) {
          nextTrack();
          return 0;
        }
        return p + 1 / track.duration / 10;
      });
    }, 100);
    return () => clearInterval(timerRef.current);
  }, [playing, trackIdx]);

  const nextTrack = useCallback(() => {
    setProgress(0);
    setTrackIdx((i) => {
      if (shuffle) {
        let next;
        do { next = Math.floor(Math.random() * TRACKS.length); } while (next === i);
        return next;
      }
      return repeat ? i : (i + 1) % TRACKS.length;
    });
  }, [shuffle, repeat]);

  const prevTrack = useCallback(() => {
    setProgress(0);
    setTrackIdx((i) => (i - 1 + TRACKS.length) % TRACKS.length);
  }, []);

  const seekTo = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setProgress(pct);
  }, []);

  const goBack = () => {
    setEntered(false);
    setTimeout(() => navigate(-1), 350);
  };

  return (
    <div className={`mp-root ${entered ? "mp-entered" : ""}`}>

      {/* ── HEADER ── */}
      <div className="mp-header">
        <button className="mp-back" onClick={goBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="mp-header-title">Now Playing</span>
        <button className="mp-menu-btn" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <circle cx="12" cy="5"  r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>
      </div>

      {/* ── DISC + TRACK INFO ── */}
      <div className="mp-hero">
        <div className={`mp-disc-wrap ${playing ? "mp-disc-spin" : ""}`}>
          <div className="mp-disc-outer">
            <div className="mp-disc-inner">
              <span className="mp-disc-emoji">{track.emoji}</span>
            </div>
          </div>
          <div className={`mp-disc-ring ${playing ? "mp-ring-spin" : ""}`} />
          <div className={`mp-disc-ring mp-ring2 ${playing ? "mp-ring-spin2" : ""}`} />
        </div>

        <div className={`mp-track-info ${playing ? "mp-info-pulse" : ""}`}>
          <div className="mp-track-title">{track.title}</div>
          <div className="mp-track-artist">{track.artist}</div>
        </div>
      </div>

      {/* ── VISUALIZER ── */}
      <div className="mp-viz">
        {VIZ_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="mp-bar"
            style={{
              "--h": `${h}px`,
              "--dur": `${VIZ_DURS[i]}s`,
              animationDelay: `${(i * 0.04).toFixed(2)}s`,
              animationPlayState: playing ? "running" : "paused",
            }}
          />
        ))}
      </div>

      {/* ── PROGRESS ── */}
      <div className="mp-progress-area">
        <div className="mp-progress-bar" onClick={seekTo} role="slider" aria-valuenow={Math.round(progress * 100)}>
          <div className="mp-progress-fill" style={{ width: `${progress * 100}%` }}>
            <div className="mp-progress-dot" />
          </div>
        </div>
        <div className="mp-time-row">
          <span>{fmt(elapsed)}</span>
          <span>{fmt(track.duration)}</span>
        </div>
      </div>

      {/* ── LIKE + CONTROLS ── */}
      <div className="mp-like-row">
        <button
          className={`mp-like-btn ${liked[track.id] ? "mp-liked" : ""}`}
          onClick={() => setLiked((l) => ({ ...l, [track.id]: !l[track.id] }))}
          aria-label="Like"
        >
          <svg viewBox="0 0 24 24" fill={liked[track.id] ? "currentColor" : "none"} width="22" height="22">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="mp-controls">
        <button
          className={`mp-ctrl mp-ctrl-sm ${shuffle ? "mp-ctrl-active" : ""}`}
          onClick={() => setShuffle((s) => !s)}
          aria-label="Shuffle"
        >
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path d="M16 3h5v5M4 20l16-16M16 21h5v-5M4 4l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        <button className="mp-ctrl mp-ctrl-md" onClick={prevTrack} aria-label="Previous">
          <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
            <path d="M19 20L9 12l10-8v16zM5 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <button
          className="mp-ctrl mp-ctrl-play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        <button className="mp-ctrl mp-ctrl-md" onClick={nextTrack} aria-label="Next">
          <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
            <path d="M5 4l10 8-10 8V4zM19 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <button
          className={`mp-ctrl mp-ctrl-sm ${repeat ? "mp-ctrl-active" : ""}`}
          onClick={() => setRepeat((r) => !r)}
          aria-label="Repeat"
        >
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* ── QUEUE ── */}
      <div className="mp-queue-head">Up next</div>
      <div className="mp-queue">
        {TRACKS.map((t, i) => (
          <div
            key={t.id}
            className={`mp-queue-row ${i === trackIdx ? "mp-queue-active" : ""}`}
            onClick={() => { setTrackIdx(i); setProgress(0); }}
          >
            <div className="mp-queue-thumb">{t.emoji}</div>
            <div className="mp-queue-info">
              <div className="mp-queue-name">{t.title}</div>
              <div className="mp-queue-artist">{t.artist}</div>
            </div>
            {i === trackIdx ? (
              <div className="mp-mini-viz">
                {[8,14,10,16,12].map((h, j) => (
                  <div key={j} className="mp-mini-bar" style={{
                    "--h": `${h}px`, "--dur": `${0.5 + j * 0.12}s`,
                    animationDelay: `${j * 0.08}s`,
                    animationPlayState: playing ? "running" : "paused",
                  }}/>
                ))}
              </div>
            ) : (
              <span className="mp-queue-dur">{fmt(t.duration)}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ height: 80 }} />
    </div>
  );
}