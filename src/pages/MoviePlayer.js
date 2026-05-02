import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Hls from "hls.js";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);

  const [mode, setMode] = useState("iframe"); 
  const [directUrl, setDirectUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // LAYER 1: Ad-Blocking Mutation Observer
  // Detects and removes anti-user elements added by 3rd party scripts
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(() => {
        // Find common ad-related patterns or unwanted overlays
        const overlays = document.querySelectorAll(
          'div[style*="z-index: 2147483647"], iframe[id*="google_ads"], .ad-container'
        );
        overlays.forEach(el => el.remove());
      });
    });

    if (containerRef.current) {
      observer.observe(containerRef.current, { childList: true, subtree: true });
    }

    return () => observer.disconnect();
  }, []);

  // 2. Scraping & Fallback Logic
  useEffect(() => {
    if (!movie?.link) {
      setError("No movie source found.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const getDirectSource = async () => {
      try {
        setLoading(true);
        const response = await fetch(movie.link, { signal: controller.signal });
        const html = await response.text();

        const videoRegex = /["'](https?:\/\/[^"']+\.(mp4|m3u8)[^"']*)["']/i;
        const match = html.match(videoRegex);

        if (match) {
          const cleanUrl = match[1].replace(/\\/g, "");
          setDirectUrl(cleanUrl);
          setMode("direct");
        } else {
          setMode("iframe");
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setMode("iframe");
        }
      }
    };

    getDirectSource();

    return () => {
      controller.abort();
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, [movie]);

  // 3. Video Initialization (HLS/Direct)
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
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setMode("iframe"); });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        video.addEventListener("loadedmetadata", () => {
          setLoading(false);
          video.play().catch(() => {});
        });
      }
    } else {
      video.src = directUrl;
      video.onloadeddata = () => {
        setLoading(false);
        video.play().catch(() => {});
      };
    }
  }, [directUrl, mode]);

  if (!movie) {
    return (
      <div className="player-page-bg">
        <div className="ultra-card error-container">
          <h2>No Data Found</h2>
          <button className="over-back-btn" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-page-bg" ref={containerRef}>
      <div className="ultra-card">
        
        <div className="player-header">
          <button className="over-back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h2 className="movie-title-text">
            {movie.title || "Movie Player"}
          </h2>
        </div>

        <div className="video-viewport">
          {loading && (
            <div className="player-loader">
              <div className="spinner"></div>
              <span>Cleaning Stream & Loading...</span>
            </div>
          )}

          {mode === "direct" ? (
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              className="native-video"
            />
          ) : (
            /* LAYER 2 & 3: AD-BLOCKING IFRAME */
            /* Note: We exclude 'allow-popups' and 'allow-modals' to kill ads */
            <iframe
              src={movie.link}
              title={movie.title}
              allowFullScreen
              frameBorder="0"
              scrolling="no"
              /* STRIC TEST SANDBOX: No popups, no forms, no top-level navigation */
              sandbox="allow-scripts allow-same-origin allow-presentation"
              onLoad={() => setLoading(false)}
              className="iframe-video"
            />
          )}
        </div>

        {error && <div className="player-error-toast">{error}</div>}
      </div>
    </div>
  );
}