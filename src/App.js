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

  useEffect(() => {
    const hasSeenIntro = sessionStorage.getItem("introShown");

    if (!hasSeenIntro) {
      setShowIntro(true);
      sessionStorage.setItem("introShown", "true");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const getActive = () => {
    const path = location.pathname;

    if (path.includes("/movies")) return "MOVIES";
    if (path.includes("/series")) return "SERIES";
    if (path.includes("/anime")) return "ANIME";
    if (path.includes("/upload")) return "UPLOAD";
    if (path.includes("/edit")) return "EDIT";

    return "ALL";
  };

  const active = getActive();

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
      default:
        navigate("/");
    }
  };

  if (loading) return <Loader />;
  if (showIntro) return <IntroVideo onFinish={() => setShowIntro(false)} />;

  return (
    <div className="app">

      <div className="topbar">
        <button className="menu-btn" onClick={() => setOpen(!open)}>
          <FaBars />
        </button>

        <div className="logo-area">
          <img src={logo} className="logo-img" alt="logo" />
        </div>
      </div>

      <div className={`sidebar ${open ? "open" : ""}`}>
        <Sidebar
          active={active}
          setActive={handleSetActive}
          close={() => setOpen(false)}
        />
      </div>

      <div className={`content ${open ? "shift" : ""}`}>
        <Routes>
          <Route path="/" element={<Home type="all" />} />
          <Route path="/movies" element={<Home type="movie" />} />
          <Route path="/series" element={<Home type="series" />} />
          <Route path="/anime" element={<Home type="anime" />} />
          <Route path="/upload" element={<UploadMovie />} />
          <Route path="/edit" element={<EditMovies />} />
        </Routes>
      </div>

      {open && <div className="backdrop" onClick={() => setOpen(false)} />}

    </div>
  );
}

export default App;