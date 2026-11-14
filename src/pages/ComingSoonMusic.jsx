import { useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./ComingSoonMusic.css";

// Animated waveform bars
const BAR_COUNT = 28;

// Floating music notes
const NOTE_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 24V10l14-3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="9" cy="24" r="3" fill="currentColor" opacity="0.8"/>
    <circle cx="23" cy="19" r="3" fill="currentColor" opacity="0.8"/>
  </svg>
);
const HEADPHONE_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 20v-4a10 10 0 0120 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <rect x="4" y="20" width="5" height="8" rx="2.5" fill="currentColor" opacity="0.7"/>
    <rect x="23" y="20" width="5" height="8" rx="2.5" fill="currentColor" opacity="0.7"/>
  </svg>
);
const VINYL_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
    <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
    <circle cx="16" cy="16" r="3" fill="currentColor" opacity="0.8"/>
  </svg>
);
const STAR_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 3l3.5 7 7.5 1-5.5 5.3 1.3 7.7L16 20.5 9.2 24 10.5 16.3 5 11l7.5-1z" fill="currentColor" opacity="0.7"/>
  </svg>
);

const FLOAT_ICONS = [NOTE_SVG, HEADPHONE_SVG, VINYL_SVG, STAR_SVG, NOTE_SVG, HEADPHONE_SVG];

const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  icon: FLOAT_ICONS[i % FLOAT_ICONS.length],
  size: 24 + Math.random() * 32,
  top: Math.random() * 100,
  left: Math.random() * 100,
  duration: 14 + Math.random() * 16,
  delay: -(Math.random() * 20),
  rotate: Math.random() * 360,
}));

export default function ComingSoonMusic() {
  const navigate = useNavigate();
  const waveRef  = useRef(null);

  // Animate waveform with canvas
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let frame, t = 0;

    function resize() {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      const bars   = BAR_COUNT;
      const gap    = 4;
      const bw     = (W - gap * (bars - 1)) / bars;
      const midY   = H / 2;

      for (let i = 0; i < bars; i++) {
        const phase  = (i / bars) * Math.PI * 2;
        const wave   = Math.sin(phase * 3 + t) * 0.5 + Math.sin(phase * 5 - t * 1.3) * 0.3 + Math.sin(phase + t * 0.7) * 0.2;
        const height = (0.15 + Math.abs(wave) * 0.75) * H;
        const x      = i * (bw + gap);

        // Gradient bar
        const grad = ctx.createLinearGradient(0, midY - height / 2, 0, midY + height / 2);
        grad.addColorStop(0, "rgba(251,146,60,0.9)");
        grad.addColorStop(0.5, "rgba(244,114,182,0.95)");
        grad.addColorStop(1, "rgba(251,146,60,0.9)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, midY - height / 2, bw, height, bw / 2);
        ctx.fill();
      }
      t += 0.06;
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="csm-root">
      {/* Ambient orbs */}
      <div className="csm-orb csm-orb--a" aria-hidden="true" />
      <div className="csm-orb csm-orb--b" aria-hidden="true" />
      <div className="csm-orb csm-orb--c" aria-hidden="true" />

      {/* Floating icons */}
      <div className="csm-floats" aria-hidden="true">
        {PARTICLES.map((p) => (
          <div
            key={p.id}
            className="csm-float"
            style={{
              width: p.size,
              height: p.size,
              top: `${p.top}%`,
              left: `${p.left}%`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          >
            {p.icon}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="csm-card">
        {/* Vinyl hero */}
        <div className="csm-vinyl-wrap" aria-hidden="true">
          <div className="csm-vinyl-disc">
            <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="csm-vinyl-svg">
              <defs>
                <radialGradient id="vinylGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%"   stopColor="#fb923c" stopOpacity="0.9"/>
                  <stop offset="30%"  stopColor="#f43f5e" stopOpacity="0.7"/>
                  <stop offset="60%"  stopColor="#a855f7" stopOpacity="0.5"/>
                  <stop offset="100%" stopColor="#1e0a3c" stopOpacity="0.8"/>
                </radialGradient>
              </defs>
              <circle cx="100" cy="100" r="96" fill="url(#vinylGrad)" stroke="rgba(251,146,60,0.3)" strokeWidth="1.5"/>
              {[80, 65, 50, 35].map((r, i) => (
                <circle key={i} cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
              ))}
              <circle cx="100" cy="100" r="16" fill="rgba(251,146,60,0.25)" stroke="rgba(251,146,60,0.6)" strokeWidth="2"/>
              <circle cx="100" cy="100" r="6" fill="#fb923c" opacity="0.9"/>
              {/* Shine */}
              <ellipse cx="75" cy="68" rx="18" ry="8" fill="white" opacity="0.05" transform="rotate(-30 75 68)"/>
            </svg>
            {/* Needle */}
            <div className="csm-needle" aria-hidden="true">
              <svg viewBox="0 0 30 90" fill="none" className="csm-needle-svg">
                <rect x="12" y="0" width="6" height="65" rx="3" fill="rgba(200,200,200,0.7)"/>
                <circle cx="15" cy="68" r="8" fill="none" stroke="rgba(251,146,60,0.8)" strokeWidth="2"/>
                <circle cx="15" cy="68" r="3" fill="rgba(251,146,60,0.9)"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Badge */}
        <div className="csm-badge">
          <span className="csm-badge-dot" />
          HM MUSIC
        </div>

        {/* Title */}
        <h1 className="csm-title">
          <span className="csm-title-line1">The Beat Drops</span>
          <span className="csm-title-line2">Coming Soon</span>
        </h1>

        <p className="csm-sub">
          Your personal stage is being built. Curated playlists, top charts, and non-stop vibes — dropping very soon.
        </p>

        {/* Waveform canvas */}
        <div className="csm-wave-wrap" aria-label="Music waveform animation">
          <canvas ref={waveRef} className="csm-wave-canvas" />
        </div>

        {/* Back button */}
        <button className="csm-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to Home
        </button>
      </div>

      {/* Bottom wave line */}
      <div className="csm-bottom-bar" aria-hidden="true">
        {Array.from({length: 40}).map((_,i) => (
          <span key={i} className="csm-bottom-cell" style={{animationDelay:`${(i * 0.07) % 1.8}s`}} />
        ))}
      </div>
    </div>
  );
}
