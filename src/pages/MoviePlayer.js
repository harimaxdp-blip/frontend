import React, { useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import DeviceControl from "../plugins/deviceControl";

export default function MoviePlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const movie        = location.state?.movie;
  const playlist     = location.state?.playlist     ?? null;
  const startIndex   = location.state?.currentIndex ?? 0;

  const handleGoBack = useCallback(() => {
    try {
      window.history.length > 1
        ? navigate(-1)
        : navigate("/", { replace: true });
    } catch {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const isSeries       = Array.isArray(playlist) && playlist.length > 1;
    const currentEpisode = isSeries ? playlist[startIndex] : movie;
    const url            = currentEpisode?.link;

    if (!url) {
      // No URL — go back immediately
      handleGoBack();
      return;
    }

    // Open ExoPlayer directly — no React player at all
    DeviceControl.openExoPlayer({ url, title: currentEpisode?.title || "" })
      .then(() => {
        // After ExoPlayer closes, go back to home
        handleGoBack();
      })
      .catch((err) => {
        console.error("ExoPlayer failed:", err);
        handleGoBack();
      });
  }, []); // eslint-disable-line

  // Render nothing — just a black screen while ExoPlayer launches
  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      background: "#000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        width: 48,
        height: 48,
        border: "4px solid #ffffff33",
        borderTop: "4px solid #fff",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}