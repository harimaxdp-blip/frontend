import { useState, useRef } from "react";
import "./Offline.css";

export default function Offline() {
  const [status, setStatus] = useState("idle"); // idle | checking | success | failed
  const [attempts, setAttempts] = useState(0);
  const hasHistory = window.history.length > 1;
  const retryBtnRef = useRef(null);

  const handleRetry = async () => {
    if (status === "checking") return;
    setStatus("checking");
    setAttempts((a) => a + 1);

    // Wait a moment so spinner is visible
    await new Promise((r) => setTimeout(r, 1200));

    if (navigator.onLine) {
      setStatus("success");
      await new Promise((r) => setTimeout(r, 600));
      window.location.reload();
    } else {
      setStatus("failed");
      // Shake the button
      retryBtnRef.current?.classList.add("offline-shake");
      setTimeout(() => retryBtnRef.current?.classList.remove("offline-shake"), 400);
      // Reset to idle after showing error briefly
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const handleGoBack = () => {
    window.history.back();
  };

  const btnLabel = () => {
    if (status === "checking") return "Checking...";
    if (status === "success")  return "Connected!";
    if (status === "failed")   return "Still offline";
    return "Try Again";
  };

  const btnStyle = () => {
    if (status === "success") return "offline-btn offline-btn--success";
    if (status === "failed")  return "offline-btn offline-btn--failed";
    return "offline-btn";
  };

  return (
    <div className="offline-root">
      {/* Scanline overlay */}
      <div className="offline-scanline" />
      <div className="offline-grain" />

      {/* Header bar */}
      <div className="offline-topbar">
        <div className="offline-topbar-line" />
        <span className="offline-topbar-brand">HARIMOVIES</span>
        <div className="offline-topbar-line" />
        <div className="offline-topbar-dot" />
      </div>

      {/* Main content */}
      <div className="offline-body">
        {/* Animated wifi icon */}
        <div className="offline-icon-wrap">
          <svg
            className="offline-wifi-svg"
            width="90"
            height="90"
            viewBox="0 0 80 80"
            fill="none"
          >
            <circle cx="40" cy="40" r="38" fill="#111" stroke="#222" strokeWidth="1" />
            <line
              x1="20" y1="20" x2="60" y2="60"
              stroke="#e50914" strokeWidth="2.5" strokeLinecap="round"
            />
            <path
              d="M18 34 C24 26 32 22 40 22 C48 22 56 26 62 34"
              stroke="#2a2a2a" strokeWidth="2.5" strokeLinecap="round" fill="none"
            />
            <path
              d="M25 42 C29 36 34 33 40 33 C46 33 51 36 55 42"
              stroke="#2a2a2a" strokeWidth="2.5" strokeLinecap="round" fill="none"
            />
            <path
              d="M32 50 C35 46 37 44 40 44 C43 44 45 46 48 50"
              stroke="#333" strokeWidth="2.5" strokeLinecap="round" fill="none"
            />
            <circle cx="40" cy="57" r="3" fill="#333" />
          </svg>
        </div>

        {/* Error code badge */}
        <div className="offline-code-badge">
          <span>ERR_INTERNET_DISCONNECTED</span>
        </div>

        <h1 className="offline-title">You're offline</h1>
        <p className="offline-subtitle">
          Can't reach the server right now.
          <br />
          Check your connection and try again.
        </p>

        {/* Status indicator */}
        <div className="offline-status-row">
          <div className="offline-status-dot" />
          <span className="offline-status-text">No internet connection</span>
        </div>

        {/* Still offline error message */}
        {status === "failed" && (
          <div className="offline-error-msg">
            Still no connection. Please check your Wi-Fi or mobile data.
          </div>
        )}

        {/* Attempt counter */}
        {attempts > 0 && status === "idle" && (
          <p className="offline-attempts">
            Retried {attempts} {attempts === 1 ? "time" : "times"}
          </p>
        )}

        {/* Pulse dots */}
        <div className="offline-dots">
          <span className="offline-dot" />
          <span className="offline-dot" />
          <span className="offline-dot" />
        </div>

        {/* Retry button */}
        <button
          ref={retryBtnRef}
          className={btnStyle()}
          onClick={handleRetry}
          disabled={status === "checking" || status === "success"}
        >
          {status === "checking" ? (
            <svg
              className="offline-spinner"
              width="16" height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : status === "success" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="16" height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          )}
          {btnLabel()}
        </button>

        {/* Go back — only if history exists */}
        {hasHistory && (
          <button className="offline-back-btn" onClick={handleGoBack}>
            Go Back
          </button>
        )}
      </div>
    </div>
  );
}