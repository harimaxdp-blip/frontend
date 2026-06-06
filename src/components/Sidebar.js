import { useCallback } from "react";
import { FaHome, FaFilm, FaTv, FaDragon } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import "./Sidebar.css";

export default function Sidebar({ active, close }) {

  const navigate = useNavigate();
  const resetContentScroll = useCallback(() => {
    const content = document.querySelector(".content");
    if (content) content.scrollTop = 0;
    window.scrollTo(0, 0);
  }, []);

  const menu = [
    { name: "ALL", icon: <FaHome />, path: "/" },
    { name: "MOVIES", icon: <FaFilm />, path: "/movies" },
    { name: "SERIES", icon: <FaTv />, path: "/series" },
    { name: "ANIME", icon: <FaDragon />, path: "/anime" },
  ];

  const focusFirstCard = useCallback(() => {
    requestAnimationFrame(() => {
      const firstCard = document.querySelector("[data-card-id]");
      if (firstCard) firstCard.focus({ preventScroll: false });
    });
  }, []);

  const activateItem = useCallback((item) => {
    resetContentScroll();
    navigate(item.path);
    requestAnimationFrame(resetContentScroll);
    close();
  }, [close, navigate, resetContentScroll]);

  const handleItemKeyDown = useCallback((e, item, index) => {
    const items = Array.from(e.currentTarget.closest(".sidebar-inner")?.querySelectorAll("[data-sidebar-item]") || []);

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (index + delta + items.length) % items.length;
      items[nextIndex]?.focus({ preventScroll: true });
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      close();
      focusFirstCard();
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      document.querySelector("[data-menu-button]")?.focus({ preventScroll: true });
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activateItem(item);
    }
  }, [activateItem, close, focusFirstCard]);

  return (
    <div className="sidebar-inner">
      {menu.map((item, index) => (
        <button
          key={item.name}
          type="button"
          className={`item ${active === item.name ? "active" : ""}`}
          data-sidebar-item
          onClick={() => activateItem(item)}
          onKeyDown={(e) => handleItemKeyDown(e, item, index)}
        >
          <span className="icon">{item.icon}</span>
          <span>{item.name}</span>
        </button>
      ))}
    </div>
  );
}
