import React, { useEffect, useRef, useState } from "react";
import "./ComingSoon.css";
import logo from "../assets/gear-link2.png";
import bgVideo from "../assets/bg-wave.mp4";

const ComingSoon = () => {
  const videoRef = useRef(null);
  const [isVideoLoading, setIsVideoLoading] = useState(true);

  useEffect(() => {
    if (videoRef.current) {
      // Force playback check
      videoRef.current.play().catch((error) => {
        console.warn("Autoplay blocked by browser policy:", error);
      });
    }
  }, []);

  // Fired when the video has buffered enough data to start playing
  const handleVideoCanPlay = () => {
    setIsVideoLoading(false);
  };

  return (
    <div className="coming-soon-container">
      
      {/* ── LOGO MATCHED LOADING SCREEN ── */}
      {isVideoLoading && (
        <div className="video-loader-screen">
          <div className="loader-logo-wrapper">
            <img src={logo} alt="Loading Logo" className="loader-logo-pulse" />
            <div className="loader-glow-ring"></div>
          </div>
          <p className="loader-text">Tuning your experience...</p>
        </div>
      )}

      {/* Background Video Wrapper */}
      <div className={`video-background-wrapper ${!isVideoLoading ? "visible" : ""}`}>
        <video
          ref={videoRef}
          className="coming-soon-bg-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onCanPlayThrough={handleVideoCanPlay}
        >
          <source src={bgVideo} type="video/mp4" />
        </video>
      </div>

      {/* Foreground Content Wrapper */}
      <div className={`coming-soon-content ${!isVideoLoading ? "fade-in" : "hidden"}`}>
        <img src={logo} alt="Logo" className="coming-soon-logo" />

        <h1 className="coming-soon-title">Coming Soon</h1>

        <div className="coming-soon-divider">
          <svg viewBox="0 0 20 20" width="30" height="20">
            <rect x="2" y="2" width="2" height="16" fill="currentColor" />
            <rect x="6" y="5" width="2" height="10" fill="currentColor" />
            <rect x="10" y="0" width="2" height="20" fill="currentColor" />
            <rect x="14" y="5" width="2" height="10" fill="currentColor" />
            <rect x="18" y="2" width="2" height="16" fill="currentColor" />
          </svg>
        </div>

        <p className="coming-soon-desc">
          We’re crafting a next-generation
          <br /> music experience.
        </p>

        <p className="coming-soon-tagline">
          Your sound. Your way. All in one place.
        </p>

        <button className="notify-btn" onClick={() => alert("Notification set!")}>
          <span className="bell-icon">🔔</span>
          Get notified when we launch
          <span className="arrow-icon">→</span>
        </button>

        <div className="footer-section">
          <span className="heart">❤</span>
          <p>MUSIC IS EVERYTHING</p>
        </div>
      </div>
    </div>
  );
};

export default ComingSoon;