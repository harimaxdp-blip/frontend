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

  const [mode, setMode] = useState("loading"); 
  // loading | direct | iframe

  const [directUrl, setDirectUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!movie?.link) {
      setError("No movie source found.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const getBestSource = async () => {
      try {
        setLoading(true);
        setError("");

        // If already direct link
        if (
          movie.link.includes(".mp4") ||
          movie.link.includes(".m3u8")
        ) {
          setDirectUrl(movie.link);
          setMode("direct");
          return;
        }

        // Try scraping page
        const response = await fetch(movie.link, {
          signal: controller.signal,
        });

        const html = await response.text();

        const patterns = [
          /["'](https?:\/\/[^"']+\.m3u8(\?[^"']*)?)["']/i,
          /["'](https?:\/\/[^"']+\.mp4(\?[^"']*)?)["']/i,
          /file:\s*["']([^"']+)["']/i,
          /source:\s*["']([^"']+)["']/i,
        ];

        let found = null;

        for (const regex of patterns) {
          const match = html.match(regex);
          if (match) {
            found = match[1].replace(/\\/g, "");
            break;
          }
        }

        if (found) {
          setDirectUrl(found);
          setMode("direct");
        } else {
          // Safe iframe fallback
          setMode("iframe");
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Direct extraction failed:", err);

          // Fallback instead of blocking
          setMode("iframe");
        }
      }
    };

    getBestSource();

    return () => {
      controller.abort();

      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, [movie]);

  // Direct Player Logic
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;

    const video = videoRef.current;

    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    if (directUrl.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
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
            setMode("iframe");
          }
        });
      } else if (
        video.canPlayType("application/vnd.apple.mpegurl")
      ) {
        video.src = directUrl;

        video.addEventListener("loadedmetadata", () => {
          setLoading(false);
          video.play().catch(() => {});
        });
      } else {
        setMode("iframe");
      }
    } else {
      video.src = directUrl;

      video.onloadeddata = () => {
        setLoading(false);
        video.play().catch(() => {});
      };

      video.onerror = () => {
        setMode("iframe");
      };
    }
  }, [mode, directUrl]);

  if (!movie) {
    return (
      <div className="player-page-bg">
        <div className="ultra-card error-container">
          <h2>No Data Found</h2>
          <button
            className="over-back-btn"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-page-bg">
      <div className="ultra-card">
        {/* Header */}
        <div className="player-header">
          <button
            className="over-back-btn"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>


        </div>

        {/* Video Area */}
        <div className="video-viewport">
          {loading && (
            <div className="player-loader">
              <div className="spinner"></div>
              <span>Initializing Stream...</span>
            </div>
          )}

          {/* Direct Player */}
          {mode === "direct" && (
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              className="native-video"
            />
          )}

          {/* Fallback iframe */}
          {mode === "iframe" && (
            <iframe
              src={movie.link}
              title={movie.title}
              allowFullScreen
              frameBorder="0"
              scrolling="no"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer"
              className="iframe-video"
              onLoad={() => setLoading(false)}
            />
          )}
        </div>

        {error && (
          <div className="player-error-toast">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}