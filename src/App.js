import { useState, useEffect } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import { FaBars } from "react-icons/fa";

import Home from "./pages/Home";
import UploadMovie from "./pages/UploadMovie";
import EditMovies from "./pages/EditMovies";
import MoviePlayer from "./pages/MoviePlayer"; // NEW PLAYER PAGE

import IntroVideo from "./components/IntroVideo";
import Loader from "./components/Loader";

import logo from "./assets/logo1.png";
import "./App.css";

function App() {
  const [open, setOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [loading, setLoading] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();

  // =========================
  // INTRO ONLY ON FIRST LOAD
  // =========================
  useEffect(() => {
    const hasSeenIntro = sessionStorage.getItem("introShown");

    if (!hasSeenIntro) {
      setShowIntro(true);
      sessionStorage.setItem("introShown", "true");
    }
  }, []);

  // =========================
  // LOADER
  // =========================
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

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

  // =========================
  // INTRO VIDEO
  // =========================
  if (showIntro) {
    return <IntroVideo onFinish={() => setShowIntro(false)} />;
  }

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

          {/* CATEGORY PAGES */}
          <Route
            path="/movies"
            element={<Home type="movie" />}
          />

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
    </div>
  );
}

export default App;