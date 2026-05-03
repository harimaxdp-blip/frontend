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
  const [iframeUrl, setIframeUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSyncActive, setIsSyncActive] = useState(false);
  
  const [audioOffset, setAudioOffset] = useState(1.0); 

  // --- Audio Sync Logic ---
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
    } catch (e) {
      console.warn("CORS/Security Block: Audio Sync disabled.", e);
      setIsSyncActive(false);
    }
  };

  useEffect(() => {
    if (delayNodeRef.current && audioCtxRef.current) {
      const now = audioCtxRef.current.currentTime;
      delayNodeRef.current.delayTime.setTargetAtTime(Math.max(0, audioOffset), now, 0.05);
    }
  }, [audioOffset]);

  // --- Source Discovery & YouTube Fix ---
  useEffect(() => {
    if (!movie?.link) {
      setError("No movie source found.");
      setLoading(false);
      return;
    }

    const getBestSource = async () => {
      try {
        setLoading(true);
        const url = movie.link;

        // 1. Handle YouTube Specifically
        const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
        if (ytMatch) {
          const videoId = ytMatch[1];
          // use youtube-nocookie for better privacy/ad reduction
          setIframeUrl(`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&modestbranding=1&rel=0`);
          setMode("iframe");
          return;
        }

        // 2. Handle Direct Video Files
        if (url.match(/\.(mp4|m3u8|webm)($|\?)/i)) {
          setDirectUrl(url);
          setMode("direct");
          return;
        }

        // 3. Fallback/Scraping for other links
        const response = await fetch(url).catch(() => null);
        if (response) {
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
            setIframeUrl(url);
            setMode("iframe");
          }
        } else {
          setIframeUrl(url);
          setMode("iframe");
        }
      } catch (err) {
        setIframeUrl(movie.link);
        setMode("iframe");
      } finally {
        setLoading(false);
      }
    };

    getBestSource();

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [movie]);

  // --- HLS Init ---
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
              crossOrigin="anonymous" 
              onPlay={setupAudioGraph}
              className="native-video"
            />
          )}

          {mode === "iframe" && (
            <iframe
              src={iframeUrl}
              title={movie?.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="iframe-video"
              onLoad={() => setLoading(false)}
            />
          )}
        </div>

        {/* Sync Controls */}
        {isSyncActive && mode === "direct" && (
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
          </div>
        )}

        {error && <div className="player-error-toast">{error}</div>}
      </div>
    </div>
  );
}