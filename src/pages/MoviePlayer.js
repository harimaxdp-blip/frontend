import React, { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import videojs from "video.js";

import "video.js/dist/video-js.css";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;

  const videoRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!movie || !videoRef.current) return;

    // Dispose old player
    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }

    // Use backend proxy to bypass CORS
    const proxiedUrl = `http://localhost:5000/proxy-video?url=${encodeURIComponent(
      movie.link
    )}`;

    const player = videojs(videoRef.current, {
      controls: true,
      responsive: true,
      fluid: true,
      autoplay: false,
      preload: "auto",
      html5: {
        nativeAudioTracks: false,
        nativeVideoTracks: false,
      },
      sources: [
        {
          src: proxiedUrl,
          type: movie.link.toLowerCase().includes(".mkv")
            ? "video/x-matroska"
            : "video/mp4",
        },
      ],
    });

    playerRef.current = player;

    player.ready(() => {
      console.log("Player Ready");

      player.muted(false);
      player.volume(1);

      player.play().catch((err) => {
        console.log(
          "Playback interrupted or prevented:",
          err
        );
      });
    });

    player.on("loadedmetadata", () => {
      console.log("Metadata loaded");

      // Force volume
      const tech = player.tech(true)?.el();

      if (tech) {
        tech.muted = false;
        tech.volume = 1;
      }

      // Try selecting AAC/stereo track if exposed
      try {
        const tracks = player.audioTracks();

        if (tracks && tracks.length > 0) {
          let preferred = 0;

          for (let i = 0; i < tracks.length; i++) {
            const label = (
              tracks[i].label || ""
            ).toLowerCase();

            console.log(
              i,
              tracks[i].label,
              tracks[i].language
            );

            if (
              label.includes("aac") ||
              label.includes("2.0") ||
              label.includes("stereo")
            ) {
              preferred = i;
            }
          }

          for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = i === preferred;
          }

          console.log(
            "Selected preferred audio track:",
            preferred
          );
        } else {
          console.log(
            "No selectable audio tracks exposed by browser."
          );
        }
      } catch (err) {
        console.log(
          "Audio track detection failed:",
          err
        );
      }
    });

    player.on("error", () => {
      console.error("VideoJS Error:", player.error());
      alert(
        "Video could not be played. Browser may not support this codec even after proxy."
      );
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [movie]);

  if (!movie) {
    return (
      <div className="player-page-bg">
        <p style={{ color: "white" }}>
          No movie data found.
        </p>

        <button onClick={() => navigate(-1)}>
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="player-page-bg">
      <div className="ultra-card">
        <button
          className="over-back-btn"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>

        <div className="video-zoom-box">
          <div data-vjs-player>
            <video
              ref={videoRef}
              className="video-js vjs-big-play-centered"
              playsInline
              crossOrigin="anonymous"
            />
          </div>
        </div>
      </div>
    </div>
  );
}