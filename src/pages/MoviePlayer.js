import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Movies2.css";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie = location.state?.movie;
  const videoRef = useRef(null);
  const [audioTracks, setAudioTracks] = useState([]);

  useEffect(() => {
    if (!movie || !videoRef.current) return;
    const video = videoRef.current;

    const handleMetadata = () => {
      // Logic for Multi-track audio selection
      if (video.audioTracks) {
        const tracks = [];
        for (let i = 0; i < video.audioTracks.length; i++) {
          tracks.push({
            id: i,
            label: video.audioTracks[i].label || `Track ${i + 1}`,
            enabled: video.audioTracks[i].enabled
          });
        }
        setAudioTracks(tracks);
      }
    };

    video.addEventListener('loadedmetadata', handleMetadata);

    // FIX: Do NOT call video.play() here if you want sound immediately.
    // If you call .play() via script, browser forces mute.
    // We remove the playVideo() call to let the 'autoPlay' attribute or user click handle it.

    return () => video.removeEventListener('loadedmetadata', handleMetadata);
  }, [movie]);

  // Function to switch tracks manually if multiple exist
  const switchTrack = (index) => {
    if (videoRef.current.audioTracks) {
      for (let i = 0; i < videoRef.current.audioTracks.length; i++) {
        videoRef.current.audioTracks[i].enabled = (i === index);
      }
      setAudioTracks([...audioTracks.map((t, i) => ({ ...t, enabled: i === index }))]);
    }
  };

  if (!movie) return <div className="player-page-bg">No Data</div>;

  return (
    <div className="player-page-bg">
      <div className="ultra-card">
        <button className="over-back-btn" onClick={() => navigate(-1)}>← Back</button>
        
        <div className="video-zoom-box">
          <video
            ref={videoRef}
            controls
            autoPlay // Browser allows autoplay with sound ONLY if the user has interacted with the site before
            playsInline
            // muted={false} <-- Removed default mute
            style={{ width: "100%", height: "100%", borderRadius: "12px", backgroundColor: "black" }}
          >
            <source src={movie.link} type="video/mp4" />
            <source src={movie.link} type="video/x-matroska" />
          </video>
        </div>

        {/* Audio Track Switcher UI */}
        {audioTracks.length > 1 && (
          <div className="audio-controls" style={{ textAlign: "center", marginTop: "10px" }}>
            <p style={{ color: "white" }}>Select Language:</p>
            {audioTracks.map((track, index) => (
              <button 
                key={index} 
                onClick={() => switchTrack(index)}
                style={{
                  margin: "5px",
                  padding: "5px 15px",
                  backgroundColor: track.enabled ? "#e50914" : "#333",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer"
                }}
              >
                {track.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}