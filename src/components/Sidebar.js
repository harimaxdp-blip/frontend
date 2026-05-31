import { FaHome, FaFilm, FaTv, FaDragon } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import "./Sidebar.css";

export default function Sidebar({ active, close }) {

  const navigate = useNavigate();
  const resetContentScroll = () => {
    const content = document.querySelector(".content");
    if (content) content.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  const menu = [
    { name: "ALL", icon: <FaHome />, path: "/" },
    { name: "MOVIES", icon: <FaFilm />, path: "/movies" },
    { name: "SERIES", icon: <FaTv />, path: "/series" },
    { name: "ANIME", icon: <FaDragon />, path: "/anime" },
  ];

  return (
    <div className="sidebar-inner">
      {menu.map((item) => (
        <div
          key={item.name}
          className={`item ${active === item.name ? "active" : ""}`}
          onClick={() => {
            resetContentScroll();
            navigate(item.path);
            requestAnimationFrame(resetContentScroll);
            close();
          }}
        >
          <span className="icon">{item.icon}</span>
          <span>{item.name}</span>
        </div>
      ))}
    </div>
  );
}
