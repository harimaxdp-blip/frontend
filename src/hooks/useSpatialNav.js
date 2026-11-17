// src/hooks/useSpatialNav.js
import { useEffect, useCallback } from "react";

const FOCUSABLE_SELECTOR = [
  "[data-card-id]",
  ".card",
  ".episode-card",
  ".season-card-v2",
  ".rw-hcard",
  ".rw-hcard-delete",
  ".fp-pill",
  ".fp-tab",
  ".fp-trigger",
  ".fp-sheet-close",
  ".fp-btn-reset",
  ".fp-btn-apply",
  ".menu-btn",
  ".gear-btn",
  ".search-btn",
  ".profile-btn",
  ".mic-btn",
  ".season-continue-pill",
  ".continue-play-btn",
  ".hero-play-btn",
  ".hero-nav",
  ".hero-dot",
  ".view-all-btn",
  ".back-btn",
  ".csg-back-btn",
  ".csm-back-btn",
  "[data-sidebar-item]",
  "[data-menu-button]",
  "#search-input",
  ".nav-item",
  ".gear-link",
  ".profile-popup button",
  ".avatar-option-wrap",
  ".logout-btn",
  ".bm-btn",
  ".bm-input",
  ".bm-select",
  ".editor-input",
  ".editor-select",
  ".delete-btn",
  ".edit-btn",
  ".confirm-btn",
  ".cancel-btn",
  ".close-btn",
  "button:not([disabled]):not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "a[href]:not([tabindex='-1'])",
  "[role='button']:not([tabindex='-1'])",
  "[tabindex='0']:not([tabindex='-1'])"
].join(", ");

const KEY_TO_DIRECTION = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function center(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function isDirectionalCandidate(direction, current, candidate) {
  const cur = center(current);
  const next = center(candidate);
  if (direction === "left")  return next.x < cur.x - 2 || candidate.right <= current.left + 5;
  if (direction === "right") return next.x > cur.x + 2 || candidate.left >= current.right - 5;
  if (direction === "up")    return next.y < cur.y - 2 || candidate.bottom <= current.top + 5;
  return next.y > cur.y + 2 || candidate.top >= current.bottom - 5;
}

function directionalScore(direction, current, candidate) {
  const cur = center(current);
  const next = center(candidate);
  const dx = next.x - cur.x;
  const dy = next.y - cur.y;
  const primary   = (direction === "left" || direction === "right") ? Math.abs(dx) : Math.abs(dy);
  const secondary = (direction === "left" || direction === "right") ? Math.abs(dy) : Math.abs(dx);

  const verticalOverlap   = Math.min(current.bottom, candidate.bottom) - Math.max(current.top, candidate.top);
  const horizontalOverlap = Math.min(current.right, candidate.right)   - Math.max(current.left, candidate.left);
  const hasRowOverlap     = verticalOverlap > 0;
  const hasColumnOverlap  = horizontalOverlap > 0;
  const aligned           = (direction === "left" || direction === "right") ? hasRowOverlap : hasColumnOverlap;

  return primary + secondary * (aligned ? 0.75 : 2.5);
}

export function focusElement(el, preventScroll = false) {
  if (!el) return false;
  if (!el.hasAttribute("tabindex") && el.tagName !== "BUTTON" && el.tagName !== "INPUT" && el.tagName !== "A" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA") {
    el.setAttribute("tabindex", "0");
  }
  try {
    el.focus({ preventScroll });
  } catch {
    el.focus?.();
  }
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  } catch {
    el.scrollIntoView?.();
  }
  return true;
}

