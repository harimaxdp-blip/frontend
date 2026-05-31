import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import BannerManager from "./components/Bannermanager";
import Sidebar from "./components/Sidebar";
import { FaBars, FaSearch } from "react-icons/fa";

import { App as CapacitorApp } from "@capacitor/app";
import Banner from "./pages/Banner";
import Home from "./pages/Home";
import UploadMovie from "./pages/UploadMovie";
import EditMovies from "./pages/EditMovies";
import MoviePlayer from "./pages/MoviePlayer"; // NEW PLAYER PAGE
import BottomNav from "./components/BottomNav";
import Loader from "./components/Loader";
import Login from "./pages/Login";
import logo from "./assets/logo1.png";
import "./App.css";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
const CATEGORY_PATHS = new Set(["/", "/movies", "/series", "/anime"]);

function App() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef(null);
  const previousPathRef = useRef(null);
const [user, setUser] = useState(undefined);
  const location = useLocation();
  const navigate = useNavigate();


  // =========================
  // LOADER
  // =========================
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
    console.log("🔥 APP USER:", currentUser);
    setUser(currentUser);
  });

  return () => unsubscribe();
}, []);
  useEffect(() => {
  const setupDeepLink = async () => {
    await CapacitorApp.addListener("appUrlOpen", (event) => {
      console.log("🔥 Deep Link Opened:", event.url);

      if (event.url) {
        navigate("/");
      }
    });
  };

  setupDeepLink();

  return () => {
    CapacitorApp.removeAllListeners();
  };
}, [navigate]);
  // =========================
  // ACTIVE PAGE DETECTION
  // =========================
  const getActive = () => {
    const path = location.pathname;

    if (path.startsWith("/movies")) return "MOVIES";
    if (path.startsWith("/series")) return "SERIES";
    if (path.startsWith("/anime")) return "ANIME";
    if (path.startsWith("/upload")) return "UPLOAD";
    if (path.startsWith("/edit")) return "EDIT";
    if (path.startsWith("/player")) return "PLAYER";

    return "ALL";
  };

  const active = getActive();

  useLayoutEffect(() => {
    const previousPath = previousPathRef.current;
    const currentPath = location.pathname;
    const isCategorySwitch =
      CATEGORY_PATHS.has(currentPath) &&
      CATEGORY_PATHS.has(previousPath) &&
      previousPath !== currentPath;
    const isInitialCategoryLoad = previousPath === null && CATEGORY_PATHS.has(currentPath);

    if ((isInitialCategoryLoad || isCategorySwitch) && contentRef.current) {
      contentRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
      window.scrollTo(0, 0);
    }
    previousPathRef.current = currentPath;
  }, [location.pathname]);

  // =========================
  // NAVIGATION
  // =========================
  const handleSetActive = (page) => {
    setOpen(false);

    switch (page) {
      case "MOVIES":
        navigate("/movies");
        break;

      case "SERIES":
        navigate("/series");
        break;

      case "ANIME":
        navigate("/anime");
        break;

      case "UPLOAD":
        navigate("/upload");
        break;

      case "EDIT":
        navigate("/edit");
        break;

      case "PLAYER":
        navigate("/player");
        break;

      default:
        navigate("/");
    }
  };

  // =========================
  // HIDE SIDEBAR/TOPBAR ON PLAYER PAGE
  // =========================
  const isPlayerPage = location.pathname.startsWith("/player");

  // =========================
  // LOADING SCREEN
  // =========================
  if (loading) {
    return <Loader />;
  }
if (user === undefined) {
  return <Loader />;
}

if (!user) {
  return <Login />;
}
  // (Intro video removed)

  return (
    <div className="app">
      {/* =========================
          TOPBAR (HIDDEN ON PLAYER)
      ========================= */}
      {!isPlayerPage && (
<div className="topbar">
  <button
    className="menu-btn"
    onClick={() => setOpen(!open)}
  >
    <FaBars />
  </button>

  <div className="logo-area">
    <img
      src={logo}
      className="logo-img"
      alt="logo"
    />
  </div>

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
</div>
      )}

      {/* =========================
          SIDEBAR (HIDDEN ON PLAYER)
      ========================= */}
      {!isPlayerPage && (
        <>
          <div className={`sidebar ${open ? "open" : ""}`}>
            <Sidebar
              active={active}
              setActive={handleSetActive}
              close={() => setOpen(false)}
            />
          </div>

          {/* BACKDROP */}
          {open && (
            <div
              className="backdrop"
              onClick={() => setOpen(false)}
            />
          )}
        </>
      )}

      {/* =========================
          PAGE CONTENT
      ========================= */}
      <div
        ref={contentRef}
        className={`content ${
          open && !isPlayerPage ? "shift" : ""
        } ${isPlayerPage ? "player-mode" : ""}`}
      >
        <Routes>
          {/* HOME */}
          <Route
            path="/"
            element={<Home type="all" />}
          />
<Route path="/banners" element={<BannerManager />} />
          {/* CATEGORY PAGES */}
          <Route
            path="/movies"
            element={<Home type="movie" />}
          />
<Route path="/banner" element={<Banner />} />
          <Route
            path="/series"
            element={<Home type="series" />}
          />

          <Route
            path="/anime"
            element={<Home type="anime" />}
          />

          {/* ADMIN */}
          <Route
            path="/upload"
            element={<UploadMovie />}
          />

          <Route
            path="/edit"
            element={<EditMovies />}
          />

          {/* FULL PAGE VIDEO PLAYER */}
          <Route
            path="/player"
            element={<MoviePlayer />}
          />

          {/* UNKNOWN ROUTES */}
          <Route
            path="*"
            element={<Home type="all" />}
          />
        </Routes>
      </div>
      {!isPlayerPage && <BottomNav />}
    </div>
  );
}

export default App;
