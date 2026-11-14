import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Hls from "hls.js";
import "./GlobalPlayer.css";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
};

const getYouTubeId = (value = "") => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (host.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
      return match?.[1] || null;
    }
  } catch {
    return null;
  }
  return null;
};

const isHlsUrl = (url = "") => /\.m3u8(?:$|[?#])/i.test(url);
const isDashUrl = (url = "") => /\.mpd(?:$|[?#])/i.test(url);

const isDirectMediaUrl = (url = "") =>
  /\.(?:mp4|m4v|webm|ogg|ogv|mp3|m3u8|mpd)(?:$|[?#])/i.test(url) ||
  /[?&](?:stream|direct)=1(?:&|$)/i.test(url);

const getWatchKey = (title, url) =>
  `moviehub-watch-${String(title || url || "movie")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 100)}`;

const readPosition = (key) => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};

const savePosition = (key, time) => {
  try {
    if (time > 5) localStorage.setItem(key, String(Math.floor(time)));
  } catch {
    // Storage can be unavailable in private browsing.
  }
};

const removePosition = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
};

function Icon({ name, size = 22 }) {
  const paths = {
    back: <path d="m15 18-6-6 6-6" />,
    play: <path d="m8 5 12 7-12 7V5Z" />,
    pause: <><path d="M8 5h3v14H8z" /><path d="M15 5h3v14h-3z" /></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>,
    mute: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>,
    fullscreen: <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /></>,
    shrink: <><path d="M8 3v5H3" /><path d="M3 8 9 2" /><path d="M16 21v-5h5" /><path d="m21 16-6 6" /><path d="M21 8h-5V3" /><path d="m16 8 6-6" /><path d="M3 16h5v5" /><path d="m8 16-6 6" /></>,
    rewind: <><path d="M11 19 2 12l9-7v14Z" /><path d="M22 19 13 12l9-7v14Z" /></>,
    forward: <><path d="m13 5 9 7-9 7V5Z" /><path d="m2 5 9 7-9 7V5Z" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></>,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.more}
    </svg>
  );
}

export default function GlobalPlayer({
  url,
  title = "Now Playing",
  playlist = null,
  startIndex = 0,
  onClose,
}) {
  const episodes = Array.isArray(playlist) ? playlist : [];
  const isSeries = episodes.length > 1;

  const [currentIndex, setCurrentIndex] = useState(() =>
    clamp(Number(startIndex) || 0, 0, Math.max(episodes.length - 1, 0))
  );

  const currentEpisode = isSeries ? episodes[currentIndex] : null;
  const mediaUrl =
    currentEpisode?.link ||
    currentEpisode?.url ||
    currentEpisode?.videoUrl ||
    url ||
    "";
  const mediaTitle = currentEpisode?.title || title;
  const watchKey = useMemo(
    () => getWatchKey(mediaTitle, mediaUrl),
    [mediaTitle, mediaUrl]
  );

  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const progressRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const scrubPointerRef = useRef(null);

  const [sourceMode, setSourceMode] = useState("loading");
  const [embedUrl, setEmbedUrl] = useState("");
  const [engine, setEngine] = useState("");
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStretched, setIsStretched] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [resumeTime, setResumeTime] = useState(0);
  const [showResume, setShowResume] = useState(false);
  const [countdown, setCountdown] = useState(null);

  const hasPrevious = isSeries && currentIndex > 0;
  const hasNext = isSeries && currentIndex < episodes.length - 1;

  const clearCountdown = useCallback(() => {
    window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setCountdown(null);
  }, []);

  const showPlayerControls = useCallback(() => {
    setShowControls(true);
    window.clearTimeout(hideTimerRef.current);

    if (isScrubbing) return;

    hideTimerRef.current = window.setTimeout(() => {
      if (!showResume) setShowControls(false);
    }, 3500);
  }, [isScrubbing, showResume]);

  const closePlayer = useCallback(() => {
    clearCountdown();
    if (typeof onClose === "function") {
      onClose();
    } else if (window.history.length > 1) {
      window.history.back();
    }
  }, [onClose, clearCountdown]);

  const goToEpisode = useCallback(
    (index) => {
      if (!isSeries || index < 0 || index >= episodes.length) return;
      clearCountdown();
      setCurrentIndex(index);
      setCurrentTime(0);
      setDuration(0);
      setError("");
      setShowResume(false);
    },
    [isSeries, episodes.length, clearCountdown]
  );

  const startCountdown = useCallback(() => {
    if (!hasNext || countdownTimerRef.current) return;

    setCountdown(8);
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((value) => {
        if (value === null || value <= 1) {
          window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }, [hasNext]);

  useEffect(() => {
    if (countdown === 0 && hasNext) goToEpisode(currentIndex + 1);
  }, [countdown, hasNext, currentIndex, goToEpisode]);

  // Resolve a direct media URL, YouTube URL, or regular embeddable page.
  useEffect(() => {
    try {
      hlsRef.current?.destroy();
    } catch {
      // Ignore HLS cleanup errors.
    }
    hlsRef.current = null;

    setError("");
    setSourceMode("loading");
    setEmbedUrl("");
    setEngine("");
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTime(0);
    setDuration(0);
    clearCountdown();

    if (!mediaUrl) {
      setSourceMode("error");
      setError("No video URL was provided.");
      return undefined;
    }

    const saved = readPosition(watchKey);
    if (saved > 10) {
      setResumeTime(saved);
      setShowResume(true);
    } else {
      setResumeTime(0);
      setShowResume(false);
    }

    const youtubeId = getYouTubeId(mediaUrl);

    if (youtubeId) {
      setEmbedUrl(
        `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&playsinline=1`
      );
      setEngine("YouTube");
      setSourceMode("embed");
    } else if (isDirectMediaUrl(mediaUrl)) {
      setEngine(isHlsUrl(mediaUrl) ? "HLS" : isDashUrl(mediaUrl) ? "DASH" : "Direct");
      setSourceMode("video");
    } else {
      setEmbedUrl(mediaUrl);
      setEngine("Embed");
      setSourceMode("embed");
    }

    return undefined;
  }, [mediaUrl, watchKey, clearCountdown]);

  // Attach HLS.js or native media playback.
  useEffect(() => {
    const video = videoRef.current;
    if (sourceMode !== "video" || !video || !mediaUrl) return undefined;

    setError("");

    if (isHlsUrl(mediaUrl)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
          backBufferLength: 30,
        });

        hlsRef.current = hls;
        hls.loadSource(mediaUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            setIsPlaying(false);
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError("Unable to play this HLS stream. Check the stream URL or server access.");
            hls.destroy();
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = mediaUrl;
        video.load();
        video.play().catch(() => setIsPlaying(false));
      } else {
        setError("HLS playback is not supported by this browser.");
      }
    } else if (isDashUrl(mediaUrl)) {
      setError("MPEG-DASH requires a DASH playback engine. This player currently supports HLS and browser-supported direct video.");
    } else {
      video.src = mediaUrl;
      video.load();
      video.play().catch(() => setIsPlaying(false));
    }

    return () => {
      try {
        hlsRef.current?.destroy();
      } catch {
        // Ignore cleanup errors.
      }
      hlsRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [sourceMode, mediaUrl]);

  // Video event listeners.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const onPlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      setError("");
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onTime = () => {
      setCurrentTime(video.currentTime || 0);
      if (Date.now() - (saveTimerRef.current || 0) > 5000) {
        savePosition(watchKey, video.currentTime || 0);
        saveTimerRef.current = Date.now();
      }
    };
    const onDuration = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onVolume = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };
    const onEnded = () => {
      removePosition(watchKey);
      if (hasNext) startCountdown();
    };
    const onError = () => {
      if (video.error) {
        setError("This video could not be played. The format, URL, or server permissions may be unsupported.");
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
    };
  }, [watchKey, hasNext, startCountdown, sourceMode]);

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    document.addEventListener("webkitfullscreenchange", updateFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen);
      document.removeEventListener("webkitfullscreenchange", updateFullscreen);
    };
  }, []);

  useEffect(() => {
    showPlayerControls();
    return () => {
      window.clearTimeout(hideTimerRef.current);
      window.clearInterval(countdownTimerRef.current);
      try {
        hlsRef.current?.destroy();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, [showPlayerControls]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => setError("Playback could not start. Tap play again or check the source."));
    } else {
      video.pause();
    }
    showPlayerControls();
  }, [showPlayerControls]);

  const seekBy = useCallback(
    (amount) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      video.currentTime = clamp(video.currentTime + amount, 0, video.duration);
      showPlayerControls();
    },
    [showPlayerControls]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    showPlayerControls();
  }, [showPlayerControls]);

  const changeVolume = useCallback((value) => {
    const video = videoRef.current;
    if (!video) return;
    const nextVolume = clamp(Number(value), 0, 1);
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const element = playerRef.current;
    if (!element) return;

    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (element.requestFullscreen) await element.requestFullscreen();
        else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch {
      setError("Fullscreen is not available in this browser.");
    }
  }, []);

  const seekToPointer = useCallback((clientX) => {
    const video = videoRef.current;
    const track = progressRef.current;
    if (!video || !track || !Number.isFinite(video.duration)) return;

    const rect = track.getBoundingClientRect();
    const percent = clamp((clientX - rect.left) / rect.width, 0, 1);
    video.currentTime = percent * video.duration;
    setCurrentTime(video.currentTime);
  }, []);

  const onProgressPointerDown = (event) => {
    if (duration <= 0) return;
    event.preventDefault();
    scrubPointerRef.current = event.pointerId;
    setIsScrubbing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekToPointer(event.clientX);
    showPlayerControls();
  };

  const onProgressPointerMove = (event) => {
    if (!isScrubbing || scrubPointerRef.current !== event.pointerId) return;
    seekToPointer(event.clientX);
  };

  const onProgressPointerUp = (event) => {
    if (scrubPointerRef.current !== event.pointerId) return;
    scrubPointerRef.current = null;
    setIsScrubbing(false);
    showPlayerControls();
  };

  const handleResume = () => {
    const video = videoRef.current;
    if (!video) return;

    const resume = () => {
      video.currentTime = Math.min(resumeTime, Math.max(video.duration - 1, 0));
      video.play().catch(() => setError("Tap play to resume playback."));
      setShowResume(false);
    };

    if (video.readyState >= 1) resume();
    else video.addEventListener("loadedmetadata", resume, { once: true });
  };

  const handleStartOver = () => {
    removePosition(watchKey);
    setShowResume(false);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => setError("Tap play to start the video."));
    }
  };

  // Keyboard shortcuts are disabled while typing in form fields.
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "arrowleft":
          event.preventDefault();
          seekBy(-10);
          break;
        case "arrowright":
          event.preventDefault();
          seekBy(10);
          break;
        case "arrowup":
          event.preventDefault();
          changeVolume(Math.min(1, volume + 0.05));
          break;
        case "arrowdown":
          event.preventDefault();
          changeVolume(Math.max(0, volume - 0.05));
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "escape":
          if (!document.fullscreenElement) closePlayer();
          break;
        default:
          break;
      }
      showPlayerControls();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    togglePlay,
    seekBy,
    changeVolume,
    volume,
    toggleMute,
    toggleFullscreen,
    closePlayer,
    showPlayerControls,
  ]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={playerRef}
      className={`gp-player ${showControls ? "gp-controls-visible" : "gp-controls-hidden"}`}
      onMouseMove={showPlayerControls}
      onTouchStart={showPlayerControls}
      onClick={(event) => {
        if (event.target === event.currentTarget) showPlayerControls();
      }}
    >
      <div className="gp-stage">
        {sourceMode === "video" && (
          <video
            ref={videoRef}
            className={`gp-video ${isStretched ? "gp-video-stretched" : ""}`}
            playsInline
            preload="metadata"
            controls={false}
            onClick={togglePlay}
          />
        )}

        {sourceMode === "embed" && (
          <iframe
            className="gp-embed"
            src={embedUrl}
            title={mediaTitle}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}

        {sourceMode === "loading" && (
          <div className="gp-state">
            <span className="gp-spinner" />
            <p>Preparing your movie...</p>
          </div>
        )}

        {(isBuffering || (sourceMode === "video" && !isPlaying && !error && !showResume)) && (
          <div className="gp-buffering" aria-label="Buffering">
            <span className="gp-spinner" />
          </div>
        )}

        {sourceMode === "error" && (
          <div className="gp-state">
            <Icon name="alert" size={34} />
            <h2>Unable to open video</h2>
            <p>{error}</p>
          </div>
        )}

        <header className="gp-topbar">
          <button className="gp-icon-button gp-back" onClick={closePlayer} aria-label="Close player">
            <Icon name="back" />
            <span>Back</span>
          </button>

          <div className="gp-heading">
            <div className="gp-title" title={mediaTitle}>{mediaTitle}</div>
            <div className="gp-subtitle">
              {isSeries ? `Episode ${currentIndex + 1} of ${episodes.length}` : "Now playing"}
              {engine && <span className="gp-engine">{engine}</span>}
            </div>
          </div>

          <div className="gp-top-actions">
            {sourceMode === "video" && (
              <button
                className={`gp-icon-button ${isStretched ? "is-active" : ""}`}
                onClick={() => setIsStretched((value) => !value)}
                aria-label="Toggle video fit"
                title="Toggle video fit"
              >
                <Icon name="fullscreen" />
              </button>
            )}
            <button
              className="gp-icon-button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <Icon name={isFullscreen ? "shrink" : "fullscreen"} />
            </button>
          </div>
        </header>

        {sourceMode === "video" && !showResume && (
          <div className="gp-center-controls">
            {hasPrevious && (
              <button className="gp-round-control gp-side-control" onClick={() => goToEpisode(currentIndex - 1)} aria-label="Previous episode">
                <span className="gp-control-icon"><Icon name="back" size={24} /></span>
                <small>Previous</small>
              </button>
            )}
            <button className="gp-round-control gp-side-control" onClick={() => seekBy(-10)} aria-label="Rewind 10 seconds">
              <span className="gp-control-icon"><Icon name="rewind" /></span>
              <small>10 sec</small>
            </button>
            <button className="gp-main-play" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
              <Icon name={isPlaying ? "pause" : "play"} size={30} />
            </button>
            <button className="gp-round-control gp-side-control" onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
              <span className="gp-control-icon"><Icon name="forward" /></span>
              <small>10 sec</small>
            </button>
            {hasNext && (
              <button className="gp-round-control gp-side-control" onClick={() => goToEpisode(currentIndex + 1)} aria-label="Next episode">
                <span className="gp-control-icon"><Icon name="forward" size={24} /></span>
                <small>Next</small>
              </button>
            )}
          </div>
        )}

        {sourceMode === "video" && (
          <div className={`gp-bottom-panel ${isSeries ? "gp-has-episodes" : ""}`}>
            <div className="gp-progress-row">
              <span className="gp-time">{formatTime(currentTime)}</span>
              <div
                ref={progressRef}
                className="gp-progress"
                role="slider"
                aria-label="Video progress"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration || 0)}
                aria-valuenow={Math.floor(currentTime)}
                tabIndex={0}
                onPointerDown={onProgressPointerDown}
                onPointerMove={onProgressPointerMove}
                onPointerUp={onProgressPointerUp}
                onPointerCancel={onProgressPointerUp}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") seekBy(-5);
                  if (event.key === "ArrowRight") seekBy(5);
                }}
              >
                <div className="gp-progress-track" />
                <div className="gp-progress-fill" style={{ width: `${progress}%` }} />
                <div className="gp-progress-thumb" style={{ left: `${progress}%` }} />
              </div>
              <span className="gp-time">{formatTime(duration)}</span>
            </div>

            <div className="gp-toolbar">
              <div className="gp-toolbar-left">
                <button className="gp-tool-button" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                  <Icon name={isPlaying ? "pause" : "play"} />
                </button>
                <button className="gp-tool-button" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
                  <Icon name={isMuted || volume === 0 ? "mute" : "volume"} />
                </button>
                <input
                  className="gp-volume"
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={(event) => changeVolume(event.target.value)}
                />
              </div>
              <div className="gp-toolbar-right">
                <span className="gp-quality-label">{engine}</span>
                <button className="gp-tool-button" onClick={toggleFullscreen} aria-label="Fullscreen">
                  <Icon name={isFullscreen ? "shrink" : "fullscreen"} />
                </button>
              </div>
            </div>
          </div>
        )}

        {showResume && sourceMode === "video" && (
          <div className="gp-overlay">
            <div className="gp-dialog">
              <div className="gp-dialog-mark"><Icon name="play" size={25} /></div>
              <span className="gp-eyebrow">WELCOME BACK</span>
              <h2>Continue watching?</h2>
              <p>You stopped at {formatTime(resumeTime)}.</p>
              <div className="gp-dialog-actions">
                <button className="gp-primary-button" onClick={handleResume}>Resume</button>
                <button className="gp-secondary-button" onClick={handleStartOver}>Start over</button>
              </div>
            </div>
          </div>
        )}

        {countdown !== null && hasNext && (
          <div className="gp-overlay">
            <div className="gp-dialog">
              <span className="gp-eyebrow">UP NEXT</span>
              <h2>{episodes[currentIndex + 1]?.title || `Episode ${currentIndex + 2}`}</h2>
              <div className="gp-countdown">{countdown === 0 ? "Playing..." : countdown}</div>
              <p>Next episode starts automatically.</p>
              <div className="gp-dialog-actions">
                <button className="gp-primary-button" onClick={() => goToEpisode(currentIndex + 1)}>Play now</button>
                <button className="gp-secondary-button" onClick={clearCountdown}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="gp-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">×</button>
          </div>
        )}

        {isSeries && (
          <nav className="gp-episodes" aria-label="Episodes">
            <button
              className="gp-episode-arrow"
              disabled={!hasPrevious}
              onClick={() => goToEpisode(currentIndex - 1)}
              aria-label="Previous episode"
            >
              <Icon name="back" size={19} />
            </button>
            <div className="gp-episode-list">
              {episodes.map((episode, index) => (
                <button
                  key={episode.id || episode.episode || index}
                  className={`gp-episode ${index === currentIndex ? "is-current" : ""}`}
                  onClick={() => goToEpisode(index)}
                  aria-current={index === currentIndex ? "step" : undefined}
                  title={episode.title || `Episode ${index + 1}`}
                >
                  {episode.episode || index + 1}
                </button>
              ))}
            </div>
            <button
              className="gp-episode-arrow"
              disabled={!hasNext}
              onClick={() => goToEpisode(currentIndex + 1)}
              aria-label="Next episode"
            >
              <Icon name="forward" size={19} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
