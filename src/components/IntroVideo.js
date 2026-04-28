import { useEffect, useRef, useState } from "react";
import tvVideo from "../assets/intro-tv.mp4";
import mobileVideo from "../assets/intro-mobile.mp4";
import "./IntroVideo.css";

export default function IntroVideo({ onFinish }) {
  const videoRef = useRef(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      // Check if it's a mobile width OR if the screen is taller than it is wide
      const isPortrait = window.innerHeight > window.innerWidth;
      const isSmallScreen = window.innerWidth <= 768;
      
      const nextSrc = (isPortrait || isSmallScreen) ? mobileVideo : tvVideo;
      
      if (nextSrc !== videoSrc) {
        setVideoSrc(nextSrc);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [videoSrc]);

  const handleStart = async () => {
    if (!videoRef.current) return;
    
    try {
      // Browsers allow audio ONLY after this click event
      videoRef.current.muted = false;
      videoRef.current.volume = 1.0;
      await videoRef.current.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Playback failed:", err);
    }
  };

  if (!videoSrc) return null;

  return (
    <div className="intro-screen" onClick={!isPlaying ? handleStart : null}>
      <video
        ref={videoRef}
        key={videoSrc} // Forces reload when switching mobile/desktop
        className={`intro-video ${isPlaying ? "visible" : "hidden"}`}
        playsInline
        onEnded={onFinish}
        // Start muted just in case, handleStart will unmute it
        muted={!isPlaying} 
      >
        <source src={videoSrc} type="video/mp4" />
      </video>

      {!isPlaying && (
        <div className="overlay">
          <div className="play-button">
             <span>ENTER</span>
          </div>
        </div>
      )}
    </div>
  );
}