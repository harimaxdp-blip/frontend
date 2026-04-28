import { useState, useEffect } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import { FaBars } from "react-icons/fa";

import Home from "./pages/Home";
import UploadMovie from "./pages/UploadMovie";
import EditMovies from "./pages/EditMovies";
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

  // INTRO ONLY ON FIRST LOAD
  useEffect(() => {
    const hasSeenIntro = sessionStorage.getItem("introShown");

    if (!hasSeenIntro) {
      setShowIntro(true);
      sessionStorage.setItem("introShown", "true");
    }
  }, []);

  // LOADER
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // ACTIVE PAGE DETECT
  const getActive = () => {
    const path = location.pathname;

    if (path.startsWith("/movies")) return "MOVIES";
    if (path.startsWith("/series")) return "SERIES";
    if (path.startsWith("/anime")) return "ANIME";
    if (path.startsWith("/upload")) return "UPLOAD";
    if (path.startsWith("/edit")) return "EDIT";

    return "ALL";
  };

  const active = getActive();

  // NAVIGATION
  const handleSetActive = (page) => {
    setOpen(false);

    if (page === "MOVIES") navigate("/movies");
    else if (page === "SERIES") navigate("/series");
    else if (page === "ANIME") navigate("/anime");
    else if (page === "UPLOAD") navigate("/upload");
    else if (page === "EDIT") navigate("/edit");
    else navigate("/");
  };

  // LOADING
  if (loading) return <Loader />;

  // INTRO
  if (showIntro)
    return <IntroVideo onFinish={() => setShowIntro(false)} />;

  return (
    <div className="app">

      {/* TOP BAR */}
      <div className="topbar">
        <button className="menu-btn" onClick={() => setOpen(!open)}>
          <FaBars />
        </button>

        <div className="logo-area">
          <img src={logo} className="logo-img" alt="logo" />
        </div>
      </div>

      {/* SIDEBAR */}
      <div className={`sidebar ${open ? "open" : ""}`}>
        <Sidebar
          active={active}
          setActive={handleSetActive}
          close={() => setOpen(false)}
        />
      </div>

      {/* PAGES */}
      <div className={`content ${open ? "shift" : ""}`}>
        <Routes>
          <Route path="/" element={<Home type="all" />} />
          <Route path="/movies" element={<Home type="movie" />} />
          <Route path="/series" element={<Home type="series" />} />
          <Route path="/anime" element={<Home type="anime" />} />

          <Route path="/upload" element={<UploadMovie />} />
          <Route path="/edit" element={<EditMovies />} />

          {/* FIX FOR UNKNOWN ROUTES */}
          <Route path="*" element={<Home type="all" />} />
        </Routes>
      </div>

      {/* BACKDROP */}
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}

    </div>
  );
}

export default App;