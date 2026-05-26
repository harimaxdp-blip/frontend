import { FaHome, FaFilm, FaTv, FaDragon } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import "./Sidebar.css";

export default function Sidebar({ active, close }) {

  const navigate = useNavigate();

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
            window.scrollTo({ top: 0, behavior: "smooth" });
            navigate(item.path);
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