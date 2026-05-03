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
  
  // Audio Sync Refs
  const audioCtxRef = useRef(null);
  const delayNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  const [mode, setMode] = useState("loading");
  const [directUrl, setDirectUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [audioOffset, setAudioOffset] = useState(0); // In seconds

  // --- Audio Sync Logic ---
  const setupAudioGraph = () => {
    if (!videoRef.current || audioCtxRef.current || mode !== "direct") return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      
      // Create nodes
      const source = ctx.createMediaElementSource(videoRef.current);
      const delayNode = ctx.createDelay(5.0); // Max 5 second buffer

      delayNode.delayTime.value = audioOffset;

      // Connect: Video -> Delay -> Speakers
      source.connect(delayNode);
      delayNode.connect(ctx.destination);

      audioCtxRef.current = ctx;
      delayNodeRef.current = delayNode;
      sourceNodeRef.current = source;
    } catch (e) {
      console.error("AudioContext failed. Direct audio sync unavailable.", e);
    }
  };

  useEffect(() => {
    if (delayNodeRef.current) {
      delayNodeRef.current.delayTime.value = Math.max(0, audioOffset);
    }
  }, [audioOffset]);

  // --- Data Fetching Logic ---
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
        if (movie.link.includes(".mp4") || movie.link.includes(".m3u8")) {
          setDirectUrl(movie.link);
          setMode("direct");
          return;
        }

        const response = await fetch(movie.link, { signal: controller.signal });
        const html = await response.text();
        const patterns = [
          /["'](https?:\/\/[^"']+\.m3u8(\?[^"']*)?)["']/i,
          /["'](https?:\/\/[^"']+\.mp4(\?[^"']*)?)["']/i,
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
      }
    };

    getBestSource();

    return () => {
      controller.abort();
      if (hlsRef.current) hlsRef.current.destroy();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [movie]);

  // --- Player Initialization ---
  useEffect(() => {
    if (mode !== "direct" || !directUrl || !videoRef.current) return;

    const video = videoRef.current;
    if (hlsRef.current) hlsRef.current.destroy();

    if (directUrl.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(directUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          video.play().catch(() => {});
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = directUrl;
        video.onloadedmetadata = () => { setLoading(false); video.play(); };
      }
    } else {
      video.src = directUrl;
      video.onloadeddata = () => setLoading(false);
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
              crossOrigin="anonymous" // Required for Web Audio API
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

        {/* Sync Controls UI */}
        {mode === "direct" && (
          <div className="sync-control-panel">
            <p>Audio Sync: <strong>{audioOffset.toFixed(2)}s</strong></p>
            <div className="sync-buttons">
              <button onClick={() => setAudioOffset(prev => prev - 0.1)}>-0.1s</button>
              <button onClick={() => setAudioOffset(0)}>Reset</button>
              <button onClick={() => setAudioOffset(prev => prev + 0.1)}>+0.1s</button>
            </div>
            <small>Use + if audio is ahead of video, - if it's behind.</small>
          </div>
        )}

        {error && <div className="player-error-toast">{error}</div>}
      </div>
    </div>
  );
}