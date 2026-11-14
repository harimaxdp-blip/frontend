// src/hooks/useSpatialNav.js
import { useCallback } from "react";

const FOCUSABLE_CARD_SELECTOR = "[data-card-id]";
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
  if (direction === "left") return next.x < cur.x - 4;
  if (direction === "right") return next.x > cur.x + 4;
  if (direction === "up") return next.y < cur.y - 4;
  return next.y > cur.y + 4;
}

function directionalScore(direction, current, candidate) {
  const cur = center(current);
  const next = center(candidate);
  const dx = next.x - cur.x;
  const dy = next.y - cur.y;
  const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
  const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);

  const verticalOverlap = Math.min(current.bottom, candidate.bottom) - Math.max(current.top, candidate.top);
  const horizontalOverlap = Math.min(current.right, candidate.right) - Math.max(current.left, candidate.left);
  const hasRowOverlap = verticalOverlap > Math.min(current.height, candidate.height) * 0.25;
  const hasColumnOverlap = horizontalOverlap > Math.min(current.width, candidate.width) * 0.25;
  const aligned = direction === "left" || direction === "right" ? hasRowOverlap : hasColumnOverlap;

  return primary * 1000 + secondary * (aligned ? 1 : 8);
}

function focusElement(el, preventScroll = false) {
  if (!el) return false;
  el.focus({ preventScroll });
  el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

function isVisibleCard(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function useSpatialNav() {
  const handleKeyDown = useCallback((e) => {
    const { key } = e;
    const direction = KEY_TO_DIRECTION[key];
    if (!direction) return;

    const scope = document.querySelector(".content") || document;
    const cards = Array.from(scope.querySelectorAll(FOCUSABLE_CARD_SELECTOR)).filter(isVisibleCard);
    const focused = document.activeElement;
    const idx = cards.indexOf(focused);
    if (idx === -1) return;

    e.preventDefault();

    const rects = cards.map(c => c.getBoundingClientRect());
    const cur = rects[idx];
    const target = rects
      .map((rect, i) => ({ i, rect }))
      .filter(({ i, rect }) => i !== idx && isDirectionalCandidate(direction, cur, rect))
      .sort((a, b) => directionalScore(direction, cur, a.rect) - directionalScore(direction, cur, b.rect))[0]?.i;

    if (target >= 0) {
      focusElement(cards[target]);
      return;
    }

    if (direction === "left") {
      const sidebarItem = document.querySelector(".sidebar.open [data-sidebar-item]");
      if (focusElement(sidebarItem, true)) return;
      focusElement(document.querySelector("[data-menu-button]"), true);
    } else if (direction === "up") {
      focusElement(document.querySelector("#search-input, [data-menu-button]"), true);
    }
  }, []);

  return handleKeyDown;
}
