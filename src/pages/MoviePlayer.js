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
  
  const audioCtxRef = useRef(null);
  const delayNodeRef = useRef(null);

  const [mode, setMode] = useState("loading");
  const [directUrl, setDirectUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSyncActive, setIsSyncActive] = useState(false);
  
  // Starting at 1.0s gives us a "buffer" to move audio both forward and backward
  const [audioOffset, setAudioOffset] = useState(1.0); 

  // --- Improved Audio Sync Logic with CORS Fallback ---
  const setupAudioGraph = async () => {
    if (!videoRef.current || audioCtxRef.current || mode !== "direct") return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      
      if (ctx.state === "suspended") await ctx.resume();

      // This is where the CORS error happens. 
      // If the server blocks us, this will throw an error or silence the video.
      const source = ctx.createMediaElementSource(videoRef.current);
      const delayNode = ctx.createDelay(10.0);

      delayNode.delayTime.setValueAtTime(audioOffset, ctx.currentTime);

      source.connect(delayNode);
      delayNode.connect(ctx.destination);

      audioCtxRef.current = ctx;
      delayNodeRef.current = delayNode;
      setIsSyncActive(true);
    } catch (e) {
      console.warn("CORS/Security Block: Audio Sync disabled to allow playback.", e);
      setIsSyncActive(false);
      // We don't throw an error here so the user can still watch the movie.
    }
  };

  useEffect(() => {
    if (delayNodeRef.current && audioCtxRef.current) {
      const now = audioCtxRef.current.currentTime;
      delayNodeRef.current.delayTime.setTargetAtTime(Math.max(0, audioOffset), now, 0.05);
    }
  }, [audioOffset]);

  // --- Source Discovery ---
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
        if (movie.link.match(/\.(mp4|m3u8|webm)($|\?)/i)) {
          setDirectUrl(movie.link);
          setMode("direct");
          return;
        }

        const response = await fetch(movie.link, { signal: controller.signal });
        const html = await response.text();
        const patterns = [
          /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
          /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
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
          setMode("iframe");
        }
      } catch (err) {
        if (err.name !== "AbortError") setMode("iframe");
      } finally {
        setLoading(false);
      }
    };

    getBestSource();

    return () => {
      controller.abort();
      if (hlsRef.current) hlsRef.current.destroy();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [movie]);

  // --- HLS Initialization ---
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
          video.play().catch(() => {});
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
      }
    } else {
      video.src = directUrl;
    }
  }, [mode, directUrl]);

  return (
    <div className="player-page-bg">
      <div className="ultra-card">
        <div className="player-header">
          <button className="over-back-btn" onClick={() => navigate(-1)}>← Back</button>
        </div>

        <div className="video-viewport">
          {loading && <div className="player-loader"><div className="spinner"></div></div>}

          {mode === "direct" && (
            <video
              ref={videoRef}
              controls
              autoPlay
              // We try anonymous first. If image_0a615f.png persists, 
              // the server simply doesn't support CORS.
              crossOrigin="anonymous" 
              onPlay={setupAudioGraph}
              className="native-video"
            />
          )}

          {mode === "iframe" && (
            <iframe
              src={movie.link}
              title={movie.title}
              allowFullScreen
              className="iframe-video"
              onLoad={() => setLoading(false)}
            />
          )}
        </div>

        {isSyncActive && (
          <div className="sync-control-panel">
            <div className="sync-info">
              <span>Audio Delay: <strong>{audioOffset.toFixed(2)}s</strong></span>
              <button onClick={() => setAudioOffset(1.0)}>Reset</button>
            </div>
            <input 
              type="range" min="0" max="4" step="0.05" 
              value={audioOffset} 
              onChange={(e) => setAudioOffset(parseFloat(e.target.value))} 
            />
            <div className="sync-labels">
              <small>← Audio Ahead</small>
              <small>Audio Behind →</small>
            </div>
          </div>
        )}

        {!isSyncActive && mode === "direct" && !loading && (
          <div className="sync-disabled-note">
            <small>Sync controls disabled due to server security (CORS).</small>
          </div>
        )}

        {error && <div className="player-error-toast">{error}</div>}
      </div>
    </div>
  );
}