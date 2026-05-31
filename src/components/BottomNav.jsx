import { FaHome, FaFilm, FaTv, FaDragon } from "react-icons/fa";
import { useNavigate, useLocation } from "react-router-dom";
import "./BottomNav.css";

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { path: "/", icon: <FaHome /> },
    { path: "/movies", icon: <FaFilm /> },
    { path: "/series", icon: <FaTv /> },
    { path: "/anime", icon: <FaDragon /> },
  ];

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.path === location.pathname)
  );

  return (
    <div className="bottom-nav-wrapper">
      <div className="bottom-nav">

        <div
          className="nav-indicator"
style={{
  transform: `translateX(${activeIndex * 100}%) scale(1)`
}}
        >
          {tabs[activeIndex].icon}
        </div>

        {tabs.map((tab, index) => (
          <button
            key={tab.path}
            className={`nav-item ${
              activeIndex === index ? "active" : ""
            }`}
            onClick={() => navigate(tab.path)}
          >
            {tab.icon}
          </button>
        ))}
      </div>
    </div>
  );
}