import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;

  if (!movie) return null;

  return (
    <div className="player-page-bg">
      <div className="ultra-card">
        {/* Button floats on top, no space taken */}
        <button className="over-back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>

        <div className="video-zoom-box">
          <iframe
            src={movie.link}
            title={movie.title}
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}