import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import BannerManager from "./components/Bannermanager";
import Sidebar from "./components/Sidebar";
import avatar11 from "./assets/avatars/11.png";
import musicLogo from "./assets/music.png";
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
import "./App.css";

const CATEGORY_PATHS = new Set(["/", "/movies", "/series", "/anime"]);

const avatars = [avatar13, avatar16, avatar18, avatar19, avatar11, avatar12];

// ── Detect pointer type: touch = no focus ring, mouse/TV remote = show ring ──
// We set a data attribute on <html> so CSS can react globally.
function setupPointerMode() {
  const setMode = (mode) => document.documentElement.setAttribute("data-input", mode);
  window.addEventListener("touchstart", () => setMode("touch"), { passive: true, once: false });
  window.addEventListener("mousemove", () => setMode("mouse"), { passive: true, once: false });
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
  const timerRef = useRef(null);
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
// SearchIcon — custom SVG magnifier (cooler than FaSearch)
// ─────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="search-icon-svg" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// HamburgerIcon — clean 3-line icon
// ─────────────────────────────────────────────────────────
function HamburgerIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="menu-icon-svg" aria-hidden="true">
      <path d={open ? "M5 5L19 19M5 19L19 5" : "M3 6h18M3 12h18M3 18h18"}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: "d 0.3s ease" }}
      />
    </svg>
  );
}

