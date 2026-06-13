import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import BannerManager from "./components/Bannermanager";
import Sidebar from "./components/Sidebar";
import avatar11 from "./assets/avatars/11.png";
import avatar12 from "./assets/avatars/12.png";
import avatar13 from "./assets/avatars/13.png";
import avatar16 from "./assets/avatars/16.png";
import avatar18 from "./assets/avatars/18.png";
import avatar19 from "./assets/avatars/19.png";
import { App as CapacitorApp } from "@capacitor/app";
import Banner from "./pages/Banner";
import Home from "./pages/Home";
import UploadMovie from "./pages/UploadMovie";
import EditMovies from "./pages/EditMovies";
import MoviePlayer from "./pages/MoviePlayer";
import BottomNav from "./components/BottomNav";
import Loader from "./components/Loader";
import Login from "./pages/Login";
import Offline from "./pages/Offline";
import logo from "./assets/logo1.png";
import Games from "./pages/Games";
// ── swap these two imports to whatever images you want in the gear popup ──
import gearLink1Img from "./assets/gear-link1.png"; // YOUR IMAGE 1
import gearLink2Img from "./assets/gear-link2.png"; // YOUR IMAGE 2

import "./App.css";

const CATEGORY_PATHS = new Set(["/", "/movies", "/series", "/anime"]);

const avatars = [avatar13, avatar16, avatar18, avatar19, avatar11, avatar12];

// ── Gear popup link config — swap href and label to whatever pages you need ──
const GEAR_LINKS = [
  { img: gearLink1Img, label: "HM Games", desc: "Games For You", href: "/games" },
  { img: gearLink2Img, label: "HM Music", desc: "Music For You", href: "/" },
];
// ── Detect pointer type ──
function setupPointerMode() {
  const setMode = (mode) => document.documentElement.setAttribute("data-input", mode);
  window.addEventListener("touchstart", () => setMode("touch"), { passive: true, once: false });
  window.addEventListener("mousemove",  () => setMode("mouse"), { passive: true, once: false });
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Enter"," "].includes(e.key))
      setMode("key");
  }, { passive: true });
  setMode("mouse");
}
setupPointerMode();

// ─────────────────────────────────────────────────────────
// AvatarImg — shimmer skeleton for local & remote images
// ─────────────────────────────────────────────────────────
function AvatarImg({ src, alt, imgClassName, wrapClassName, minDelay = 500 }) {
  const [show, setShow] = useState(false);
  const timerRef  = useRef(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    setShow(false);
    loadedRef.current = false;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (loadedRef.current) setShow(true);
      else loadedRef.current = "timer-done";
    }, minDelay);
    return () => clearTimeout(timerRef.current);
  }, [src, minDelay]);

  const handleLoad = useCallback(() => {
    if (loadedRef.current === "timer-done") setShow(true);
    else loadedRef.current = true;
  }, []);

  return (
    <div className={`avatar-img-wrap ${wrapClassName}`}>
      <div className={`avatar-skeleton ${show ? "avatar-skeleton--hidden" : ""}`} />
      <img
        src={src}
        alt={alt}
        className={`${imgClassName} ${show ? "avatar-img--visible" : "avatar-img--hidden"}`}
        onLoad={handleLoad}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SearchIcon
// ─────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="search-icon-svg" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// HamburgerIcon
// ─────────────────────────────────────────────────────────
function HamburgerIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="menu-icon-svg" aria-hidden="true">
      <path
        d={open ? "M5 5L19 19M5 19L19 5" : "M3 6h18M3 12h18M3 18h18"}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: "d 0.3s ease" }}
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// GearIcon
// ─────────────────────────────────────────────────────────
function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="star-icon"
      aria-hidden="true"
    >
      <path
        d="M12 2.5L14.9 8.4L21.5 9.4L16.7 14.1L17.8 20.7L12 17.6L6.2 20.7L7.3 14.1L2.5 9.4L9.1 8.4L12 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// GearPopup — two image+link cards
