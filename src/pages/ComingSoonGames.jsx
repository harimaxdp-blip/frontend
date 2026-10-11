import { useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./ComingSoonGames.css";

const BAR_COUNT = 28;

const CONTROLLER_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="10" width="24" height="14" rx="7" stroke="currentColor" strokeWidth="2" opacity="0.7"/>
    <circle cx="11" cy="17" r="2" fill="currentColor" opacity="0.6"/>
    <circle cx="21" cy="15" r="1.5" fill="currentColor" opacity="0.6"/>
    <circle cx="23" cy="17" r="1.5" fill="currentColor" opacity="0.6"/>
    <circle cx="21" cy="19" r="1.5" fill="currentColor" opacity="0.6"/>
    <circle cx="19" cy="17" r="1.5" fill="currentColor" opacity="0.6"/>
    <line x1="8" y1="15" x2="8" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
    <line x1="6" y1="17" x2="10" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
  </svg>
);

const SWORD_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 26L22 10M22 10L26 6L22 10ZM22 10L18 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
    <path d="M10 22L8 24L6 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
    <line x1="19" y1="7" x2="25" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
  </svg>
);

const STAR_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 3l3.5 7 7.5 1-5.5 5.3 1.3 7.7L16 20.5 9.2 24 10.5 16.3 5 11l7.5-1z" fill="currentColor" opacity="0.7"/>
  </svg>
);

const TROPHY_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 4h12v10a6 6 0 01-12 0V4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
    <path d="M10 8H6a4 4 0 004 4M22 8h4a4 4 0 01-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <path d="M16 20v5M11 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
  </svg>
);

const LIGHTNING_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 3L8 17h8l-2 12 14-16h-8L18 3z" fill="currentColor" opacity="0.7"/>
  </svg>
);

const PIXEL_SVG = (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4"  y="4"  width="6" height="6" fill="currentColor" opacity="0.8"/>
    <rect x="13" y="4"  width="6" height="6" fill="currentColor" opacity="0.5"/>
    <rect x="22" y="4"  width="6" height="6" fill="currentColor" opacity="0.8"/>
    <rect x="4"  y="13" width="6" height="6" fill="currentColor" opacity="0.5"/>
    <rect x="13" y="13" width="6" height="6" fill="currentColor" opacity="0.9"/>
    <rect x="22" y="13" width="6" height="6" fill="currentColor" opacity="0.5"/>
    <rect x="4"  y="22" width="6" height="6" fill="currentColor" opacity="0.8"/>
    <rect x="13" y="22" width="6" height="6" fill="currentColor" opacity="0.5"/>
    <rect x="22" y="22" width="6" height="6" fill="currentColor" opacity="0.8"/>
  </svg>
);

const FLOAT_ICONS = [CONTROLLER_SVG, SWORD_SVG, STAR_SVG, TROPHY_SVG, LIGHTNING_SVG, PIXEL_SVG];

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  icon: FLOAT_ICONS[i % FLOAT_ICONS.length],
  size: 22 + Math.random() * 30,
  top: Math.random() * 100,
  left: Math.random() * 100,
  duration: 13 + Math.random() * 18,
  delay: -(Math.random() * 22),
  rotate: Math.random() * 360,
}));

