import React, {
  useEffect, useMemo, useState, useCallback, useRef, useLayoutEffect, useDeferredValue,
} from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";
import DeviceControl from "../plugins/deviceControl";
import { FilterPopup, GENRES } from "./FilterPopup";
import "./Movies.css";
import noResultsAll    from "../assets/no-results-all.png";
import noResultsMovie  from "../assets/no-results-movie.png";
import noResultsSeries from "../assets/no-results-series.png";
import noResultsAnime  from "../assets/no-results-anime.png";
import { useSpatialNav } from "../hooks/useSpatialNav";
import tvIcon    from "../assets/tv1.png";
import seriIcon  from "../assets/tv2.png";
import animeIcon from "../assets/tv.png";
import { Film, Globe, Calendar } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */
const NO_RESULTS_IMG = { all: noResultsAll, movie: noResultsMovie, series: noResultsSeries, anime: noResultsAnime };

// Inline SVG — no network request, works offline / on TV
const POSTER_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
      <rect width="300" height="450" fill="#141414"/>
      <rect x="1" y="1" width="298" height="448" fill="none" stroke="#2a2a2a" stroke-width="2"/>
      <path d="M120 195l60 30-60 30z" fill="#e50914" opacity=".85"/>
    </svg>`
  );

const LAST_WATCHED_KEY = "ott_last_watched";
const RECENT_KEY       = "hm_recent";
const RECENT_LIMIT     = 10;
const ANDROID_LW_PREFS = "hm_last_watched";
const EAGER_COUNT      = 12; // first N posters load eagerly, the rest lazy

let _navStateId = 0;
const nextNavId = () => ++_navStateId;

/* ═══════════════════════════════════════════════════════════════
   STORAGE HELPERS (safe on iOS private mode / WebView)
   ═══════════════════════════════════════════════════════════════ */
const ss = {
  getJSON: (k)    => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  setJSON: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del:     (k)    => { try { sessionStorage.removeItem(k); } catch {} },
};
const ls = {
  getJSON: (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  setJSON: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function readAndroidLastWatched() {
  try {
    if (window.HariMovies && typeof window.HariMovies.getSharedPrefAll === "function") {
      const raw = window.HariMovies.getSharedPrefAll(ANDROID_LW_PREFS);
      if (raw) {
        const map = JSON.parse(raw), result = {};
        for (const [k, v] of Object.entries(map)) { try { result[k] = JSON.parse(v); } catch {} }
        return result;
      }
    }
  } catch (e) { console.warn("HariMovies bridge read failed:", e); }
  return ls.getJSON(LAST_WATCHED_KEY) || {};
}

/* ═══════════════════════════════════════════════════════════════
   PLATFORM DETECTION  (TV · iOS · iPadOS · macOS · Android · Windows · Linux)
   Sets  <html data-device data-os data-input>  — CSS keys off these.
   ═══════════════════════════════════════════════════════════════ */
function detectPlatform() {
  if (typeof window === "undefined") return { tv: false, os: "other", device: "desktop" };
  const ua = navigator.userAgent || "";
  const touchPoints = navigator.maxTouchPoints || 0;

  let tv = !!window.isAndroidTV;
  try { if (window.HariMovies?.isTV?.()) tv = true; } catch {}
  if (!tv) {
    tv = /android tv|googletv|smart-?tv|appletv|hbbtv|tizen|web0s|webos|netcast|crkey|bravia|aft[a-z]{1,3}\b|viera|roku/i.test(ua) ||
         document.body.classList.contains("tv-mode") ||
         document.body.classList.contains("android-mode");
  }

  const ipadOS  = /Macintosh/.test(ua) && touchPoints > 1;           // iPadOS 13+ pretends to be a Mac
  const ios     = /iPhone|iPod|iPad/.test(ua) || ipadOS;
  const android = /Android/i.test(ua);
  const mac     = /Macintosh/.test(ua) && !ipadOS;
  const windows = /Windows/i.test(ua);
  const os      = ios ? "ios" : android ? "android" : mac ? "mac" : windows ? "windows" : "other";

  const w = Math.min(window.screen?.width || 0, window.innerWidth || 0) || window.innerWidth || 0;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const device = tv ? "tv" : (coarse || ios || android) ? (w >= 700 || /iPad/.test(ua) || ipadOS ? "tablet" : "mobile") : "desktop";

  return { tv, os, device, ios, android, mac, windows };
}

function applyPlatform(p) {
  const root = document.documentElement;
  root.dataset.device = p.device;
  root.dataset.os     = p.os;
  if (p.tv) document.body.classList.add("android-mode", "tv-mode");
  document.body.classList.toggle("ios-device", !!p.ios);
}

/* Tracks the last input type so focus/hover styles match the device in use.
   key = D-pad / keyboard · touch · mouse */
function initInputMode(isTV) {
  const root = document.documentElement;
  const set  = (m) => { if (root.dataset.input !== m) root.dataset.input = m; };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  set(isTV ? "key" : coarse ? "touch" : "mouse");
  if (isTV) return () => {};

  const KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab", " "]);
  const onKey  = (e) => { if (KEYS.has(e.key)) set("key"); };
  const onPtr  = (e) => set(e.pointerType === "mouse" ? "mouse" : "touch");
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPtr, true);
  window.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") set("mouse"); }, { passive: true, once: true });
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPtr, true);
  };
}

/* ═══════════════════════════════════════════════════════════════
   DATA HELPERS
   ═══════════════════════════════════════════════════════════════ */
const norm = (v) => String(v || "").toLowerCase().trim();
const hasEp = (ep) => ep !== undefined && ep !== null && ep !== "" && ep !== 0 && ep !== "0";
const isMovieType  = (t) => t === "movie" || t === "movies";
const isSeriesType = (t) => t === "series" || t === "tv" || t === "show";
const isAnimeGenre = (item) => norm(item?.genre) === "anime";
const baseTitle = (m) =>
  m.collectionTitle?.trim() || String(m.title || "").split(/\s*[-–—]\s*\d|\d+/)[0].trim() || m.title || "Untitled";
const epCompare = (a, b) =>
  String(a.episode || "").localeCompare(String(b.episode || ""), undefined, { numeric: true, sensitivity: "base" });
const sortEps = (eps) => [...eps].sort(epCompare);
const sortSeasons = (seasons) => Object.entries(seasons || {}).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

function randomImg(episodes) {
  const withImg = episodes.filter((e) => e.img);
  return withImg.length ? withImg[Math.floor(Math.random() * withImg.length)].img : POSTER_FALLBACK;
}
function firstSeasonImg(seasons) {
  const entries = sortSeasons(seasons);
  const first = entries.find(([s]) => String(s) === "1") || entries[0];
  if (!first) return POSTER_FALLBACK;
  return sortEps(first[1]).find((ep) => ep.img)?.img || randomImg(first[1]);
}

function getCreatedAt(item) {
  const c = item.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === "function") return c.toMillis();
  if (c instanceof Date) return c.getTime();
  if (typeof c === "number") return c;
  if (c.seconds != null) return c.seconds * 1000;
  return 0;
}
const sortByYearThenCreatedAt = (a, b) => {
  const yA = parseInt(a.year) || 0, yB = parseInt(b.year) || 0;
  return yB !== yA ? yB - yA : getCreatedAt(b) - getCreatedAt(a);
};
const groupSortKey = (items) => ({
  year: Math.max(...items.map((m) => parseInt(m.year) || 0)),
  createdAt: Math.max(...items.map(getCreatedAt)),
});
const sortGroups = (a, b) => {
  const ka = groupSortKey(a[1]), kb = groupSortKey(b[1]);
  return kb.year !== ka.year ? kb.year - ka.year : kb.createdAt - ka.createdAt;
};

function searchScore(title, query) {
  const t = norm(title), q = norm(query);
  if (!q) return 0;
  if (t === q) return 10000;
  if (t.startsWith(q)) return 9000;
  if (t.split(" ").some((w) => w.startsWith(q))) return 8000;
  if (t.includes(q)) return 7000;
  let s = 0; for (const c of q) if (t.includes(c)) s++;
  return s;
}
function isSimilar(title, query) {
  if (query.length < 3) return false;           // fuzzy match only for 3+ chars
  let m = 0; for (const c of query) if (title.includes(c)) m++;
  return m / query.length > 0.7;
}

function groupCollections(items, q) {
  const g = {};
  for (const m of items) { const b = baseTitle(m); (g[b] = g[b] || []).push(m); }
  return Object.entries(g)
    .sort((a, b) => {
      if (q) { const d = searchScore(b[0], q) - searchScore(a[0], q); if (d) return d; }
      return sortGroups(a, b);
    })
    .map(([n, items]) => [n, [...items].sort(sortByYearThenCreatedAt)]);
}

function groupSeriesItems(items) {
  const groups = {};
  for (const item of items) {
    const key    = norm(item.seriesTitle || item.title || "Unknown Series");
    const season = String(item.season || "1");
    const g = groups[key] || (groups[key] = {
      displayName: item.seriesTitle || item.title || "Unknown Series", seasons: {}, maxYear: 0, maxCreatedAt: 0,
    });
    g.maxYear      = Math.max(g.maxYear, parseInt(item.year) || 0);
    g.maxCreatedAt = Math.max(g.maxCreatedAt, getCreatedAt(item));
    (g.seasons[season] = g.seasons[season] || []).push(item);
  }
  return groups;
}
const sortSeriesGroups = (groups) =>
  Object.entries(groups).sort((a, b) => (b[1].maxYear - a[1].maxYear) || (b[1].maxCreatedAt - a[1].maxCreatedAt));

/* ═══════════════════════════════════════════════════════════════
   SCROLL HELPERS
   ═══════════════════════════════════════════════════════════════ */
const getScrollRoot  = () => document.querySelector(".content") || document.scrollingElement || document.documentElement;
const getPageScrollY = () => { const r = getScrollRoot(); return r ? r.scrollTop : window.scrollY; };
const scrollPageTo   = (top, behavior = "auto") => {
  const r = getScrollRoot();
  if (r?.scrollTo) r.scrollTo({ top, left: 0, behavior });
  else window.scrollTo({ top, left: 0, behavior });
};

/* Two attempts only (next frame + 150 ms) — no retry cascade, no visible jumps */
let restoreScrollToken = 0;
function restoreScrollAndFocus(scrollY, focusId) {
  const token = ++restoreScrollToken;
  const targetY = Number(scrollY) || 0;
  let done = false;
  const attempt = () => {
    if (done || token !== restoreScrollToken) return;
    scrollPageTo(targetY);
    if (focusId) {
      const el = document.querySelector(`[data-card-id="${focusId}"]`);
      if (el) { el.focus({ preventScroll: true }); done = true; }
    } else done = true;
  };
  requestAnimationFrame(attempt);
  setTimeout(attempt, 150);
}

const isTVNow = () => document.documentElement.dataset.device === "tv";

function triggerRipple(e, el) {
  if (isTVNow() || !el) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const cx = e.clientX ?? e.touches?.[0]?.clientX ?? rect.left + rect.width / 2;
  const cy = e.clientY ?? e.touches?.[0]?.clientY ?? rect.top + rect.height / 2;
  const span = document.createElement("span");
  span.className = "ripple-wave";
  Object.assign(span.style, {
    width: `${size}px`, height: `${size}px`,
    left: `${cx - rect.left - size / 2}px`, top: `${cy - rect.top - size / 2}px`,
  });
  el.appendChild(span);
  setTimeout(() => span.remove(), 650);
}

/* ═══════════════════════════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════════════════════════ */
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14, display: "block" }}>
    <path d="M3 6H5H21" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6M19 6L18.1245 19.1334C18.0544 20.1954 17.1818 21 16.1168 21H7.88316C6.81824 21 5.94558 20.1954 5.87546 19.1334L5 6H19Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 11V17M14 11V17" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const PosterImg = React.memo(function PosterImg({ src, alt, eager = false }) {
  const [state, setState] = useState(src ? "loading" : "error");
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!src) { setState("error"); return; }
    setState(el && el.complete && el.naturalWidth > 0 ? "loaded" : "loading");
  }, [src]);

  const ready = state !== "loading";
  return (
    <div className="poster-wrap">
      {!ready && <div className="poster-shimmer" aria-hidden="true" />}
      <img
        ref={ref}
        src={state === "error" || !src ? POSTER_FALLBACK : src}
        alt={alt || ""}
        className={`poster-img ${ready ? "poster-img--loaded" : "poster-img--loading"}`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
      />
    </div>
  );
});

const SkeletonCard = React.memo(function SkeletonCard() {
  return <div className="card-skeleton"><div className="skel-img" /><div className="skel-title" /><div className="skel-sub" /></div>;
});

const NoResults = React.memo(function NoResults({ img }) {
  return (
    <div className="no-results" role="status">
      <img src={img} alt="No results found" className="no-results-img" />
      <p>No items found.</p>
    </div>
  );
});

/* Hero — timeout-based autoplay (no stale closures), pauses when tab hidden or hovered */
const HeroBanner = React.memo(function HeroBanner({ banners, onPlay }) {
  const [index, setIndex]   = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const busy = useRef(false);
  const ref  = useRef(null);
  const len  = banners.length;

  useEffect(() => { setIndex(0); }, [banners]);

  const go = useCallback((n) => {
    if (busy.current || len < 2) return;
    const target = ((n % len) + len) % len;
    if (target === index) return;
    busy.current = true;
    setFading(true);
    setTimeout(() => { setIndex(target); setFading(false); busy.current = false; }, 320);
  }, [index, len]);

  // autoplay
  useEffect(() => {
    if (len < 2 || paused) return;
    const t = setTimeout(() => { if (document.visibilityState === "visible") go(index + 1); else setIndex((i) => i); }, 6000);
    return () => clearTimeout(t);
  }, [index, len, paused, go]);

  // preload next
  useEffect(() => {
    if (len < 2) return;
    const nb = banners[(index + 1) % len];
    const url = nb?.image || nb?.imageUrl;
    if (url) { const im = new Image(); im.src = url; }
  }, [index, banners, len]);

  // swipe
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let sx = 0, sy = 0;
    const ts = (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const te = (e) => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) go(index + (dx < 0 ? 1 : -1));
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchend", te, { passive: true });
    return () => { el.removeEventListener("touchstart", ts); el.removeEventListener("touchend", te); };
  }, [go, index]);

  const banner = banners[index];
  if (!banner) return null;
  const isAd = banner.description === "For Adevertiment Call";
  const img  = banner.image || banner.imageUrl;

  return (
    <div ref={ref} className="hero-banner" role="region" aria-label="Featured content" tabIndex={0}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") go(index - 1); if (e.key === "ArrowRight") go(index + 1); }}>
      <div className={`hero-bg ${fading ? "hero-bg--out" : "hero-bg--in"}`} style={{ backgroundImage: `url("${img}")` }} />
      {!isAd && <div className="hero-overlay" />}
      <div className={`hero-content ${fading ? "hero-content--out" : "hero-content--in"}`}>
        {banner.logo
          ? <img src={banner.logo} alt={banner.title} className="hero-logo" decoding="async" />
          : <h1 className="hero-title">{banner.title}</h1>}
        {banner.description && !isAd && <p className="hero-desc">{banner.description}</p>}
        <div className="hero-meta">
          {banner.year     && <span className="hero-tag">{banner.year}</span>}
          {banner.language && <span className="hero-tag">{String(banner.language).toUpperCase()}</span>}
          {banner.genre    && <span className="hero-tag">{banner.genre}</span>}
        </div>
        {banner.movieRef && (
          <button className="hero-play-btn" onClick={() => onPlay?.(banner.movieRef)} aria-label={`Play ${banner.title}`}>
            <span className="hero-play-icon" aria-hidden="true">▶</span>Play Now
          </button>
        )}
      </div>
      {len > 1 && (
        <>
          <button className="hero-nav hero-nav--prev" onClick={() => go(index - 1)} aria-label="Previous">‹</button>
          <button className="hero-nav hero-nav--next" onClick={() => go(index + 1)} aria-label="Next">›</button>
          <div className="hero-dots" role="tablist">
            {banners.map((_, i) => (
              <button key={i} role="tab" aria-selected={i === index} aria-label={`Slide ${i + 1}`}
                className={`hero-dot ${i === index ? "hero-dot--active" : ""}`} onClick={() => go(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
});

/* Enter/Space activation with 300 ms double-open guard */
const FocusCard = React.memo(React.forwardRef(function FocusCard(
  { className, style, onClick, children, tabIndex = 0, "data-card-id": dataCardId }, ref
) {
  const last = useRef(0);
  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      const now = Date.now();
      if (now - last.current < 300) return;
      last.current = now;
      e.currentTarget.click();
    }
  }, []);
  return (
    <div ref={ref} className={className} style={style} onClick={onClick} onKeyDown={onKeyDown}
      tabIndex={tabIndex} data-card-id={dataCardId} role="button">
      {children}
    </div>
  );
}));

/* ═══════════════════════════════════════════════════════════════
   HOME
   ═══════════════════════════════════════════════════════════════ */
export default function Home({ type = "all" }) {
  const [platform] = useState(() => detectPlatform());
  const isTVMode   = platform.tv;

  const [movies, setMovies]             = useState([]);
  const [allBanners, setAllBanners]     = useState([]);
  const [filterOpen, setFilterOpen]     = useState(false);
  const [filterTab, setFilterTab]       = useState("language");
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const handleGridKeyDown               = useSpatialNav();

  const [languageFilter, setLanguageFilter] = useState([]);
  const [genreFilter,    setGenreFilter]    = useState([]);
  const [yearFilter,     setYearFilter]     = useState([]);
  const [search,         setSearch]         = useState("");
  const dSearch = useDeferredValue(search);           // typing stays instant, filtering is deferred

  const isRestoringNavState = useRef(false);

  const [isListening,  setIsListening]  = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceHint,    setVoiceHint]    = useState("");
  const [voiceError,   setVoiceError]   = useState("");

  const [lastWatched, setLastWatched] = useState(() => ({ ...(ls.getJSON(LAST_WATCHED_KEY) || {}), ...readAndroidLastWatched() }));
  const [recentWatched, setRecentWatched] = useState(() => ls.getJSON(RECENT_KEY) || { movies: [], series: [], anime: [] });

  const [showUpBtn, setShowUpBtn] = useState(false);
  const [viewStack, setViewStack] = useState([{ kind: "home" }]);

  const navigate         = useNavigate();
  const savedScrollMap   = useRef({});
  const savedFocusMap    = useRef({});
  const isNavigatingBack = useRef(false);
  const navIdRef         = useRef(0);
  const recognitionRef   = useRef(null);
  const silenceTimerRef  = useRef(null);

  const currentView        = viewStack[viewStack.length - 1];
  const selectedCollection = currentView.kind === "collection" ? currentView.data : null;
  const selectedSeries     = currentView.kind === "series"     ? currentView.data : null;
  const selectedSeason     = currentView.kind === "season"     ? currentView.data : null;

  /* ── platform + input mode ── */
  useEffect(() => {
    applyPlatform(platform);
    return initInputMode(platform.tv);
  }, [platform]);

  /* ── sync last-watched from Android bridge ── */
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      const a = readAndroidLastWatched();
      if (!a || !Object.keys(a).length) return;
      setLastWatched((prev) => {
        const changed = Object.entries(a).some(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v));
        if (!changed) return prev;
        const merged = { ...prev, ...a };
        ls.setJSON(LAST_WATCHED_KEY, merged);
        return merged;
      });
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    sync();
    return () => { document.removeEventListener("visibilitychange", sync); window.removeEventListener("focus", sync); };
  }, []);

  /* ── scroll-to-top button (rAF-throttled) ── */
  useEffect(() => {
    const root = getScrollRoot();
    const target = root === document.scrollingElement || root === document.documentElement ? window : root;
    let ticking = false;
    const fn = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { setShowUpBtn(getPageScrollY() > 300); ticking = false; });
    };
    target.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => target.removeEventListener("scroll", fn);
  }, []);

  const scrollToTop = useCallback((e) => { triggerRipple(e, e.currentTarget); scrollPageTo(0, "smooth"); }, []);

  /* ── Firestore ── */
  useEffect(() => {
    const u = onSnapshot(collection(db, "movies"), (snap) => {
      setMovies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setIsDataLoaded(true);
    }, (err) => { console.error("movies snapshot:", err); setIsDataLoaded(true); });
    return () => u();
  }, []);

  useEffect(() => {
    const u = onSnapshot(collection(db, "banners"), (snap) => {
      setAllBanners(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("banners snapshot:", err));
    return () => u();
  }, []);

  /* ── banners ── */
  const banners = useMemo(() => {
    return allBanners.filter((b) => {
      if (b.active === false) return false;
      if (!b.image && !b.imageUrl) return false;
      const dn = norm(b.description), tn = norm(b.title);
      if (dn.includes("advertisement") || dn.includes("adevertiment") || tn === "ad") return false;
      const bt = norm(b.bannerType), mr = b.movieRef || {}, mt = norm(mr.type);
      if (type === "movie")  return bt ? bt === "movie" : isMovieType(mt) && !isAnimeGenre(mr);
      if (type === "series") return bt ? isSeriesType(bt) : isSeriesType(mt) && !isAnimeGenre(mr);
      if (type === "anime")  return bt ? bt === "anime" : mt === "anime" || isAnimeGenre(mr) || norm(b.genre) === "anime";
      return true;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [allBanners, type]);

  /* ── filtering ── */
  const matchesTab = useCallback((item) => {
    const c = norm(item.type);
    if (type === "movie")  return isMovieType(c) && !isAnimeGenre(item);
    if (type === "series") return isSeriesType(c) && !isAnimeGenre(item);
    if (type === "anime")  return c === "anime" || isAnimeGenre(item);
    return true;
  }, [type]);

  const passesFilters = useCallback((item, titleField = "title") => {
    if (languageFilter.length && !languageFilter.includes(norm(item.language))) return false;
    if (genreFilter.length    && !genreFilter.includes(norm(item.genre)))       return false;
    if (yearFilter.length     && !yearFilter.includes(String(item.year)))       return false;
    const q = norm(dSearch);
    if (!q) return true;
    const t = norm(item[titleField] || item.title);
    return t.includes(q) || isSimilar(t, q);
  }, [languageFilter, genreFilter, yearFilter, dSearch]);

  const isAnimeItem = (i) => norm(i.type) === "anime" || isAnimeGenre(i);

  const movieGroups = useMemo(() =>
    groupCollections(movies.filter((i) => isMovieType(norm(i.type)) && !isAnimeGenre(i) && matchesTab(i) && passesFilters(i)), dSearch),
  [movies, matchesTab, passesFilters, dSearch]);

  const seriesGroups = useMemo(() =>
    sortSeriesGroups(groupSeriesItems(movies.filter((i) => isSeriesType(norm(i.type)) && !isAnimeGenre(i) && matchesTab(i) && passesFilters(i, "seriesTitle")))),
  [movies, matchesTab, passesFilters]);

  const animeMovieGroups = useMemo(() =>
    groupCollections(movies.filter((i) => isAnimeItem(i) && !hasEp(i.episode) && passesFilters(i)), dSearch),
  [movies, passesFilters, dSearch]);

  const animeSeriesGroups = useMemo(() =>
    sortSeriesGroups(groupSeriesItems(movies.filter((i) => isAnimeItem(i) && hasEp(i.episode) && passesFilters(i, "seriesTitle")))),
  [movies, passesFilters]);

  // Unfiltered lookups — used for nav restore & "recently watched" so filters never break them
  const allSeriesLookup = useMemo(
    () => groupSeriesItems(movies.filter((i) => isSeriesType(norm(i.type)) || isAnimeItem(i))), [movies]);

  const allMovieCollectionLookup = useMemo(() => {
    const g = {};
    for (const m of movies) {
      if (!(isMovieType(norm(m.type)) || isAnimeItem(m))) continue;
      const b = baseTitle(m); (g[b] = g[b] || []).push(m);
    }
    Object.keys(g).forEach((k) => { g[k] = [...g[k]].sort(sortByYearThenCreatedAt); });
    return g;
  }, [movies]);

  /* ── last watched / recent ── */
  const lwKey = (seriesTitle, seasonNum) =>
    `${norm(seriesTitle)}_s${!seasonNum || seasonNum === "0" || seasonNum === 0 ? "1" : String(seasonNum)}`;

  const getLastWatchedEp = useCallback((t, s) => lastWatched[lwKey(t, s)] || null, [lastWatched]);

  const saveLastWatched = useCallback((seriesTitle, seasonNum, episodeNum, episodeId) => {
    const key = lwKey(seriesTitle, seasonNum);
    setLastWatched((prev) => {
      const updated = { ...prev, [key]: { episodeNum, episodeId } };
      ls.setJSON(LAST_WATCHED_KEY, updated);
      return updated;
    });
  }, []);

  const addRecentWatched = useCallback((movie) => {
    const anime   = norm(movie.type) === "anime" || isAnimeGenre(movie);
    const isMovie = isMovieType(norm(movie.type)) && !anime;
    const episode = hasEp(movie.episode);
    const category = anime ? "anime" : isMovie ? "movies" : "series";
    const entryId  = episode ? norm(movie.seriesTitle || movie.title) : movie.id;
    const entry = episode ? {
      id: entryId, realId: movie.id,
      title: movie.seriesTitle || movie.title, seriesTitle: movie.seriesTitle || movie.title,
      img: movie.img, type: movie.type, genre: movie.genre, year: movie.year,
      lastEpisodeId: movie.id, lastEpisodeNum: movie.episode, lastSeason: String(movie.season || "1"),
    } : { ...movie };

    setRecentWatched((prev) => {
      const updated = { ...prev, [category]: [entry, ...(prev[category] || []).filter((x) => x.id !== entryId)].slice(0, RECENT_LIMIT) };
      ls.setJSON(RECENT_KEY, updated);
      return updated;
    });
  }, []);

  const deleteRecentWatched = useCallback((category, itemId) => {
    setRecentWatched((prev) => {
      const updated = { ...prev, [category]: (prev[category] || []).filter((x) => x.id !== itemId) };
      ls.setJSON(RECENT_KEY, updated);
      return updated;
    });
  }, []);

  /* ── view stack / history ── */
  const saveCurrentScrollAndFocus = useCallback(() => {
    savedScrollMap.current[navIdRef.current] = getPageScrollY();
    const f = document.activeElement;
    if (f?.dataset?.cardId) savedFocusMap.current[navIdRef.current] = f.dataset.cardId;
  }, []);

  const pushView = useCallback((newView) => {
    saveCurrentScrollAndFocus();
    const id = nextNavId();
    navIdRef.current = id;
    window.history.pushState({ id, kind: newView.kind }, "");
    setViewStack((prev) => [...prev, newView]);
    scrollPageTo(0);
  }, [saveCurrentScrollAndFocus]);

  const popView = useCallback(() => {
    if (viewStack.length <= 1) return;
    isNavigatingBack.current = true;
    setViewStack((prev) => prev.slice(0, -1));
  }, [viewStack.length]);

  useLayoutEffect(() => {
    if (!isNavigatingBack.current) return;
    isNavigatingBack.current = false;
    const id = window.history.state?.id ?? 0;
    navIdRef.current = id;
    restoreScrollAndFocus(savedScrollMap.current[id] ?? 0, savedFocusMap.current[id] ?? null);
  }, [viewStack]);

  useEffect(() => {
    const onPop = () => { if (viewStack.length > 1) popView(); };
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;          // never hijack Backspace while typing
      const isBack = e.key === "Escape" || e.key === "GoBack" || e.key === "Backspace" ||
                     e.keyCode === 27 || e.keyCode === 10009 || e.keyCode === 8;
      if (isBack && viewStack.length > 1) { e.preventDefault(); window.history.back(); }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); };
  }, [viewStack, popView]);

  /* ── nav state restore (returning from player) ── */
  useEffect(() => {
    if (!isDataLoaded) return;
    const saved = ss.getJSON("ott_nav_state");
    if (!saved) return;
    ss.del("ott_nav_state");

    const {
      stackKinds, collectionName, seriesTitle, seriesDisplayName, seasonNum,
      scrollY, focusId, homeScrollY, homeFocusId, seriesScrollY, seriesFocusId, filters,
    } = saved;

    const android = readAndroidLastWatched();
    if (android && Object.keys(android).length) {
      setLastWatched((prev) => { const m = { ...prev, ...android }; ls.setJSON(LAST_WATCHED_KEY, m); return m; });
    }

    isRestoringNavState.current = true;
    if (filters?.language !== undefined) setLanguageFilter(filters.language);
    if (filters?.genre    !== undefined) setGenreFilter(filters.genre);
    if (filters?.year     !== undefined) setYearFilter(filters.year);
    if (filters?.search   !== undefined) setSearch(filters.search);
    setFilterOpen(false);

    const finish = () => setTimeout(() => { isRestoringNavState.current = false; }, 200);

    // views[0] is always home; scrolls/focuses line up with views
    const restoreStack = (views, scrolls, focuses) => {
      const ids = views.map((_, i) => (i === 0 ? 0 : nextNavId()));
      navIdRef.current = ids[ids.length - 1];
      ids.forEach((id, i) => {
        savedScrollMap.current[id] = Number(scrolls[i]) || 0;
        savedFocusMap.current[id]  = focuses[i] || null;
      });
      window.history.replaceState({ id: 0, kind: "home" }, "");
      ids.slice(1).forEach((id, i) => window.history.pushState({ id, kind: views[i + 1].kind }, ""));
      setViewStack(views);
      restoreScrollAndFocus(scrollY, focusId);
      finish();
    };

    const kinds = stackKinds || [];
    const entry = seriesTitle ? allSeriesLookup[seriesTitle] : null;
    const display = entry?.displayName || seriesDisplayName || seriesTitle;
    const seriesView = entry && { kind: "series", data: { titleKey: seriesTitle, seriesTitle: display, seasons: entry.seasons } };

    if (kinds.includes("season") && entry && seasonNum && entry.seasons[seasonNum]) {
      return restoreStack(
        [{ kind: "home" }, seriesView, { kind: "season", data: { seriesTitle: display, seasonNum, episodes: entry.seasons[seasonNum] } }],
        [homeScrollY, seriesScrollY, scrollY], [homeFocusId, seriesFocusId, focusId]);
    }
    if (kinds.includes("series") && entry) {
      return restoreStack([{ kind: "home" }, seriesView], [homeScrollY, scrollY], [homeFocusId, focusId]);
    }
    if (kinds.includes("collection") && collectionName && allMovieCollectionLookup[collectionName]) {
      return restoreStack(
        [{ kind: "home" }, { kind: "collection", data: { name: collectionName, items: allMovieCollectionLookup[collectionName] } }],
        [homeScrollY, scrollY], [homeFocusId, focusId]);
    }
    finish();
    restoreScrollAndFocus(scrollY, focusId);
  }, [isDataLoaded, allSeriesLookup, allMovieCollectionLookup]);

  /* ── initial focus for D-pad / keyboard ── */
  useEffect(() => {
    if (!isDataLoaded) return;
    requestAnimationFrame(() => {
      if (document.documentElement.dataset.input !== "key") return;
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector("[data-card-id], .card, .season-card-v2, .episode-card")?.focus({ preventScroll: true });
    });
  }, [isDataLoaded, currentView.kind]);

  /* ── reset on tab type change ── */
  useLayoutEffect(() => {
    if (isRestoringNavState.current || ss.getJSON("ott_nav_state")) return;
    setLanguageFilter([]); setGenreFilter([]); setYearFilter([]); setSearch("");
    setViewStack([{ kind: "home" }]);
    navIdRef.current = 0;
    savedScrollMap.current = {};
    savedFocusMap.current  = {};
    scrollPageTo(0);
  }, [type]);

  const handleOpenCollection = useCallback((name, items) => pushView({ kind: "collection", data: { name, items } }), [pushView]);
  const handleOpenSeries = useCallback((seriesTitle, data) =>
    pushView({ kind: "series", data: { titleKey: norm(seriesTitle), seriesTitle: data.displayName || seriesTitle, seasons: data.seasons } }), [pushView]);
  const handleOpenSeason = useCallback((seriesTitle, seasonNum, episodes) =>
    pushView({ kind: "season", data: { seriesTitle, seasonNum, episodes } }), [pushView]);

  const cardId = (prefix, id) => `${prefix}_${id}`;

  /* ── play ── */
  const playMovie = useCallback((movie, playlist = null, currentIndex = 0, navContext = null) => {
    if (hasEp(movie.episode)) {
      const sTitle = movie.seriesTitle || movie.title;
      if (sTitle) saveLastWatched(sTitle, String(movie.season || "1"), movie.episode, movie.id);
    }

    let finalPlaylist = playlist, finalIndex = currentIndex;
    if (!finalPlaylist && norm(movie.type) !== "movie") {
      const entry = allSeriesLookup[norm(movie.seriesTitle || movie.title)];
      const eps = entry?.seasons[String(movie.season || "1")];
      if (eps) {
        finalPlaylist = eps;
        finalIndex = Math.max(0, eps.findIndex((ep) => ep.id === movie.id));
      }
    }

    const stackKinds = viewStack.map((v) => v.kind);
    const getNavInfo = (idx) => ({ scrollY: savedScrollMap.current[idx] ?? getPageScrollY(), focusId: savedFocusMap.current[idx] ?? null });
    const homeInfo   = getNavInfo(0);
    const seriesInfo = viewStack.length >= 3 ? getNavInfo(navIdRef.current - 1) : null;

    saveCurrentScrollAndFocus();
    const deepScrollY = savedScrollMap.current[navIdRef.current] ?? 0;
    const deepFocusId = savedFocusMap.current[navIdRef.current] ?? cardId("ep", movie.id);

    const seasonView = viewStack.find((v) => v.kind === "season");
    const seriesView = viewStack.find((v) => v.kind === "series");
    const colView    = viewStack.find((v) => v.kind === "collection");

    ss.setJSON("ott_nav_state", {
      stackKinds: navContext ? Array.from(new Set([...stackKinds, "series", "season"])) : stackKinds,
      collectionName:    colView?.data?.name ?? null,
      seriesTitle:       navContext?.seriesTitleKey ?? (seriesView?.data?.titleKey ?? (seasonView ? norm(seasonView.data?.seriesTitle) : null)),
      seriesDisplayName: navContext?.seriesDisplayName ?? (seriesView?.data?.seriesTitle ?? seasonView?.data?.seriesTitle ?? null),
      seasonNum:         navContext?.seasonNum ?? (seasonView?.data?.seasonNum ?? null),
      scrollY: deepScrollY, focusId: deepFocusId,
      homeScrollY: homeInfo.scrollY, homeFocusId: homeInfo.focusId,
      seriesScrollY: seriesInfo?.scrollY ?? null, seriesFocusId: seriesInfo?.focusId ?? null,
      filters: { language: languageFilter, genre: genreFilter, year: yearFilter, search },
    });

    setSearch("");
    addRecentWatched(movie);
    navigate("/player", { state: { movie, playlist: finalPlaylist, currentIndex: finalIndex } });
  }, [navigate, viewStack, languageFilter, genreFilter, yearFilter, search, allSeriesLookup,
      saveLastWatched, addRecentWatched, saveCurrentScrollAndFocus]);

  /* Resume helper — picks the last-watched episode (or first) and plays it */
  const resumeSeason = useCallback((seriesTitle, sNum, eps, navContext) => {
    const sorted = sortEps(eps);
    const lw = getLastWatchedEp(seriesTitle, sNum);
    const ep = (lw && (sorted.find((e) => e.id === lw.episodeId) || sorted.find((e) => String(e.episode) === String(lw.episodeNum)))) || sorted[0];
    if (!ep) return;
    playMovie(ep, sorted, Math.max(0, sorted.findIndex((e) => e.id === ep.id)), navContext);
  }, [getLastWatchedEp, playMovie]);

  /* ── voice search ── */
  const requestMic = useCallback(async () => {
    setVoiceError("");
    if (typeof DeviceControl?.requestMicrophonePermissionNative === "function") {
      try { if (await DeviceControl.requestMicrophonePermissionNative()) return true; } catch {}
    }
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const s = await navigator.permissions.query({ name: "microphone" });
      if (s.state === "granted") return true;
      if (s.state === "denied") return false;
    } catch {}                                                     // Safari/iOS has no "microphone" permission name
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); return true; }
    catch { return false; }
    finally { stream?.getTracks().forEach((t) => t.stop()); }
  }, []);

  const stopVoice = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) { try { rec.onresult = null; rec.onend = null; rec.onerror = null; rec.stop(); } catch {} recognitionRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setIsListening(false); setIsProcessing(false); setVoiceHint("");
  }, []);

  const scheduleSilence = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(stopVoice, 1600);
  }, [stopVoice]);

  const startVoice = useCallback(async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceError("Voice search isn't supported in this browser."); return; }
    if (recognitionRef.current) { stopVoice(); return; }
    if (!(await requestMic())) { setVoiceError("Microphone access is required for voice search."); return; }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = false; rec.interimResults = true;
    const lang = navigator.language || "en-US";
    rec.lang = lang.startsWith("ta") ? "ta-IN" : lang.startsWith("en") ? lang : "en-US";
    rec.onstart = () => { setIsListening(true); setIsProcessing(false); setVoiceHint("Listening..."); setVoiceError(""); };
    rec.onresult = (ev) => {
      let interim = "", final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0]?.transcript || "";
        if (ev.results[i].isFinal) final += t; else interim += t;
      }
      const text = (final || interim).trim();
      if (text) setSearch(text);
      setIsProcessing(!!final);
      setVoiceHint(final ? "Processing..." : "Listening...");
      scheduleSilence();
    };
    rec.onerror = (ev) => {
      setVoiceError(ev.error === "not-allowed" || ev.error === "service-not-allowed" ? "Microphone permission denied." : "Voice recognition failed. Try again.");
      stopVoice();
    };
    rec.onend = () => { setIsListening(false); setIsProcessing(false); setVoiceHint(""); recognitionRef.current = null; };
    try { rec.start(); } catch { setVoiceError("Unable to start voice recognition."); stopVoice(); }
  }, [requestMic, scheduleSilence, stopVoice]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  const handleClick = useCallback((e, action) => {
    restoreScrollToken += 1;
    e.currentTarget?.focus?.({ preventScroll: true });
    triggerRipple(e, e.currentTarget);
    action();
  }, []);

  /* ── derived ── */
  const availableLanguages = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => norm(m.language)))].filter(Boolean).sort(), [movies, matchesTab]);
  const availableYears = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => m.year))].filter(Boolean).sort((a, b) => b - a), [movies, matchesTab]);

  const noResults = isDataLoaded && !movieGroups.length && !seriesGroups.length && !animeMovieGroups.length && !animeSeriesGroups.length;
  const isSearchActive = search.trim().length > 0;

  /* ── renderers ── */
  const renderMovieGrid = (groups, prefix = "m") =>
    groups.map(([name, items], i) => (
      <FocusCard key={name} className={`card ${items.length > 1 ? "is-collection" : ""}`}
        style={{ "--i": i }} data-card-id={cardId(prefix, items[0].id)}
        onClick={(e) => handleClick(e, () => (items.length > 1 ? handleOpenCollection(name, items) : playMovie(items[0])))}>
        <PosterImg src={items[0].img} alt={name} eager={i < EAGER_COUNT} />
        {items.length > 1 && <div className="collection-badge">{items.length} Parts</div>}
        <div className="card-info">
          <h3>{items.length > 1 ? `${name} (Collection)` : items[0].title}</h3>
          <p>{items.length > 1 ? "Multi-Part Series" : `${items[0].language || ""} • ${items[0].year || ""}`}</p>
        </div>
      </FocusCard>
    ));

  const renderSeriesCard = (titleKey, data, i = 0) => {
    const seriesTitle = data.displayName || titleKey;
    const seasons  = sortSeasons(data.seasons);
    const epCount  = seasons.reduce((n, [, eps]) => n + eps.length, 0);
    return (
      <FocusCard key={titleKey} className="card is-collection series-card" style={{ "--i": i }}
        data-card-id={cardId("series", titleKey)}
        onClick={(e) => handleClick(e, () => handleOpenSeries(seriesTitle, data))}>
        <PosterImg src={firstSeasonImg(data.seasons)} alt={seriesTitle} eager={i < EAGER_COUNT} />
        <div className="collection-badge">{seasons.length} Season{seasons.length !== 1 ? "s" : ""}</div>
        <div className="card-info">
          <h3>{seriesTitle}</h3>
          <p>{epCount} Episode{epCount !== 1 ? "s" : ""}</p>
        </div>
      </FocusCard>
    );
  };

  const renderRecentSection = (title, items, category) => {
    if (isSearchActive || !items?.length) return null;
    return (
      <section className="recently-watched-section" key={`rw_${category}`}>
        <h2 className="section-title">{title}</h2>
        <div className="rw-hstrip">
          {items.map((item, i) => {
            const isEpisode = item.lastEpisodeNum !== undefined && item.lastEpisodeNum !== null;
            const label = category === "anime" ? "ANIME" : category === "series" ? "SERIES" : "MOVIE";
            return (
              <div key={`rw_${category}_${item.id}_${i}`} className="rw-hcard" tabIndex={0} role="button"
                data-card-id={cardId(`rw_${category}`, item.id)}
                onClick={(e) => {
                  triggerRipple(e, e.currentTarget);
                  if (isEpisode) {
                    const sNum = item.lastSeason || "1";
                    const eps  = allSeriesLookup[item.id]?.seasons[sNum];
                    if (eps?.length) {
                      return resumeSeason(item.seriesTitle || item.title, sNum, eps, {
                        seriesTitleKey: item.id, seriesDisplayName: item.seriesTitle || item.title, seasonNum: sNum,
                      });
                    }
                  }
                  playMovie(item);
                }}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); e.currentTarget.click(); } }}>
                <div className="rw-hcard-poster">
                  <PosterImg src={item.img} alt={item.seriesTitle || item.title} eager={i < 6} />
                  {isEpisode && <div className="rw-hcard-bar" />}
                  <span className={`rw-hcard-badge rw-hcard-badge--${category === "movies" ? "movie" : category}`}>{label}</span>
                  <button className="rw-hcard-delete" aria-label="Remove from recently watched" title="Remove" type="button"
                    onClick={(e) => { e.stopPropagation(); deleteRecentWatched(category, item.id); }}>
                    <TrashIcon />
                  </button>
                </div>
                <div className="rw-hcard-info">
                  <p className="rw-hcard-title">{item.seriesTitle || item.title}</p>
                  <p className="rw-hcard-meta">{isEpisode ? `S${item.lastSeason || 1} · EP ${item.lastEpisodeNum}` : item.year || ""}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const getFilterLabel = (arr, fallback) =>
    !arr?.length ? fallback : arr.length === 1 ? arr[0].charAt(0).toUpperCase() + arr[0].slice(1) : `${arr.length} Items`;

  const sectionTitle = (icon, text) => (
    <h2 className="section-title"><img src={icon} alt="" className="section-icon" aria-hidden="true" /> {text}</h2>
  );

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <>
      <div className="fixed-controls" aria-label="Quick actions">
        <button type="button" className={`control-btn top-btn ${showUpBtn ? "top-btn--visible" : ""}`}
          onClick={scrollToTop} aria-label="Scroll to top" title="Back to top" tabIndex={showUpBtn ? 0 : -1}>
          <svg className="top-arrow" viewBox="0 0 24 24" fill="none">
            <path d="M12 18V7" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
            <path d="M7 12L12 7L17 12" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {currentView.kind === "home" && banners.length > 0 && !isTVMode && <HeroBanner banners={banners} onPlay={playMovie} />}

      <FilterPopup
        open={filterOpen} initialTab={filterTab} onClose={() => setFilterOpen(false)}
        genre={genreFilter} onGenreChange={setGenreFilter}
        lang={languageFilter} onLangChange={setLanguageFilter}
        year={yearFilter} onYearChange={setYearFilter}
        availableLanguages={availableLanguages} availableYears={availableYears}
        onApply={({ genre, lang, year }) => {
          if (genre) setGenreFilter(genre);
          if (lang)  setLanguageFilter(lang);
          if (year)  setYearFilter(year);
          setFilterOpen(false);
        }}
        onReset={() => { setGenreFilter([]); setLanguageFilter([]); setYearFilter([]); }}
      />

      <div className="movies-page">
        {currentView.kind === "home" && (
          <>
            <div id="search-section" className="search-bar" role="search">
              <input id="search-input" className="search-input" value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                placeholder={isListening ? "Listening…" : "Search movies, series, anime…"}
                aria-label="Search content" type="search" enterKeyHint="search"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} inputMode="search" />
              <div className="search-voice-group">
                <button type="button"
                  className={`mic-btn ${isListening ? "listening-active" : isProcessing ? "processing-active" : ""}`}
                  onClick={startVoice}
                  aria-label={isListening ? "Stop voice search" : "Start voice search"}
                  title={isListening ? "Stop listening" : "Voice search"}>
                  <svg viewBox="0 0 24 24" className="mic-icon" aria-hidden="true">
                    <path d="M12 14.5c1.93 0 3.5-1.57 3.5-3.5V5c0-1.93-1.57-3.5-3.5-3.5S8.5 3.07 8.5 5v6c0 1.93 1.57 3.5 3.5 3.5ZM7 9.5C7 6.46 9.46 4 12.5 4S18 6.46 18 9.5v1.5H17v-1.5C17 7.57 15.43 6 13.5 6S10 7.57 10 9.5v1.5H7V9.5Z" />
                    <path d="M19 11.5c0 3.38-2.71 6.15-6 6.46V20h2v2h-6v-2h2v-2.04c-3.29-.31-6-3.08-6-6.46h2c0 2.76 2.24 5 5 5s5-2.24 5-5h2Z" />
                  </svg>
                  {isProcessing && <span className="mic-spinner" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {(voiceHint || voiceError) && (
              <div className="voice-status-row" role="status" aria-live="polite">
                {voiceHint  && <div className="voice-hint">{voiceHint}</div>}
                {voiceError && <div className="voice-error">{voiceError}</div>}
              </div>
            )}

            <div className="filter-bar search-filter-gap" role="group" aria-label="Filter content">
              {[
                { tab: "language", list: languageFilter, cls: "teal", Icon: Globe,    label: getFilterLabel(languageFilter, "Language") },
                { tab: "genre",    list: genreFilter,    cls: "red",  Icon: Film,
                  label: !genreFilter.length ? "Genre" : genreFilter.length === 1
                    ? GENRES.find((g) => g.value === genreFilter[0])?.label || genreFilter[0] : `${genreFilter.length} Genres` },
                { tab: "year",     list: yearFilter,     cls: "gold", Icon: Calendar, label: getFilterLabel(yearFilter, "Year") },
              ].map(({ tab, list, cls, Icon, label }) => (
                <button key={tab} type="button"
                  className={`fp-trigger ${list.length ? `fp-trigger--active-${cls}` : ""}`}
                  onClick={() => { setFilterTab(tab); setFilterOpen(true); }}
                  aria-haspopup="dialog" aria-expanded={filterOpen && filterTab === tab}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="fp-trigger-label-wrap">
                    <span>{label}</span>
                    {list.length > 0 && <span className="fp-trigger-hint">Tap to change</span>}
                  </span>
                  {list.length > 0 && <span className="fp-trigger-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </>
        )}

        {!isDataLoaded ? (
          <section className="content-section" aria-busy="true">
            <h2 className="section-title">Loading…</h2>
            <div className="grid" onKeyDown={handleGridKeyDown}>
              {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </section>

        ) : selectedSeries ? (
          <section key="series-view" className="series-view-section slide-in-premium">
            <div className="series-view-header">
              <div className="series-view-poster"><img src={firstSeasonImg(selectedSeries.seasons)} alt={selectedSeries.seriesTitle} decoding="async" /></div>
              <div className="series-view-titles">
                <h2 className="series-view-title">{selectedSeries.seriesTitle}</h2>
                <div className="series-view-count">
                  {Object.keys(selectedSeries.seasons).length} Season{Object.keys(selectedSeries.seasons).length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>
            <div className="grid" onKeyDown={handleGridKeyDown}>
              {sortSeasons(selectedSeries.seasons).map(([sNum, eps], i) => {
                const lw = getLastWatchedEp(selectedSeries.seriesTitle, sNum);
                return (
                  <FocusCard key={sNum} className="card is-collection season-card-v2" style={{ "--i": i }}
                    data-card-id={cardId(`sv_${selectedSeries.titleKey}`, sNum)}
                    onClick={(e) => handleClick(e, () => handleOpenSeason(selectedSeries.seriesTitle, sNum, eps))}>
                    <PosterImg src={randomImg(eps)} alt={`Season ${sNum}`} eager={i < EAGER_COUNT} />
                    <div className="season-num-badge">Season {sNum}</div>
                    <div className="collection-badge">{eps.length} Ep{eps.length !== 1 ? "s" : ""}</div>
                    {lw && (
                      <button type="button" className="continue-play-btn" aria-label={`Continue from episode ${lw.episodeNum}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          resumeSeason(selectedSeries.seriesTitle, sNum, eps, {
                            seriesTitleKey: selectedSeries.titleKey, seriesDisplayName: selectedSeries.seriesTitle, seasonNum: sNum,
                          });
                        }}>
                        <span className="continue-play-icon" aria-hidden="true">▶</span>
                        <span className="continue-play-label">EP {lw.episodeNum}</span>
                      </button>
                    )}
                    <div className="card-info">
                      <h3>Season {sNum}</h3>
                      <p>{lw ? `Continue · EP ${lw.episodeNum}` : `${eps.length} Episode${eps.length !== 1 ? "s" : ""}`}</p>
                    </div>
                  </FocusCard>
                );
              })}
            </div>
          </section>

        ) : selectedSeason ? (() => {
          const sorted = sortEps(selectedSeason.episodes);
          const lw = getLastWatchedEp(selectedSeason.seriesTitle, selectedSeason.seasonNum);
          return (
            <section key="episode-list" className="collection-view slide-in-premium">
              <div className="season-header">
                <div className="season-breadcrumb">
                  <span className="season-breadcrumb-series">{selectedSeason.seriesTitle}</span>
                  <span className="season-breadcrumb-sep" aria-hidden="true">›</span>
                  <span className="season-breadcrumb-season">Season {selectedSeason.seasonNum}</span>
                </div>
                {lw && (
                  <button type="button" className="season-continue-pill season-continue-pill--btn"
                    aria-label={`Continue from episode ${lw.episodeNum}`}
                    onClick={() => resumeSeason(selectedSeason.seriesTitle, selectedSeason.seasonNum, selectedSeason.episodes)}>
                    <span className="scp-play" aria-hidden="true">▶</span>
                    <span>Continue · EP&nbsp;{lw.episodeNum}</span>
                  </button>
                )}
              </div>
              <div className="grid" onKeyDown={handleGridKeyDown}>
                {sorted.map((ep, i) => {
                  const isLastSeen = lw?.episodeId === ep.id;
                  return (
                    <FocusCard key={ep.id} className={`card episode-card${isLastSeen ? " last-seen-episode" : ""}`}
                      style={{ "--i": i }} data-card-id={cardId("ep", ep.id)}
                      onClick={(e) => handleClick(e, () => playMovie(ep, sorted, i))}>
                      <PosterImg src={ep.img} alt={ep.title} eager={i < EAGER_COUNT} />
                      <div className="ep-num-badge" aria-hidden="true">EP {ep.episode || "S"}</div>
                      {isLastSeen && (
                        <div className="last-seen-banner" aria-label="Continue watching">
                          <span className="lsb-play" aria-hidden="true">▶</span> Continue
                        </div>
                      )}
                      <div className="card-info">
                        <h3>{ep.title}</h3>
                        <p className={isLastSeen ? "ep-meta--continue" : ""}>
                          {isLastSeen ? "▶ Continue watching" : `Episode ${ep.episode || "Special"}`}
                        </p>
                      </div>
                    </FocusCard>
                  );
                })}
              </div>
            </section>
          );
        })() : selectedCollection ? (
          <section key="collection-view" className="collection-view slide-in-premium">
            <div className="season-header">
              <div className="season-breadcrumb">
                <span className="season-breadcrumb-series">{selectedCollection.name}</span>
                <span className="season-breadcrumb-sep" aria-hidden="true">›</span>
                <span className="season-breadcrumb-season">Collection</span>
              </div>
            </div>
            <div className="grid" onKeyDown={handleGridKeyDown}>
              {selectedCollection.items.map((m, i) => (
                <FocusCard key={m.id} className="card" style={{ "--i": i }} data-card-id={cardId("col", m.id)}
                  onClick={(e) => handleClick(e, () => playMovie(m))}>
                  <PosterImg src={m.img} alt={m.title} eager={i < EAGER_COUNT} />
                  <div className="card-info"><h3>{m.title}</h3><p>{m.year}</p></div>
                </FocusCard>
              ))}
            </div>
          </section>

        ) : (
          <div key="home-browse">
            {type === "movie"  && renderRecentSection("Recently Watched", recentWatched.movies, "movies")}
            {type === "series" && renderRecentSection("Recently Watched", recentWatched.series, "series")}
            {type === "anime"  && renderRecentSection("Recently Watched", recentWatched.anime,  "anime")}

            {(type === "all" || type === "movie") && movieGroups.length > 0 && (
              <section className="content-section">
                {sectionTitle(tvIcon, "Movies")}
                <div className="grid" onKeyDown={handleGridKeyDown}>{renderMovieGrid(movieGroups, "mg")}</div>
              </section>
            )}
            {(type === "all" || type === "series") && seriesGroups.length > 0 && (
              <section className="content-section">
                {sectionTitle(seriIcon, "Series")}
                <div className="grid" onKeyDown={handleGridKeyDown}>
                  {seriesGroups.map(([t, d], i) => renderSeriesCard(t, d, i))}
                </div>
              </section>
            )}
            {(type === "all" || type === "anime") && animeMovieGroups.length > 0 && (
              <section className="content-section">
                {sectionTitle(animeIcon, "Anime Movies")}
                <div className="grid" onKeyDown={handleGridKeyDown}>{renderMovieGrid(animeMovieGroups, "amg")}</div>
              </section>
            )}
            {(type === "all" || type === "anime") && animeSeriesGroups.length > 0 && (
              <section className="content-section">
                {sectionTitle(animeIcon, "Anime Series")}
                <div className="grid" onKeyDown={handleGridKeyDown}>
                  {animeSeriesGroups.map(([t, d], i) => renderSeriesCard(t, d, i))}
                </div>
              </section>
            )}
            {noResults && <NoResults img={NO_RESULTS_IMG[type] || NO_RESULTS_IMG.all} />}
          </div>
        )}
      </div>
    </>
  );
}