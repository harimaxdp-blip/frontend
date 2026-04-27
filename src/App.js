import { useState } from "react";
import Sidebar from "./components/Sidebar";
import { FaBars } from "react-icons/fa";

import Movies from "./pages/Movies";
import Home from "./pages/Home";
import Tamil from "./pages/Tamil";
import Dubbed from "./pages/Dubbed";
import English from "./pages/English";

import "./App.css";

function App() {
  const [active, setActive] = useState("Home");
  const [open, setOpen] = useState(false);

  // ✅ SINGLE renderPage (FIXED)
  const renderPage = () => {
    switch (active) {
      case "Movies":
        return <Movies />;
      case "Tamil":
        return <Tamil />;
      case "Tamil Dubbed":
        return <Dubbed />;
      case "English":
        return <English />;
      default:
        return <Home />;
    }
  };

  return (
    <div>

      {/* TOP BAR */}
      <div className="topbar">
        <button className="menu-btn" onClick={() => setOpen(!open)}>
          <FaBars />
        </button>

        <h2 className="title">🎬 Movie Stream</h2>
      </div>

      {/* SIDEBAR */}
      <div className={`sidebar ${open ? "open" : ""}`}>
        <Sidebar
          active={active}
          setActive={setActive}
          close={() => setOpen(false)}
        />
      </div>

      {/* CONTENT */}
      <div className={`content ${open ? "shift" : ""}`}>
        {renderPage()}
      </div>

      {/* BACKDROP */}
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}

    </div>
  );
}

export default App;