// ─────────────────────────────────────────────────────────
function GearPopup({ onClose, onNavigate }) {
  return (
    <div className="gear-popup" role="dialog" aria-label="Quick links">
      <p className="gear-popup-title">Quick links</p>
      {GEAR_LINKS.map(({ img, label, desc, href }) => (
        <button
          key={href}
          className="gear-link"
          onClick={() => { onNavigate(href); onClose(); }}
        >
          <img src={img} alt="" className="gear-link-img" />
          <span className="gear-link-info">
            <span className="gear-link-name">{label}</span>
            <span className="gear-link-desc">{desc}</span>
          </span>
          <svg className="gear-link-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────
function App() {
  const [open,            setOpen]            = useState(false);
  const [loading,         setLoading]         = useState(true);
  const [user,            setUser]            = useState(null);
  const [showProfile,     setShowProfile]     = useState(false);
  const [showAvatarPicker,setShowAvatarPicker]= useState(false);
  const [showGear,        setShowGear]        = useState(false);
  const [avatarKey,       setAvatarKey]       = useState(0);
  const [isOnline,        setIsOnline]        = useState(navigator.onLine);

  const contentRef    = useRef(null);
  const profileRef    = useRef(null);
  const menuButtonRef = useRef(null);
  const gearRef       = useRef(null);
  const previousPathRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

  // ── Network ──
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Close profile popup on outside click ──
  useEffect(() => {
    if (!showProfile) return;
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setShowProfile(false);
        setShowAvatarPicker(false);
      }
    };
    document.addEventListener("touchstart", handler);
    document.addEventListener("mousedown",  handler);
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("mousedown",  handler);
    };
  }, [showProfile]);

  // ── Close gear popup on outside click ──
  useEffect(() => {
    if (!showGear) return;
    const handler = (e) => {
      if (gearRef.current && !gearRef.current.contains(e.target)) setShowGear(false);
    };
    document.addEventListener("touchstart", handler);
    document.addEventListener("mousedown",  handler);
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("mousedown",  handler);
    };
  }, [showGear]);

  // ── Loader ──
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(t);
  }, []);

  // ── Restore user ──
  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.avatar) {
        parsed.avatar = avatars[Math.floor(Math.random() * avatars.length)];
        localStorage.setItem("user", JSON.stringify(parsed));
      }
      setUser(parsed);
    } else {
      setUser(false);
    }
  }, []);

  // ── Capacitor deep link ──
  useEffect(() => {
    CapacitorApp.addListener("appUrlOpen", () => navigate("/"));
    return () => { CapacitorApp.removeAllListeners(); };
  }, [navigate]);

  // ── Active page ──
  const getActive = () => {
    const p = location.pathname;
    if (p.startsWith("/movies")) return "MOVIES";
    if (p.startsWith("/series")) return "SERIES";
    if (p.startsWith("/anime"))  return "ANIME";
    if (p.startsWith("/upload")) return "UPLOAD";
    if (p.startsWith("/edit"))   return "EDIT";
    if (p.startsWith("/player")) return "PLAYER";
    return "ALL";
  };

  const active       = getActive();
  const isPlayerPage = location.pathname.startsWith("/player");

  const focusFirstSidebarItem = useCallback(() => {
    requestAnimationFrame(() => {
      document.querySelector(".sidebar.open [data-sidebar-item]")?.focus({ preventScroll: true });
    });
  }, []);

  const handleMenuKeyDown = useCallback((e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); focusFirstSidebarItem(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); document.querySelector(".gear-btn")?.focus({ preventScroll: true }); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((next) => { if (!next) focusFirstSidebarItem(); return !next; });
    }
  }, [focusFirstSidebarItem]);

  useEffect(() => {
    if (!open || isPlayerPage) return;
    focusFirstSidebarItem();
  }, [focusFirstSidebarItem, isPlayerPage, open]);

  // ── Scroll to top on category switch ──
  useLayoutEffect(() => {
    const prev = previousPathRef.current;
    const curr = location.pathname;
    const isCategorySwitch = CATEGORY_PATHS.has(curr) && CATEGORY_PATHS.has(prev) && prev !== curr;
    const isInitialLoad    = prev === null && CATEGORY_PATHS.has(curr);
    if ((isInitialLoad || isCategorySwitch) && contentRef.current) {
      contentRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
      window.scrollTo(0, 0);
    }
    previousPathRef.current = curr;
  }, [location.pathname]);

  // ── Navigation ──
  const handleSetActive = (page) => {
    setOpen(false);
    const map = { MOVIES:"/movies", SERIES:"/series", ANIME:"/anime", UPLOAD:"/upload", EDIT:"/edit", PLAYER:"/player" };
    navigate(map[page] ?? "/");
  };

  if (loading || user === undefined) return <Loader />;
  if (!isOnline)                      return <Offline />;
  if (!user)                          return <Login />;

  const handleLogout = () => { localStorage.removeItem("user"); window.location.reload(); };
  const avatarSrc    = user?.avatar || user?.photoURL;

  return (
    <div className="app">

      {/* ========================= TOPBAR ========================= */}
      {!isPlayerPage && (
        <div className="topbar">

          {/* LEFT: hamburger + gear */}
          <div className="topbar-left">
            <button
              ref={menuButtonRef}
              className="menu-btn"
              data-menu-button
              aria-label="Open navigation menu"
              aria-expanded={open}
              onClick={() => setOpen((next) => { if (!next) focusFirstSidebarItem(); return !next; })}
              onKeyDown={handleMenuKeyDown}
            >
              <HamburgerIcon open={open} />
            </button>

            {/* ── Gear button ── */}
            <div className="gear-wrapper" ref={gearRef}>
              <button
                className="gear-btn"
                aria-label="Quick links"
                aria-expanded={showGear}
                onClick={() => setShowGear((s) => !s)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") { e.preventDefault(); menuButtonRef.current?.focus({ preventScroll: true }); }
                  if (e.key === "ArrowRight") { e.preventDefault(); document.querySelector(".search-btn")?.focus({ preventScroll: true }); }
                  if (e.key === "Escape") setShowGear(false);
                }}
              >
               <StarIcon />
              </button>

              {showGear && (
                <GearPopup
                  onClose={() => setShowGear(false)}
                  onNavigate={(href) => navigate(href)}
                />
              )}
            </div>
          </div>

          {/* CENTER: logo — absolutely centered so it ignores left/right widths */}
          <div className="topbar-center">
            <img src={logo} className="logo-img" alt="logo" />
          </div>

          {/* RIGHT: search + profile */}
          <div className="topbar-right">
            <button
              className="search-btn"
              aria-label="Search"
              onClick={() => {
                navigate("/");
                setTimeout(() => {
                  document.getElementById("search-input")?.focus();
                  document.getElementById("search-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 300);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft")  { e.preventDefault(); document.querySelector(".gear-btn")?.focus({ preventScroll: true }); }
                if (e.key === "ArrowDown")  { e.preventDefault(); document.querySelector("#search-input, [data-card-id]")?.focus({ preventScroll: false }); }
              }}
            >
              <SearchIcon />
            </button>

            <div className="profile-wrapper" ref={profileRef} onClick={(e) => e.stopPropagation()}>
              <button
                className="profile-btn"
                onClick={() => { const next = !showProfile; setShowProfile(next); if (!next) setShowAvatarPicker(false); }}
              >
                {avatarSrc ? (
                  <AvatarImg key={`topbar-${avatarKey}`} src={avatarSrc} alt="profile" imgClassName="profile-avatar" wrapClassName="avatar-img-wrap--sm" minDelay={500} />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" className="profile-icon-svg" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </button>

              {showProfile && (
                <div className="profile-popup">
                  <div className="profile-header">
                    <div className="profile-avatar-wrap" onClick={() => setShowAvatarPicker(!showAvatarPicker)}>
                      {avatarSrc && (
                        <AvatarImg key={`popup-${avatarKey}`} src={avatarSrc} alt="profile" imgClassName="profile-popup-avatar" wrapClassName="avatar-img-wrap--lg" minDelay={500} />
                      )}
                      <span className="avatar-edit-hint">{showAvatarPicker ? "▲ Hide" : "✎ Change"}</span>
                    </div>
                    <div className="profile-email">{user?.email}</div>
                  </div>

                  {showAvatarPicker && (
                    <div className="avatar-list">
                      {avatars.map((avatar, i) => (
                        <div
                          key={i}
                          className={`avatar-option-wrap ${user?.avatar === avatar ? "avatar-selected" : ""}`}
                          onClick={() => {
                            const updated = { ...user, avatar };
                            setUser(updated);
                            localStorage.setItem("user", JSON.stringify(updated));
                            setShowAvatarPicker(false);
                            setAvatarKey((k) => k + 1);
                          }}
                        >
                          <AvatarImg key={`grid-${i}`} src={avatar} alt="" imgClassName="avatar-option-img" wrapClassName="avatar-img-wrap--grid" minDelay={400} />
                        </div>
                      ))}
                    </div>
                  )}

                  <button className="logout-btn" onClick={handleLogout}>Logout</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================= SIDEBAR ========================= */}
      {!isPlayerPage && (
        <>
          <div className={`sidebar ${open ? "open" : ""}`}>
            <Sidebar active={active} setActive={handleSetActive} close={() => setOpen(false)} />
          </div>
          {open && <div className="backdrop" onClick={() => setOpen(false)} />}
        </>
      )}

      {/* ========================= CONTENT ========================= */}
      <div
        ref={contentRef}
        className={`content ${open && !isPlayerPage ? "shift" : ""} ${isPlayerPage ? "player-mode" : ""}`}
      >
        <Routes>
          <Route path="/"        element={<Home type="all" />} />
          <Route path="/games" element={<Games />} />
          <Route path="/banners" element={<BannerManager />} />
          <Route path="/movies"  element={<Home type="movie" />} />
          <Route path="/banner"  element={<Banner />} />
          <Route path="/series"  element={<Home type="series" />} />
          <Route path="/anime"   element={<Home type="anime" />} />
          <Route path="/upload"  element={<UploadMovie />} />
          <Route path="/edit"    element={<EditMovies />} />
          <Route path="/player"  element={<MoviePlayer />} />
          <Route path="*"        element={<Home type="all" />} />
        </Routes>
      </div>

      {!isPlayerPage && <BottomNav />}
    </div>
  );
}

export default App;