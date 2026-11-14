
import {
  FaHome,
  FaFilm,
  FaTv,
  FaDragon,
  FaEdit,
  FaCloudUploadAlt,
} from "react-icons/fa";

import { useNavigate, useLocation } from "react-router-dom";
import "./BottomNav.css";

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { path: "/", icon: <FaHome />, label: "Home" },
    { path: "/movies", icon: <FaFilm />, label: "Movies" },
    { path: "/series", icon: <FaTv />, label: "Series" },
    { path: "/anime", icon: <FaDragon />, label: "Anime" },
    { path: "/upload", icon: <FaCloudUploadAlt />, label: "Upload" },
    { path: "/edit", icon: <FaEdit />, label: "Edit" },
  ];

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) =>
      tab.path === "/"
        ? location.pathname === "/"
        : location.pathname === tab.path ||
          location.pathname.startsWith(`${tab.path}/`)
    )
  );

  return (
    <div className="bottom-nav-wrapper">
      <div className="bottom-nav">
        <div
          className="nav-indicator"
          style={{
            width: `${100 / tabs.length}%`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        >
          {tabs[activeIndex].icon}
        </div>

        {tabs.map((tab, index) => (
          <button
            key={tab.path}
            type="button"
            aria-label={tab.label}
            title={tab.label}
            aria-current={activeIndex === index ? "page" : undefined}
            className={`nav-item ${
              activeIndex === index ? "active" : ""
            }`}
            onClick={() => navigate(tab.path)}
          >
            {tab.icon}
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
