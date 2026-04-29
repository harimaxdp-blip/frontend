import React, { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;
  const videoRef = useRef(null);

  useEffect(() => {
    if (!movie || !videoRef.current) return;

    const video = videoRef.current;

    const tryPlay = async () => {
      try {
        await video.play();
      } catch (err) {
        console.log("Autoplay blocked or failed:", err);
      }
    };

    tryPlay();
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
            preload="metadata"
            playsInline
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "12px",
              backgroundColor: "black",
            }}
          >
            <source src={movie.link} type="video/mp4" />
            Your browser does not support this video format.
          </video>
        </div>
      </div>
    </div>
  );
}