// Pixel art controller face — the hero graphic
function ControllerHero() {
  return (
    <div className="csg-controller-wrap" aria-hidden="true">
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="csg-controller-svg">
        <defs>
          <radialGradient id="ctrlGrad" cx="50%" cy="40%" r="60%">
            <stop offset="0%"   stopColor="#34d399" stopOpacity="0.9"/>
            <stop offset="40%"  stopColor="#06b6d4" stopOpacity="0.75"/>
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.4"/>
          </radialGradient>
          <radialGradient id="ctrlGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#34d399" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="transparent"/>
          </radialGradient>
        </defs>

        {/* Glow halo */}
        <ellipse cx="100" cy="70" rx="90" ry="58" fill="url(#ctrlGlow)"/>

        {/* Body */}
        <rect x="20" y="30" width="160" height="80" rx="40" fill="url(#ctrlGrad)" opacity="0.95"/>
        <rect x="20" y="30" width="160" height="80" rx="40" fill="none" stroke="rgba(52,211,153,0.5)" strokeWidth="1.5"/>

        {/* Left grip */}
        <rect x="22" y="78" width="44" height="38" rx="22" fill="url(#ctrlGrad)" opacity="0.85"/>
        <rect x="22" y="78" width="44" height="38" rx="22" fill="none" stroke="rgba(52,211,153,0.3)" strokeWidth="1"/>

        {/* Right grip */}
        <rect x="134" y="78" width="44" height="38" rx="22" fill="url(#ctrlGrad)" opacity="0.85"/>
        <rect x="134" y="78" width="44" height="38" rx="22" fill="none" stroke="rgba(52,211,153,0.3)" strokeWidth="1"/>

        {/* D-pad */}
        <rect x="46" y="62" width="8"  height="24" rx="3" fill="rgba(255,255,255,0.55)"/>
        <rect x="38" y="70" width="24" height="8"  rx="3" fill="rgba(255,255,255,0.55)"/>

        {/* ABXY buttons */}
        <circle cx="138" cy="58" r="6" fill="#f43f5e" opacity="0.9"/>
        <circle cx="150" cy="68" r="6" fill="#34d399" opacity="0.9"/>
        <circle cx="126" cy="68" r="6" fill="#6366f1" opacity="0.9"/>
        <circle cx="138" cy="78" r="6" fill="#fb923c" opacity="0.9"/>

        {/* Button letters */}
        <text x="138" y="62"  textAnchor="middle" fontSize="7" fill="white" fontWeight="700" opacity="0.9">Y</text>
        <text x="150" y="72"  textAnchor="middle" fontSize="7" fill="white" fontWeight="700" opacity="0.9">B</text>
        <text x="126" y="72"  textAnchor="middle" fontSize="7" fill="white" fontWeight="700" opacity="0.9">X</text>
        <text x="138" y="82"  textAnchor="middle" fontSize="7" fill="white" fontWeight="700" opacity="0.9">A</text>

        {/* Center buttons */}
        <rect x="86"  y="62" width="12" height="8" rx="4" fill="rgba(255,255,255,0.35)"/>
        <rect x="102" y="62" width="12" height="8" rx="4" fill="rgba(255,255,255,0.35)"/>

        {/* Joystick dots */}
        <circle cx="44"  cy="98" r="10" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
        <circle cx="44"  cy="98" r="4"  fill="rgba(255,255,255,0.5)"/>
        <circle cx="156" cy="98" r="10" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
        <circle cx="156" cy="98" r="4"  fill="rgba(255,255,255,0.5)"/>

        {/* Shine */}
        <ellipse cx="70" cy="42" rx="24" ry="8" fill="white" opacity="0.06" transform="rotate(-18 70 42)"/>
      </svg>

      {/* Scan-line overlay */}
      <div className="csg-scanlines" aria-hidden="true"/>
    </div>
  );
}

export default function ComingSoonGames() {
  const navigate = useNavigate();
  const waveRef  = useRef(null);

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

      const bars = BAR_COUNT;
      const gap  = 4;
      const bw   = (W - gap * (bars - 1)) / bars;
      const midY = H / 2;

      for (let i = 0; i < bars; i++) {
        // Stepped "pixel" height — quantise to 4 levels for retro feel
        const phase  = (i / bars) * Math.PI * 2;
        const raw    = Math.sin(phase * 3 + t) * 0.5 + Math.sin(phase * 5 - t * 1.4) * 0.3 + Math.sin(phase + t * 0.8) * 0.2;
        const steps  = 6;
        const height = (Math.round((0.15 + Math.abs(raw) * 0.75) * steps) / steps) * H;

        const x    = i * (bw + gap);
        const grad = ctx.createLinearGradient(0, midY - height / 2, 0, midY + height / 2);
        grad.addColorStop(0,   "rgba(52,211,153,0.95)");
        grad.addColorStop(0.5, "rgba(6,182,212,0.9)");
        grad.addColorStop(1,   "rgba(99,102,241,0.85)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        // Square tops for pixel look
        ctx.rect(x, midY - height / 2, bw, height);
        ctx.fill();
      }
      t += 0.055;
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="csg-root">
      {/* Ambient orbs */}
      <div className="csg-orb csg-orb--a" aria-hidden="true" />
      <div className="csg-orb csg-orb--b" aria-hidden="true" />
      <div className="csg-orb csg-orb--c" aria-hidden="true" />

      {/* Floating icons */}
      <div className="csg-floats" aria-hidden="true">
        {PARTICLES.map((p) => (
          <div
            key={p.id}
            className="csg-float"
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

      {/* Content card */}
      <div className="csg-card">

        {/* Controller hero */}
        <ControllerHero />

        {/* Badge */}
        <div className="csg-badge">
          <span className="csg-badge-dot" />
          HM GAMES
        </div>

        {/* Title */}
        <h1 className="csg-title">
          <span className="csg-title-line1">Game On</span>
          <span className="csg-title-line2">Coming Soon</span>
        </h1>

        <p className="csg-sub">
          Your gaming arena is loading. Epic titles, leaderboards, and multiplayer action — dropping very soon.
        </p>

        {/* Pixel bar canvas */}
        <div className="csg-wave-wrap" aria-label="Game loading animation">
          <canvas ref={waveRef} className="csg-wave-canvas" />
        </div>

        {/* Back button */}
        <button className="csg-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to Home
        </button>
      </div>

      {/* Bottom pixel bar */}
      <div className="csg-bottom-bar" aria-hidden="true">
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i} className="csg-bottom-cell" style={{ animationDelay: `${(i * 0.07) % 1.8}s` }} />
        ))}
      </div>
    </div>
  );
}