function isVisible(el) {
  if (!el || el.disabled || el.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getActiveScope() {
  const openModal = document.querySelector(".filter-popup.open, .fp-sheet, .profile-popup, .gear-popup, .sidebar.open, .modal-overlay, .confirm-modal, .edit-dialog, .dialog-overlay, [role='dialog']");
  if (openModal) return openModal;
  return document.body;
}

export function useSpatialNav() {
  const handleKeyDown = useCallback((e) => {
    const { key } = e;
    const isPlayerActive = Boolean(document.querySelector(".global-player, .movie-player-container, .player-mode"));

    // Activate TV mode & key input mode immediately on any arrow or enter press
    if (KEY_TO_DIRECTION[key] || key === "Enter" || key === " ") {
      document.documentElement.setAttribute("data-input", "key");
      if (!document.body.classList.contains("tv-mode")) {
        document.body.classList.add("tv-mode");
      }
    }

    // Handle Enter / OK key on custom focusable non-button elements (e.g. div cards, pills, avatars)
    if ((key === "Enter" || key === " ") && document.activeElement && !isPlayerActive) {
      const activeEl = document.activeElement;
      const isFormInput = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(activeEl.tagName);
      if (!isFormInput && isVisible(activeEl)) {
        e.preventDefault();
        activeEl.click();
        return;
      }
    }

    const direction = KEY_TO_DIRECTION[key];
    if (!direction) return;

    // If player is active, let player handle its controls unless focus is already on an active element
    if (isPlayerActive && !document.querySelector(".global-player .gp-settings-pop, .global-player .gp-ep-drawer")) {
      return;
    }

    const scope = getActiveScope();
    const isModalScope = scope !== document.body;
    let candidates = Array.from(scope.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);

    // If not in a modal, also include topbar controls
    if (!isModalScope) {
      const topbarElements = Array.from(document.querySelectorAll(".topbar " + FOCUSABLE_SELECTOR)).filter(isVisible);
      const combined = new Set([...topbarElements, ...candidates]);
      candidates = Array.from(combined);
    }

    if (candidates.length === 0) return;

    const focused = document.activeElement;
    const idx = candidates.indexOf(focused);

    // 1. If nothing in the interactive list is currently focused, find the best entry element
    if (idx === -1) {
      e.preventDefault();
      const inView = candidates.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top <= window.innerHeight && r.left >= 0 && r.left <= window.innerWidth;
      });
      const pool = inView.length > 0 ? inView : candidates;
      const first = pool.find((el) => el.matches("[data-card-id], .card, .season-card-v2, .episode-card")) ||
                    pool.find((el) => el.matches("#search-input, .menu-btn, .fp-tab, .editor-input")) ||
                    pool[0];
      if (first) focusElement(first);
      return;
    }

    // 2. We have a focused element: perform 2D spatial search
    e.preventDefault();
    const curRect = focused.getBoundingClientRect();

    const target = candidates
      .map((el, i) => ({ i, el, rect: el.getBoundingClientRect() }))
      .filter(({ i, rect }) => i !== idx && isDirectionalCandidate(direction, curRect, rect))
      .sort((a, b) => directionalScore(direction, curRect, a.rect) - directionalScore(direction, curRect, b.rect))[0];

    if (target && target.el) {
      focusElement(target.el);
      return;
    }

    // 3. Fallbacks when boundary is reached (if not in a modal)
    if (!isModalScope) {
      if (direction === "left") {
        const sidebarOpenItem = document.querySelector(".sidebar.open [data-sidebar-item]");
        if (focusElement(sidebarOpenItem, true)) return;
        focusElement(document.querySelector("[data-menu-button], .menu-btn"), true);
      } else if (direction === "up") {
        const searchOrMenu = document.querySelector("#search-input, .fp-trigger, [data-menu-button], .menu-btn");
        if (searchOrMenu && searchOrMenu !== focused) focusElement(searchOrMenu, true);
      } else if (direction === "down" && focused.closest(".topbar, .search-bar, .filter-bar")) {
        const firstCard = document.querySelector("[data-card-id], .card, .season-card-v2, .episode-card");
        if (firstCard) focusElement(firstCard);
      }
    }
  }, []);

  // Global window listener so TV remote navigation works anywhere in the app
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return handleKeyDown;
}

