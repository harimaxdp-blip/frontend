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

  const [mode, setMode] = useState("iframe"); // iframe | direct
  const [directUrl, setDirectUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 1. Scraping & Fallback Logic
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
        // We fetch the link to see if we can extract a raw .mp4 or .m3u8
        const response = await fetch(movie.link, { signal: controller.signal });
        const html = await response.text();

        // Looks for standard video extensions in the source code
        const videoRegex = /["'](https?:\/\/[^"']+\.(mp4|m3u8)[^"']*)["']/i;
        const match = html.match(videoRegex);

        if (match) {
          // Clean up escaped slashes if found (common in JS scripts)
          const cleanUrl = match[1].replace(/\\/g, "");
          setDirectUrl(cleanUrl);
          setMode("direct");
        } else {
          // No direct link found, use Iframe fallback
          setMode("iframe");
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Direct fetch failed or blocked by CORS. Using iframe.");
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

  // 2. Video Initialization (Direct Mode)
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;

    const video = videoRef.current;

    if (directUrl.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true, // Improves performance on mobile
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setMode("iframe"); // Drop back to iframe if stream fails
          }
        });
      } 
      // Native Safari/iOS support
      else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        video.addEventListener("loadedmetadata", () => {
          setLoading(false);
          video.play().catch(() => {});
        });
      }
    } else {
      // Standard MP4 handling
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
    <div className="player-page-bg">
      <div className="ultra-card">
        
        {/* Responsive Header */}
        <div className="player-header">
          <button className="over-back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h2 className="movie-title-text">
            {movie.title || "Movie Player"}
          </h2>
        </div>

        {/* Video Area */}
        <div className="video-viewport">
          {loading && (
            <div className="player-loader">
              <div className="spinner"></div>
              <span>Initializing Stream...</span>
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
            <iframe
              src={movie.link}
              title={movie.title}
              allowFullScreen
              frameBorder="0"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
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