function App() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef(null);
  const profileRef = useRef(null);
  const menuButtonRef = useRef(null);
  const previousPathRef = useRef(null);
  const [user, setUser] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [avatarKey, setAvatarKey] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // showMusicLogo: true = music logo, false = main logo
  const [showMusicLogo, setShowMusicLogo] = useState(false);
  // logoFlipping: true during the flip transition
  const [logoFlipping, setLogoFlipping] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  // ── Network listener ──
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Logo flip every 2s ──
  // Phase 1: flip out (0–300ms) → swap src → flip in (300–600ms)
  useEffect(() => {
    const interval = setInterval(() => {
      setLogoFlipping(true);
      setTimeout(() => {
        setShowMusicLogo((prev) => !prev);
        // flip-in class applied after src swap
        setTimeout(() => setLogoFlipping(false), 350);
      }, 300);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // ── Close profile popup on outside click ──
  useEffect(() => {
    if (!showProfile) return;
    const handleOutsideClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setShowProfile(false);
        setShowAvatarPicker(false);
      }
    };
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showProfile]);

  // ── Loader ──
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // ── Restore user from localStorage ──
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      if (!parsedUser.avatar) {
        parsedUser.avatar = avatars[Math.floor(Math.random() * avatars.length)];
        localStorage.setItem("user", JSON.stringify(parsedUser));
      }
      setUser(parsedUser);
    } else {
      setUser(false);
    }
  }, []);

  // ── Capacitor deep link ──
  useEffect(() => {
    const setupDeepLink = async () => {
      await CapacitorApp.addListener("appUrlOpen", (event) => {
        if (event.url) navigate("/");
      });
    };
    setupDeepLink();
    return () => { CapacitorApp.removeAllListeners(); };
  }, [navigate]);

  // ── Active page detection ──
  const getActive = () => {
    const path = location.pathname;
    if (path.startsWith("/movies")) return "MOVIES";
    if (path.startsWith("/series")) return "SERIES";
    if (path.startsWith("/anime"))  return "ANIME";
    if (path.startsWith("/upload")) return "UPLOAD";
    if (path.startsWith("/edit"))   return "EDIT";
    if (path.startsWith("/player")) return "PLAYER";
    return "ALL";
  };

  const active = getActive();
  const isPlayerPage = location.pathname.startsWith("/player");

  const focusFirstSidebarItem = useCallback(() => {
    requestAnimationFrame(() => {
      document.querySelector(".sidebar.open [data-sidebar-item]")?.focus({ preventScroll: true });
    });
  }, []);

  const handleMenuKeyDown = useCallback((e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      focusFirstSidebarItem();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      document.querySelector(".search-btn")?.focus({ preventScroll: true });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((nextOpen) => {
        const shouldOpen = !nextOpen;
        if (shouldOpen) focusFirstSidebarItem();
        return shouldOpen;
      });
    }
  }, [focusFirstSidebarItem]);

  useEffect(() => {
    if (!open || isPlayerPage) return;
    focusFirstSidebarItem();
  }, [focusFirstSidebarItem, isPlayerPage, open]);

  // ── Scroll to top on category switch ──
  useLayoutEffect(() => {
    const previousPath = previousPathRef.current;
    const currentPath = location.pathname;
    const isCategorySwitch =
      CATEGORY_PATHS.has(currentPath) &&
      CATEGORY_PATHS.has(previousPath) &&
      previousPath !== currentPath;
    const isInitialCategoryLoad =
      previousPath === null && CATEGORY_PATHS.has(currentPath);
    if ((isInitialCategoryLoad || isCategorySwitch) && contentRef.current) {
      contentRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
      window.scrollTo(0, 0);
    }
    previousPathRef.current = currentPath;
  }, [location.pathname]);

  // ── Navigation handler ──
  const handleSetActive = (page) => {
    setOpen(false);
    switch (page) {
      case "MOVIES":  navigate("/movies"); break;
      case "SERIES":  navigate("/series"); break;
      case "ANIME":   navigate("/anime");  break;
      case "UPLOAD":  navigate("/upload"); break;
      case "EDIT":    navigate("/edit");   break;
      case "PLAYER":  navigate("/player"); break;
      default:        navigate("/");
    }
  };

  if (loading)            return <Loader />;
  if (user === undefined) return <Loader />;
  if (!isOnline)          return <Offline />;
  if (!user)              return <Login />;

  const handleLogout = () => {
    localStorage.removeItem("user");
    window.location.reload();
  };

  const avatarSrc = user?.avatar || user?.photoURL;

  // logo class: flip-out → src swap → flip-in
  const logoClass = [
    "logo-img",
    logoFlipping ? "logo-flip-out" : "logo-flip-in",
    showMusicLogo ? "music-logo" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="app">
      {/* ========================= TOPBAR ========================= */}
      {!isPlayerPage && (
        <div className="topbar">
          <div className="topbar-left">
            <button
              ref={menuButtonRef}
              className="menu-btn"
              data-menu-button
              aria-label="Open navigation menu"
              aria-expanded={open}
              onClick={() => {
                setOpen((nextOpen) => {
                  const shouldOpen = !nextOpen;
                  if (shouldOpen) focusFirstSidebarItem();
                  return shouldOpen;
                });
              }}
              onKeyDown={handleMenuKeyDown}
            >
              <HamburgerIcon open={open} />
            </button>
          </div>

          <div className="topbar-center">
            <img
              src={showMusicLogo ? musicLogo : logo}
              className={logoClass}
              alt="logo"
            />
          </div>

          <div className="topbar-right">
            <button
              className="search-btn"
              aria-label="Search"
              onClick={() => {
                navigate("/");
                setTimeout(() => {
                  document.getElementById("search-input")?.focus();
                  document.getElementById("search-section")?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }, 300);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  menuButtonRef.current?.focus({ preventScroll: true });
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  document.querySelector("#search-input, [data-card-id]")?.focus({ preventScroll: false });
                }
              }}
            >
              <SearchIcon />
            </button>

            <div
              className="profile-wrapper"
              ref={profileRef}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="profile-btn"
                onClick={() => {
                  const next = !showProfile;
                  setShowProfile(next);
                  if (!next) setShowAvatarPicker(false);
                }}
              >
                {avatarSrc ? (
                  <AvatarImg
                    key={`topbar-${avatarKey}`}
                    src={avatarSrc}
                    alt="profile"
                    imgClassName="profile-avatar"
                    wrapClassName="avatar-img-wrap--sm"
                    minDelay={500}
                  />
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
                    <div
                      className="profile-avatar-wrap"
                      onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                    >
                      {avatarSrc && (
                        <AvatarImg
                          key={`popup-${avatarKey}`}
                          src={avatarSrc}
                          alt="profile"
                          imgClassName="profile-popup-avatar"
                          wrapClassName="avatar-img-wrap--lg"
                          minDelay={500}
                        />
                      )}
                      <span className="avatar-edit-hint">
                        {showAvatarPicker ? "▲ Hide" : "✎ Change"}
                      </span>
                    </div>
                    <div className="profile-email">{user?.email}</div>
                  </div>

                  {showAvatarPicker && (
                    <div className="avatar-list">
                      {avatars.map((avatar, index) => (
                        <div
                          key={index}
                          className={`avatar-option-wrap ${user?.avatar === avatar ? "avatar-selected" : ""}`}
                          onClick={() => {
                            const updatedUser = { ...user, avatar };
                            setUser(updatedUser);
                            localStorage.setItem("user", JSON.stringify(updatedUser));
                            setShowAvatarPicker(false);
                            setAvatarKey((k) => k + 1);
                          }}
                        >
                          <AvatarImg
                            key={`grid-${index}`}
                            src={avatar}
                            alt=""
                            imgClassName="avatar-option-img"
                            wrapClassName="avatar-img-wrap--grid"
                            minDelay={400}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <button className="logout-btn" onClick={handleLogout}>
                    Logout
                  </button>
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