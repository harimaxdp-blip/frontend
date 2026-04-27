import { FaHome, FaFilm, FaMicrophone, FaGlobe } from "react-icons/fa";
import "./Sidebar.css";

export default function Sidebar({ active, setActive, close }) {
  const menu = [
    { name: "Home", icon: <FaHome /> },
    { name: "Tamil", icon: <FaFilm /> },
    { name: "Tamil Dubbed", icon: <FaMicrophone /> },
    { name: "English", icon: <FaGlobe /> },
    { name: "Movies", icon: <FaFilm /> },
  ];

  const handleClick = (name) => {
    setActive(name);
    close();
  };

  return (
    <div className="sidebar-inner">
      <h2 className="logo">🎬 TV Stream</h2>

      {menu.map((item) => (
        <div
          key={item.name}
          className={`item ${active === item.name ? "active" : ""}`}
          onClick={() => handleClick(item.name)}
        >
          <span className="icon">{item.icon}</span>
          <span>{item.name}</span>
        </div>
      ))}
    </div>
  );
}