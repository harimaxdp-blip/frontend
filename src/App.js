import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import BannerManager from "./components/Bannermanager";
import Sidebar from "./components/Sidebar";
import { FaBars, FaSearch, FaUserCircle } from "react-icons/fa";
import avatar11 from "./assets/avatars/11.png";
import avatar12 from "./assets/avatars/12.png";
import avatar13 from "./assets/avatars/13.png";
import avatar14 from "./assets/avatars/14.png";
import avatar15 from "./assets/avatars/15.png";
import avatar16 from "./assets/avatars/16.png";
import avatar17 from "./assets/avatars/17.png";
import avatar18 from "./assets/avatars/18.png";
import avatar19 from "./assets/avatars/19.png";
import avatar20 from "./assets/avatars/20.png";
import avatar21 from "./assets/avatars/21.png";
import avatar22 from "./assets/avatars/22.png";
import avatar23 from "./assets/avatars/23.png";
import { App as CapacitorApp } from "@capacitor/app";
import Banner from "./pages/Banner";
import Home from "./pages/Home";
import UploadMovie from "./pages/UploadMovie";
import EditMovies from "./pages/EditMovies";
import MoviePlayer from "./pages/MoviePlayer";
import BottomNav from "./components/BottomNav";
import Loader from "./components/Loader";
import Login from "./pages/Login";
import logo from "./assets/logo1.png";
import "./App.css";

const CATEGORY_PATHS = new Set(["/", "/movies", "/series", "/anime"]);

// Moved outside component — fixes ESLint missing-dependency warning
const avatars = [
  avatar11, avatar12, avatar13, avatar14, avatar15, avatar16, avatar17,
  avatar18, avatar19, avatar20, avatar21, avatar22, avatar23,
];

function App() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef(null);
  const profileRef = useRef(null);
  const previousPathRef = useRef(null);
  const [user, setUser] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  // Close profile popup when clicking / touching anywhere outside
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

  // LOADER
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

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

  useEffect(() => {
    const setupDeepLink = async () => {
      await CapacitorApp.addListener("appUrlOpen", (event) => {
        console.log("Deep Link Opened:", event.url);
        if (event.url) navigate("/");
      });
    };
    setupDeepLink();
    return () => { CapacitorApp.removeAllListeners(); };
  }, [navigate]);

  // ACTIVE PAGE DETECTION
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

  useLayoutEffect(() => {
    const previousPath = previousPathRef.current;
    const currentPath  = location.pathname;
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

  // NAVIGATION
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

  const isPlayerPage = location.pathname.startsWith("/player");

  if (loading)          return <Loader />;
  if (user === undefined) return <Loader />;
  if (!user)            return <Login />;

  const handleLogout = () => {
    localStorage.removeItem("user");
    window.location.reload();
  };

  return (
    <div className="app">
      {/* ========================= TOPBAR ========================= */}
      {!isPlayerPage && (
        <div className="topbar">
          {/* LEFT — hamburger (desktop only) */}
          <div className="topbar-left">
            <button className="menu-btn" onClick={() => setOpen(!open)}>
              <FaBars />
            </button>
          </div>

          {/* CENTER — logo, always truly centered */}
          <div className="topbar-center">
            <img src={logo} className="logo-img" alt="logo" />
          </div>

          {/* RIGHT — search + profile */}
          <div className="topbar-right">
            <button
              className="search-btn"
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
            >
              <FaSearch />
            </button>

            {/* Profile — stopPropagation so outside-click handler doesn't fire on the button itself */}
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
                {user?.avatar || user?.photoURL ? (
                  <img
                    src={user?.avatar || user?.photoURL}
                    alt="profile"
                    className="profile-avatar"
                  />
                ) : (
                  <FaUserCircle />
                )}
              </button>

              {showProfile && (
                <div className="profile-popup">
                  <div className="profile-header">
                    {/* Click avatar image to toggle avatar picker */}
                    <div
                      className="profile-avatar-wrap"
                      onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                    >
                      <img
                        src={user?.avatar || user?.photoURL}
                        alt="profile"
                        className="profile-popup-avatar"
                      />
                      <span className="avatar-edit-hint">
                        {showAvatarPicker ? "▲ Hide" : "✎ Change"}
                      </span>
                    </div>
                    <div className="profile-email">{user?.email}</div>
                  </div>

                  {/* Avatar grid — only when picker is open */}
                  {showAvatarPicker && (
                    <div className="avatar-list">
                      {avatars.map((avatar, index) => (
                        <img
                          key={index}
                          src={avatar}
                          alt=""
                          className={`avatar-option ${user?.avatar === avatar ? "avatar-selected" : ""}`}
                          onClick={() => {
                            const updatedUser = { ...user, avatar };
                            setUser(updatedUser);
                            localStorage.setItem("user", JSON.stringify(updatedUser));
                            setShowAvatarPicker(false);
                          }}
                        />
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
