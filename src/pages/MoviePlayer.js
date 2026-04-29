import React, { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;
  const videoRef = useRef(null);

  useEffect(() => {
    // Only attempt to play if the movie and the video element exist
    if (movie && videoRef.current) {
      const playPromise = videoRef.current.play();

      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          // Auto-play was prevented or interrupted
          console.log("Playback interrupted or prevented:", error);
        });
      }
    }
  }, [movie]);

  if (!movie) {
    return (
      <div className="player-page-bg">
        <p style={{ color: "white" }}>No movie data found.</p>
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  return (
    <div className="player-page-bg">
      <div className="ultra-card">
        <button className="over-back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>

        <div className="video-zoom-box">
          <video
            ref={videoRef}
            controls
            // Removed autoPlay attribute to handle it manually in useEffect
            style={{ width: "100%", height: "100%", borderRadius: "12px" }}
          >
            <source src={movie.link} type="video/mp4" />
            <source src={movie.link} type="video/x-matroska" />
            Your browser does not support this video format.
          </video>
        </div>
      </div>
    </div>
  );
}