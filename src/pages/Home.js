import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";
import DeviceControl from "../plugins/deviceControl";
import "./Movies.css";
import noResultsAll    from "../assets/no-results-all.png";
import noResultsMovie  from "../assets/no-results-movie.png";
import noResultsSeries from "../assets/no-results-series.png";
import noResultsAnime  from "../assets/no-results-anime.png";

import { useSpatialNav } from "../hooks/useSpatialNav";

import tvIcon from "../assets/tv1.png";

// ─── Constants ────────────────────────────────────────────────────────────────
const NO_RESULTS_IMG = {
  all:    noResultsAll,
  movie:  noResultsMovie,
  series: noResultsSeries,
  anime:  noResultsAnime,
};
const POSTER_FALLBACK  = "https://via.placeholder.com/300x450";
const LAST_WATCHED_KEY = "ott_last_watched";

let _navStateId = 0;
const nextNavId = () => ++_navStateId;

// ─── Storage helpers ──────────────────────────────────────────────────────────
const ss = {
  get:     (k)    => { try { return sessionStorage.getItem(k); }              catch { return null; } },
  set:     (k, v) => { try { sessionStorage.setItem(k, v); }                 catch {} },
  del:     (k)    => { try { sessionStorage.removeItem(k); }                 catch {} },
  getJSON: (k)    => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  setJSON: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const ls = {
  getJSON: (k)    => { try { return JSON.parse(localStorage.getItem(k)); }   catch { return null; } },
  setJSON: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); }   catch {} },
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function randomImg(episodes) {
  const withImg = episodes.filter((e) => e.img);
  if (!withImg.length) return POSTER_FALLBACK;
  return withImg[Math.floor(Math.random() * withImg.length)].img;
}

const getScrollRoot = () =>
  document.querySelector(".content") || document.scrollingElement || document.documentElement;

const getPageScrollY = () => {
  const root = getScrollRoot();
  return root ? root.scrollTop : window.scrollY;
};

const scrollPageTo = (top, behavior = "auto") => {
  const root = getScrollRoot();
  if (root?.scrollTo) root.scrollTo({ top, left: 0, behavior });
  else window.scrollTo({ top, left: 0, behavior });
};

let restoreScrollToken = 0;

const restoreScrollAndFocus = (scrollY, focusId) => {
  const token   = ++restoreScrollToken;
  const targetY = Number(scrollY) || 0;
  const doIt = () => {
    if (token !== restoreScrollToken) return;
    scrollPageTo(targetY);
    if (focusId) {
      const el = document.querySelector(`[data-card-id="${focusId}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  };
  requestAnimationFrame(doIt);
  [60, 160, 350, 700, 1200].forEach((d) => setTimeout(doIt, d));
};

function triggerRipple(e, el) {
  const rect    = el.getBoundingClientRect();
  const size    = Math.max(rect.width, rect.height);
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? rect.left + rect.width  / 2;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? rect.top  + rect.height / 2;
  const x = clientX - rect.left - size / 2;
  const y = clientY - rect.top  - size / 2;
  const span = document.createElement("span");
  span.className = "ripple-wave";
  Object.assign(span.style, { width: `${size}px`, height: `${size}px`, left: `${x}px`, top: `${y}px` });
  el.appendChild(span);
  setTimeout(() => span.remove(), 650);
}

function getCreatedAt(item) {
  if (!item.createdAt) return 0;
  if (typeof item.createdAt.toMillis === "function") return item.createdAt.toMillis();
  if (item.createdAt instanceof Date) return item.createdAt.getTime();
  if (typeof item.createdAt === "number") return item.createdAt;
  if (item.createdAt.seconds != null) return item.createdAt.seconds * 1000;
  return 0;
}

function sortByYearThenCreatedAt(a, b) {
  const yearA = parseInt(a.year) || 0;
  const yearB = parseInt(b.year) || 0;
  if (yearB !== yearA) return yearB - yearA;
  return getCreatedAt(b) - getCreatedAt(a);
}

function groupSortKey(items) {
  return {
    year:      Math.max(...items.map((m) => parseInt(m.year) || 0)),
    createdAt: Math.max(...items.map(getCreatedAt)),
  };
}

function sortGroups(a, b) {
  const ka = groupSortKey(a[1]);
  const kb = groupSortKey(b[1]);
  if (kb.year !== ka.year) return kb.year - ka.year;
  return kb.createdAt - ka.createdAt;
}

// ─── Poster image with shimmer ────────────────────────────────────────────────
const PosterImg = React.memo(function PosterImg({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);
  const finalSrc = error || !src ? POSTER_FALLBACK : src;
  return (
    <div className="poster-wrap">
      {!loaded && <div className="poster-shimmer" aria-hidden="true" />}
      <img
        src={finalSrc} alt={alt}
        className={`poster-img ${loaded ? "poster-img--loaded" : "poster-img--loading"}`}
        onLoad={() => setLoaded(true)}
        onError={() => { setError(true); setLoaded(true); }}
        {...props}
      />
    </div>
  );
});

// ─── Skeleton / Loading / NoResults ───────────────────────────────────────────
const SkeletonCard = React.memo(function SkeletonCard() {
  return (
    <div className="card-skeleton">
      <div className="skel-img" /><div className="skel-title" /><div className="skel-sub" />
    </div>
  );
});

const PlayerLoading = React.memo(function PlayerLoading({ title }) {
  return (
    <div className="player-loading" role="status" aria-live="polite">
      <div className="player-loading-spinner" />
      <div className="player-loading-title"><strong>{title}</strong>Loading…</div>
    </div>
  );
});

const NoResults = React.memo(function NoResults({ img }) {
  return (
    <div className="no-results" role="status">
      <img src={img} alt="No results found" className="no-results-img" />
      <p>No items found.</p>
    </div>
  );
});

// ─── Hero Banner ──────────────────────────────────────────────────────────────
const HeroBanner = React.memo(function HeroBanner({ banners, onPlay }) {
  const [current, setCurrent]                 = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timerRef   = useRef(null);
  const pendingIdx = useRef(null);
  const pausedRef  = useRef(false);
  const bannerRef  = useRef(null);

  const goTo = useCallback((idx) => {
    if (isTransitioning) { pendingIdx.current = idx; return; }
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrent(idx);
      setIsTransitioning(false);
      if (pendingIdx.current !== null) {
        const n = pendingIdx.current; pendingIdx.current = null;
        setTimeout(() => goTo(n), 50);
      }
    }, 350);
  }, [isTransitioning]);

  const next = useCallback(() => { if (banners?.length) goTo((current + 1) % banners.length); }, [current, banners, goTo]);
  const prev = useCallback(() => goTo((current - 1 + banners.length) % banners.length), [current, banners.length, goTo]);

  const resetTimer = useCallback(() => {
    clearInterval(timerRef.current);
    if (banners.length > 1 && !pausedRef.current)
      timerRef.current = setInterval(next, 5000);
  }, [next, banners.length]);

  useEffect(() => { resetTimer(); return () => clearInterval(timerRef.current); }, [resetTimer]);
  useEffect(() => { setCurrent(0); }, [banners]);

  useEffect(() => {
    const el = bannerRef.current; if (!el) return;
    let sx = 0, moved = false;
    const ts = (e) => { sx = e.touches[0].clientX; moved = false; };
    const tm = () => { moved = true; };
    const te = (e) => {
      if (!moved) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) { if (dx < 0) next(); else prev(); resetTimer(); }
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove",  tm, { passive: true });
    el.addEventListener("touchend",   te);
    return () => { el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); };
  }, [next, prev, resetTimer]);

  if (!banners?.length) return null;
  const banner = banners[current];
  if (!banner) return null;
  const isAd = banner.description === "For Adevertiment Call";

  return (
    <div ref={bannerRef} className="hero-banner" role="region" aria-label="Featured content"
      onMouseEnter={() => { pausedRef.current = true;  clearInterval(timerRef.current); }}
      onMouseLeave={() => { pausedRef.current = false; resetTimer(); }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") { prev(); resetTimer(); } if (e.key === "ArrowRight") { next(); resetTimer(); } }}
      tabIndex={0}>
      <div className={`hero-bg ${isTransitioning ? "hero-bg--out" : "hero-bg--in"}`}
        style={{ backgroundImage: `url(${banner.image || banner.imageUrl})` }} />
      {!isAd && <div className="hero-overlay" />}
      <div className={`hero-content ${isTransitioning ? "hero-content--out" : "hero-content--in"}`}>
        {banner.logo
          ? <img src={banner.logo} alt={banner.title} className="hero-logo" />
          : <h1 className="hero-title">{banner.title}</h1>}
        {banner.description && !isAd && <p className="hero-desc">{banner.description}</p>}
        <div className="hero-meta">
          {banner.year     && <span className="hero-tag">{banner.year}</span>}
          {banner.language && <span className="hero-tag">{banner.language.toUpperCase()}</span>}
          {banner.genre    && <span className="hero-tag">{banner.genre}</span>}
        </div>
        {banner.movieRef && (
          <button className="hero-play-btn" onClick={() => onPlay?.(banner.movieRef)}
            aria-label={`Play ${banner.title}`}>
            <span className="hero-play-icon" aria-hidden="true">▶</span>Play Now
          </button>
        )}
      </div>
      {banners.length > 1 && (
        <>
          <button className="hero-nav hero-nav--prev" onClick={() => { prev(); resetTimer(); }} aria-label="Previous slide">‹</button>
          <button className="hero-nav hero-nav--next" onClick={() => { next(); resetTimer(); }} aria-label="Next slide">›</button>
          <div className="hero-dots" role="tablist">
            {banners.map((_, i) => (
              <button key={i} role="tab" aria-selected={i === current}
                className={`hero-dot ${i === current ? "hero-dot--active" : ""}`}
                onClick={() => { goTo(i); resetTimer(); }} aria-label={`Slide ${i + 1}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
});

// ─── Focusable card ───────────────────────────────────────────────────────────
const FocusCard = React.forwardRef(function FocusCard(
  { className, style, onClick, children, tabIndex = 0, "data-card-id": dataCardId }, ref
) {
  return (
    <div ref={ref} className={className} style={style} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
      tabIndex={tabIndex} data-card-id={dataCardId} role="button" aria-pressed="false">
      {children}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function Home({ type = "all" }) {
  const [movies, setMovies]             = useState([]);
  const [allBanners, setAllBanners]     = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const handleGridKeyDown               = useSpatialNav();

  const [languageFilter, setLanguageFilter] = useState("all");
  const [genreFilter,    setGenreFilter]    = useState("all");
  const [yearFilter,     setYearFilter]     = useState("all");
  const [search,         setSearch]         = useState("");

  const [isListening,  setIsListening]  = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceHint,    setVoiceHint]    = useState("");
  const [voiceError,   setVoiceError]   = useState("");

  const [lastWatched, setLastWatched] = useState(() => ls.getJSON(LAST_WATCHED_KEY) || {});

  const [showUpBtn,     setShowUpBtn]     = useState(false);
  const [viewStack,     setViewStack]     = useState([{ kind: "home" }]);
  const [playerLoading, setPlayerLoading] = useState(null);

  const navigate         = useNavigate();
  const savedScrollMap   = useRef({});
  const isNavigatingBack = useRef(false);
  const navIdRef         = useRef(0);
  const recognitionRef   = useRef(null);
  const silenceTimerRef  = useRef(null);

  const currentView        = viewStack[viewStack.length - 1];
  const selectedCollection = currentView.kind === "collection" ? currentView.data : null;
  const selectedSeason     = currentView.kind === "season"     ? currentView.data : null;

  // ── Up button ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = getScrollRoot();
    const fn   = () => setShowUpBtn(getPageScrollY() > 300);
    root.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => root.removeEventListener("scroll", fn);
  }, []);

  const scrollToTop = useCallback((e) => {
    triggerRipple(e, e.currentTarget);
    scrollPageTo(0, "smooth");
  }, []);

  const normalize   = useCallback((v) => String(v || "").toLowerCase().trim(), []);
  const naturalSort = useCallback(
    (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }), []
  );

  // ── TV/Android detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const ua = navigator.userAgent;
    const isAndroid = /android tv|googletv/i.test(ua) || (/android/i.test(ua) && /tv/i.test(ua));
    const isTV      = /tv|android tv|googletv|smarttv/i.test(ua);
    document.body.classList.remove("tv-mode", "android-mode");
    if (isAndroid) document.body.classList.add("android-mode", "tv-mode");
    else if (isTV) document.body.classList.add("tv-mode");
  }, []);

  // ── Firestore ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snap) => {
      setMovies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setIsDataLoaded(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "banners"), (snap) => {
      setAllBanners(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // ── Type helpers ─────────────────────────────────────────────────────────────
  const isMovieType  = useCallback((t) => ["movie", "movies"].includes(normalize(t)), [normalize]);
  const isSeriesType = useCallback((t) => ["series", "tv", "show"].includes(normalize(t)), [normalize]);
  const isAnimeType  = useCallback((t) => normalize(t) === "anime", [normalize]);
  const isAnimeGenre = useCallback((item) => normalize(item?.genre) === "anime", [normalize]);

  // ── Banners ───────────────────────────────────────────────────────────────────
  const banners = useMemo(() => {
    return allBanners
      .filter((b) => {
        if (b.active === false) return false;
        if (!b.image && !b.imageUrl) return false;
        const dn = normalize(b.description || "");
        const tn = normalize(b.title || "");
        if (dn.includes("advertisement") || dn.includes("adevertiment") || tn === "ad") return false;
        const bt = normalize(b.bannerType || "");
        const mr = b.movieRef || {};
        if (type === "movie") {
          if (bt) return bt === "movie" && bt !== "anime";
          return isMovieType(mr.type) && !isAnimeGenre(mr) && !isAnimeType(mr.type);
        }
        if (type === "series") {
          if (bt) return ["series", "tv", "show"].includes(bt) && bt !== "anime";
          return isSeriesType(mr.type) && !isAnimeGenre(mr);
        }
        if (type === "anime") {
          if (bt) return bt === "anime";
          return isAnimeType(mr.type) || isAnimeGenre(mr) || normalize(b.genre) === "anime";
        }
        return true;
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [allBanners, type, normalize, isMovieType, isSeriesType, isAnimeType, isAnimeGenre]);

  const matchesTab = useCallback((item) => {
    const c = normalize(item.type);
    if (type === "all")    return true;
    if (type === "movie")  return ["movie", "movies"].includes(c) && !isAnimeGenre(item);
    if (type === "series") return ["series", "tv", "show"].includes(c) && !isAnimeGenre(item);
    if (type === "anime")  return c === "anime" || isAnimeGenre(item);
    return true;
  }, [type, normalize, isAnimeGenre]);

  const isSimilar = (title, query) => {
    title = String(title || "").toLowerCase(); query = String(query || "").toLowerCase();
    let m = 0; for (const c of query) { if (title.includes(c)) m++; }
    return m / query.length > 0.7;
  };

  const passesFilters = useCallback((item, titleField = "title") => {
    const mL = languageFilter === "all" || normalize(item.language) === normalize(languageFilter);
    const mG = genreFilter    === "all" || normalize(item.genre)    === normalize(genreFilter);
    const mY = yearFilter     === "all" || String(item.year)        === String(yearFilter);
    const q  = normalize(search);
    const t  = normalize(item[titleField] || item.title);
    const mS = !q || t.includes(q) || isSimilar(t, q);
    return mL && mG && mY && mS;
  }, [languageFilter, genreFilter, yearFilter, search, normalize]);

  const searchScore = useCallback((title, query) => {
    const t = normalize(title), q = normalize(query);
    if (!q) return 0;
    if (t === q) return 10000;
    if (t.startsWith(q)) return 9000;
    if (t.split(" ").some(w => w.startsWith(q))) return 8000;
    if (t.includes(q)) return 7000;
    let s = 0; for (const c of q) { if (t.includes(c)) s++; } return s;
  }, [normalize]);

  // ── Movie groups ──────────────────────────────────────────────────────────────
  const movieGroups = useMemo(() => {
    const filtered = movies.filter(
      (item) => isMovieType(item.type) && !isAnimeGenre(item) && matchesTab(item) && passesFilters(item)
    );
    const groups = {};
    filtered.forEach((m) => {
      const base = m.collectionTitle?.trim() || m.title.split(/\s*[-–—]\s*\d|\d+/)[0].trim() || m.title;
      if (!groups[base]) groups[base] = [];
      groups[base].push(m);
    });
    return Object.entries(groups)
      .sort((a, b) => { if (search) { const sa = searchScore(a[0], search), sb = searchScore(b[0], search); if (sb !== sa) return sb - sa; } return sortGroups(a, b); })
      .map(([n, items]) => [n, [...items].sort(sortByYearThenCreatedAt)]);
  }, [movies, isMovieType, isAnimeGenre, matchesTab, passesFilters, search, searchScore]);

  // ── Series groups ─────────────────────────────────────────────────────────────
  const seriesGroups = useMemo(() => {
    const filtered = movies.filter(
      (item) => isSeriesType(item.type) && !isAnimeGenre(item) && matchesTab(item) && passesFilters(item, "seriesTitle")
    );
    const groups = {};
    filtered.forEach((item) => {
      const title  = normalize(item.seriesTitle || item.title || "Unknown Series");
      const season = String(item.season || "1");
      if (!groups[title]) groups[title] = { displayName: item.seriesTitle || item.title || "Unknown Series", seasons: {}, maxYear: 0, maxCreatedAt: 0 };
      const yr = parseInt(item.year) || 0, ca = getCreatedAt(item);
      if (yr > groups[title].maxYear) groups[title].maxYear = yr;
      if (ca > groups[title].maxCreatedAt) groups[title].maxCreatedAt = ca;
      if (!groups[title].seasons[season]) groups[title].seasons[season] = [];
      groups[title].seasons[season].push(item);
    });
    return Object.entries(groups).sort((a, b) => { if (b[1].maxYear !== a[1].maxYear) return b[1].maxYear - a[1].maxYear; return b[1].maxCreatedAt - a[1].maxCreatedAt; });
  }, [movies, isSeriesType, isAnimeGenre, matchesTab, passesFilters, normalize]);

  // ── Anime movie groups ────────────────────────────────────────────────────────
  const animeMovieGroups = useMemo(() => {
    const noEp = (ep) => ep === undefined || ep === null || ep === "" || ep === 0 || ep === "0";
    const filtered = movies.filter((item) => (isAnimeType(item.type) || isAnimeGenre(item)) && noEp(item.episode) && passesFilters(item));
    const groups = {};
    filtered.forEach((m) => {
      const base = m.collectionTitle?.trim() || m.title.split(/\s*[-–—]\s*\d|\d+/)[0].trim() || m.title;
      if (!groups[base]) groups[base] = [];
      groups[base].push(m);
    });
    return Object.entries(groups)
      .sort((a, b) => { if (search) { const sa = searchScore(a[0], search), sb = searchScore(b[0], search); if (sb !== sa) return sb - sa; } return sortGroups(a, b); })
      .map(([n, items]) => [n, [...items].sort(sortByYearThenCreatedAt)]);
  }, [movies, isAnimeType, isAnimeGenre, passesFilters, search, searchScore]);

  // ── Anime series groups ───────────────────────────────────────────────────────
  const animeSeriesGroups = useMemo(() => {
    const hasEp = (ep) => ep !== undefined && ep !== null && ep !== "" && ep !== 0 && ep !== "0";
    const filtered = movies.filter((item) => (isAnimeType(item.type) || isAnimeGenre(item)) && hasEp(item.episode) && passesFilters(item, "seriesTitle"));
    const groups = {};
    filtered.forEach((item) => {
      const title  = normalize(item.seriesTitle || item.title || "Unknown Series");
      const season = String(item.season || "1");
      if (!groups[title]) groups[title] = { displayName: item.seriesTitle || item.title || "Unknown Series", seasons: {}, maxYear: 0, maxCreatedAt: 0 };
      const yr = parseInt(item.year) || 0, ca = getCreatedAt(item);
      if (yr > groups[title].maxYear) groups[title].maxYear = yr;
      if (ca > groups[title].maxCreatedAt) groups[title].maxCreatedAt = ca;
      if (!groups[title].seasons[season]) groups[title].seasons[season] = [];
      groups[title].seasons[season].push(item);
    });
    return Object.entries(groups).sort((a, b) => { if (b[1].maxYear !== a[1].maxYear) return b[1].maxYear - a[1].maxYear; return b[1].maxCreatedAt - a[1].maxCreatedAt; });
  }, [movies, isAnimeType, isAnimeGenre, passesFilters, normalize]);

  // ── Last Watched helpers ──────────────────────────────────────────────────────
  const lwKey = useCallback((seriesTitle, seasonNum) =>
    `${normalize(seriesTitle)}_s${seasonNum}`, [normalize]);

  const getLastWatchedEp = useCallback((seriesTitle, seasonNum) =>
    lastWatched[lwKey(seriesTitle, seasonNum)] || null,
  [lastWatched, lwKey]);

  const saveLastWatched = useCallback((seriesTitle, seasonNum, episodeNum, episodeId) => {
    const updated = { ...lastWatched, [lwKey(seriesTitle, seasonNum)]: { episodeNum, episodeId } };
    setLastWatched(updated);
    ls.setJSON(LAST_WATCHED_KEY, updated);
  }, [lastWatched, lwKey]);

  // ── Navigation helpers ────────────────────────────────────────────────────────
  const saveCurrentState = useCallback(() => {
    savedScrollMap.current[navIdRef.current] = getPageScrollY();
    const focused = document.activeElement;
    if (focused?.dataset?.cardId) ss.set(`focus_${navIdRef.current}`, focused.dataset.cardId);
  }, []);

  const pushView = useCallback((newView) => {
    saveCurrentState();
    const newId = nextNavId();
    navIdRef.current = newId;
    window.history.pushState({ id: newId, kind: newView.kind }, "");
    setViewStack((prev) => [...prev, newView]);
    scrollPageTo(0);
  }, [saveCurrentState]);

  const popView = useCallback(() => {
    if (viewStack.length <= 1) return;
    isNavigatingBack.current = true;
    setViewStack((prev) => prev.slice(0, -1));
  }, [viewStack.length]);

  // ── Restore scroll after popView ─────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!isNavigatingBack.current) return;
    isNavigatingBack.current = false;
    const state   = window.history.state;
    const id      = state?.id ?? 0;
    navIdRef.current = id;
    const targetY = savedScrollMap.current[id] ?? 0;
    const focusId = ss.get(`focus_${id}`);
    const doRestore = () => {
      scrollPageTo(targetY);
      if (focusId) {
        const el = document.querySelector(`[data-card-id="${focusId}"]`);
        if (el) el.focus({ preventScroll: true });
      }
    };
    requestAnimationFrame(doRestore);
    [80, 200, 400, 800].forEach((d) => setTimeout(doRestore, d));
  }, [viewStack]);

  // ── Back button / popstate ────────────────────────────────────────────────────
  useEffect(() => {
    const onPop  = () => { if (viewStack.length > 1) popView(); };
    const onKey  = (e) => {
      // ESC, GoBack, Backspace (TV remote), Samsung back key
      const isBack =
        e.key === "Escape"   || e.key === "GoBack"   || e.key === "Backspace" ||
        e.keyCode === 27     || e.keyCode === 10009   || e.keyCode === 8;
      if (isBack && viewStack.length > 1) {
        e.preventDefault();
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown",  onKey);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); };
  }, [viewStack, popView]);

  // ── Restore state after returning from MoviePlayer ────────────────────────────
  useEffect(() => {
    if (!isDataLoaded) return;
    const savedState = ss.getJSON("ott_nav_state");
    if (!savedState) return;
    ss.del("ott_nav_state");

    const { kind, collectionName, seriesTitle, seasonNum, scrollY, focusId,
            parentScrollY, parentFocusId, filters } = savedState;

    try {
      if (filters?.language !== undefined) setLanguageFilter(filters.language);
      if (filters?.genre    !== undefined) setGenreFilter(filters.genre);
      if (filters?.year     !== undefined) setYearFilter(filters.year);
      if (filters?.search   !== undefined) setSearch(filters.search);
    } catch {}

    if (kind === "collection" && collectionName) {
      const group = movieGroups.find(([n]) => n === collectionName) ||
                    animeMovieGroups.find(([n]) => n === collectionName);
      if (group) {
        const id = nextNavId(); navIdRef.current = id;
        savedScrollMap.current[0] = Number(parentScrollY) || 0;
        if (parentFocusId) ss.set("focus_0", parentFocusId);
        window.history.replaceState({ id: 0, kind: "home" }, "");
        window.history.pushState({ id, kind: "collection" }, "");
        setViewStack([
          { kind: "home" },
          { kind: "collection", data: { name: group[0], items: group[1], parentScrollY, parentFocusId } },
        ]);
        restoreScrollAndFocus(scrollY, focusId);
        return;
      }
    }

    if (kind === "season" && seriesTitle && seasonNum) {
      const entry = [...seriesGroups, ...animeSeriesGroups].find(([t]) => t === normalize(seriesTitle));
      if (entry) {
        const eps = entry[1].seasons[seasonNum];
        if (eps) {
          const id = nextNavId(); navIdRef.current = id;
          savedScrollMap.current[0] = Number(parentScrollY) || 0;
          if (parentFocusId) ss.set("focus_0", parentFocusId);
          window.history.replaceState({ id: 0, kind: "home" }, "");
          window.history.pushState({ id, kind: "season" }, "");
          setViewStack([
            { kind: "home" },
            { kind: "season", data: {
                seriesTitle: entry[1].displayName || seriesTitle,
                seasonNum, episodes: eps, parentScrollY, parentFocusId
            }},
          ]);
          restoreScrollAndFocus(scrollY, focusId);
          return;
        }
      }
    }

    restoreScrollAndFocus(scrollY, focusId);
  }, [isDataLoaded, movieGroups, animeMovieGroups, seriesGroups, animeSeriesGroups, normalize]);

  // ── Auto-focus first card on TV ──────────────────────────────────────────────
  useEffect(() => {
    if (!isDataLoaded) return;
    requestAnimationFrame(() => {
      if (!document.body.classList.contains("tv-mode")) return;
      if (document.activeElement !== document.body) return;
      const first = document.querySelector("[data-card-id]");
      if (first) first.focus({ preventScroll: true });
    });
  }, [isDataLoaded, currentView.kind]);

  // ── Reset on tab change ──────────────────────────────────────────────────────
  useLayoutEffect(() => {
    setLanguageFilter("all"); setGenreFilter("all"); setYearFilter("all"); setSearch("");
    setViewStack([{ kind: "home" }]);
    navIdRef.current = 0;
    savedScrollMap.current = {};
    if (!ss.getJSON("ott_nav_state")) scrollPageTo(0);
  }, [type]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const handleOpenCollection = useCallback((name, items) => {
    pushView({ kind: "collection", data: {
      name, items,
      parentScrollY: getPageScrollY(),
      parentFocusId: document.activeElement?.dataset?.cardId || null,
    }});
  }, [pushView]);

  const handleOpenSeason = useCallback((seriesTitle, seasonNum, episodes) => {
    pushView({ kind: "season", data: {
      seriesTitle, seasonNum, episodes,
      parentScrollY: getPageScrollY(),
      parentFocusId: document.activeElement?.dataset?.cardId || null,
    }});
  }, [pushView]);

  const playMovie = useCallback((movie, playlist = null, currentIndex = 0) => {
    setPlayerLoading(movie.title);

    if (movie.episode !== undefined && movie.episode !== null && movie.episode !== "" &&
        movie.episode !== 0 && movie.episode !== "0") {
      const sTitle = movie.seriesTitle || movie.title;
      const sNum   = String(movie.season || "1");
      if (sTitle) saveLastWatched(sTitle, sNum, movie.episode, movie.id);
    }

    let finalPlaylist    = playlist;
    let finalIndex       = currentIndex;
    if (!finalPlaylist && movie.type !== "movie") {
      const sKey  = normalize(movie.seriesTitle || movie.title);
      const sNum  = String(movie.season || "1");
      const entry = [...seriesGroups, ...animeSeriesGroups].find(([t]) => t === sKey);
      if (entry) {
        finalPlaylist = entry[1].seasons[sNum];
        finalIndex    = finalPlaylist ? finalPlaylist.findIndex(ep => ep.id === movie.id) : 0;
        if (finalIndex === -1) finalIndex = 0;
      }
    }

    const navState = {
      kind:           currentView.kind,
      collectionName: currentView.kind === "collection" ? currentView.data?.name           : null,
      seriesTitle:    currentView.kind === "season"     ? normalize(currentView.data?.seriesTitle) : null,
      seasonNum:      currentView.kind === "season"     ? currentView.data?.seasonNum       : null,
      parentScrollY:  currentView.data?.parentScrollY   ?? null,
      parentFocusId:  currentView.data?.parentFocusId   ?? null,
      scrollY:        getPageScrollY(),
      focusId:        document.activeElement?.dataset?.cardId || null,
      filters: { language: languageFilter, genre: genreFilter, year: yearFilter, search },
    };
    ss.setJSON("ott_nav_state", navState);

    setTimeout(() => {
      navigate("/player", { state: { movie, playlist: finalPlaylist, currentIndex: finalIndex } });
    }, 700);
  }, [navigate, currentView, languageFilter, genreFilter, yearFilter, search,
      seriesGroups, animeSeriesGroups, normalize, saveLastWatched]);

  // ── Voice search ──────────────────────────────────────────────────────────────
  const requestMic = useCallback(async () => {
    setVoiceError("");
    if (typeof DeviceControl?.requestMicrophonePermissionNative === "function") {
      try { if (await DeviceControl.requestMicrophonePermissionNative()) return true; } catch {}
    }
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try { const s = await navigator.permissions.query({ name: "microphone" }); if (s.state === "granted") return true; if (s.state === "denied") return false; } catch {}
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
    if (!await requestMic()) { setVoiceError("Microphone access is required for voice search."); return; }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = false; rec.interimResults = true;
    const lang = navigator.language || "en-US";
    rec.lang = lang.startsWith("ta") ? "ta-IN" : lang.startsWith("en") ? lang : "en-US";
    rec.onstart  = () => { setIsListening(true); setIsProcessing(false); setVoiceHint("Listening..."); setVoiceError(""); };
    rec.onresult = (ev) => {
      let interim = "", final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0]?.transcript || "";
        if (ev.results[i].isFinal) final += t; else interim += t;
      }
      const text = (final || interim).trim();
      if (text) setSearch(text);
      if (final) { setIsProcessing(true); setVoiceHint("Processing..."); } else { setIsProcessing(false); setVoiceHint("Listening..."); }
      scheduleSilence();
    };
    rec.onerror  = (ev) => { setVoiceError(ev.error === "not-allowed" || ev.error === "service-not-allowed" ? "Microphone permission denied." : "Voice recognition failed. Try again."); stopVoice(); };
    rec.onend    = () => { setIsListening(false); setIsProcessing(false); setVoiceHint(""); recognitionRef.current = null; };
    try { rec.start(); } catch { setVoiceError("Unable to start voice recognition."); stopVoice(); }
  }, [requestMic, scheduleSilence, stopVoice]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  const handleClick = (e, action) => {
    restoreScrollToken += 1;
    e.currentTarget?.focus?.({ preventScroll: true });
    triggerRipple(e, e.currentTarget);
    action();
  };

  // ── Filter options ────────────────────────────────────────────────────────────
  const availableLanguages = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => normalize(m.language)))].filter(Boolean).sort(),
  [movies, matchesTab, normalize]);

  const availableGenres = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => normalize(m.genre)))].filter(Boolean).sort(),
  [movies, matchesTab, normalize]);

  const availableYears = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => m.year))].filter(Boolean).sort((a, b) => b - a),
  [movies, matchesTab]);

  const noResults =
    isDataLoaded &&
    movieGroups.length === 0 && seriesGroups.length === 0 &&
    animeMovieGroups.length === 0 && animeSeriesGroups.length === 0;

  const cardId = (prefix, id) => `${prefix}_${id}`;

  // ── Render: movie grid ────────────────────────────────────────────────────────
  const renderMovieGrid = (groups, prefix = "m") =>
    groups.map(([name, items], i) => {
      const cid = cardId(prefix, items[0].id);
      return (
        <FocusCard key={name} className={`card ${items.length > 1 ? "is-collection" : ""}`}
          style={{ "--i": i }} data-card-id={cid}
          onClick={(e) => handleClick(e, () =>
            items.length > 1 ? handleOpenCollection(name, items) : playMovie(items[0])
          )}>
          <PosterImg src={items[0].img} alt={name} loading="eager" fetchPriority="high" />
          {items.length > 1 && <div className="collection-badge">{items.length} Parts</div>}
          <div className="card-info">
            <h3>{items.length > 1 ? `${name} (Collection)` : items[0].title}</h3>
            <p>{items.length > 1 ? "Multi-Part Series" : `${items[0].language} • ${items[0].year}`}</p>
          </div>
        </FocusCard>
      );
    });

  // ── Render: series section ────────────────────────────────────────────────────
  const renderSeriesSection = (titleKey, data) => {
    const seriesTitle = data.displayName || titleKey;
    const seasons     = Object.entries(data.seasons).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    return (
      <section key={titleKey} className="series-section">
        <h2 className="series-main-title">{seriesTitle}</h2>
        <div className="grid" onKeyDown={handleGridKeyDown}>
          {seasons.map(([sNum, eps], i) => {
            const cid   = cardId(`s_${titleKey}`, sNum);
            const lw    = getLastWatchedEp(seriesTitle, sNum);
            const img   = randomImg(eps);
            const total = eps.length;
            return (
              <FocusCard key={sNum} className="card is-collection season-card" style={{ "--i": i }}
                data-card-id={cid}
                onClick={(e) => handleClick(e, () => handleOpenSeason(seriesTitle, sNum, eps))}>
                <PosterImg src={img} alt={`Season ${sNum}`} />
                {/* Episode count — top right */}
                <div className="collection-badge">{total} Ep{total !== 1 ? "s" : ""}</div>
                {/* Last watched chip — top left */}
                {lw && (
                  <div className="last-watched-badge" aria-label={`Last watched episode ${lw.episodeNum}`}>
                    <span className="lw-dot" aria-hidden="true" />EP {lw.episodeNum}
                  </div>
                )}
                <div className="card-info">
                  <h3>Season {sNum}</h3>
                  <p>{lw ? `Continue · EP ${lw.episodeNum}` : `${total} Episode${total !== 1 ? "s" : ""}`}</p>
                </div>
              </FocusCard>
            );
          })}
        </div>
      </section>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <>
      {playerLoading && <PlayerLoading title={playerLoading} />}

      {/* Scroll-to-top button */}
      <div className="fixed-controls" aria-label="Quick actions">
        <button className={`control-btn top-btn ${showUpBtn ? "top-btn--visible" : ""}`}
          onClick={scrollToTop} aria-label="Scroll to top" title="Back to top">
          <span className="fire" />
          <svg className="top-arrow" viewBox="0 0 24 24" fill="none">
            <path d="M12 18V7" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
            <path d="M7 12L12 7L17 12" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Hero — home only */}
      {currentView.kind === "home" && banners.length > 0 && (
        <HeroBanner banners={banners} onPlay={playMovie} />
      )}

      <div className="movies-page">

        {/* Search + Filters — home only */}
        {currentView.kind === "home" && (
          <>
            <div id="search-section" className="search-bar" role="search">
              <input id="search-input" className="search-input" value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                placeholder={isListening ? "Listening…" : "Search movies, series, anime…"}
                aria-label="Search content" type="search" enterKeyHint="search" />
              <div className="search-voice-group">
                <button className={`mic-btn ${isListening ? "listening-active" : isProcessing ? "processing-active" : ""}`}
                  onClick={startVoice}
                  aria-label={isListening ? "Stop voice search" : "Start voice search"}
                  title={isListening ? "Stop listening" : "Voice search"} type="button">
                  <svg viewBox="0 0 24 24" className="mic-icon" aria-hidden="true">
                    <path d="M12 14.5c1.93 0 3.5-1.57 3.5-3.5V5c0-1.93-1.57-3.5-3.5-3.5S8.5 3.07 8.5 5v6c0 1.93 1.57 3.5 3.5 3.5ZM7 9.5C7 6.46 9.46 4 12.5 4S18 6.46 18 9.5v1.5H17v-1.5C17 7.57 15.43 6 13.5 6S10 7.57 10 9.5v1.5H7V9.5Z" />
                    <path d="M19 11.5c0 3.38-2.71 6.15-6 6.46V20h2v2h-6v-2h2v-2.04c-3.29-.31-6-3.08-6-6.46h2c0 2.76 2.24 5 5 5s5-2.24 5-5h2Z" />
                  </svg>
                  {isProcessing && <span className="mic-spinner" aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div className="voice-status-row">
              {voiceHint && <div className="voice-hint">{voiceHint}</div>}
              {voiceError && <div className="voice-error">{voiceError}</div>}
            </div>
            <div className="filter-bar" role="group" aria-label="Filter content">
              <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)} aria-label="Filter by language">
                <option value="all">All Languages</option>
                {availableLanguages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
              <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)} aria-label="Filter by genre">
                <option value="all">All </option>
                {availableGenres.map((g) => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
              </select>
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="Filter by year">
                <option value="all">All Years</option>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Content */}
        {!isDataLoaded ? (
          <section className="content-section" aria-busy="true" aria-label="Loading content">
            <h2 className="section-title">Loading…</h2>
            <div className="grid" onKeyDown={handleGridKeyDown}>
              {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </section>

        ) : selectedSeason ? (
          /* ── Episode list ─────────────────────────────────────────────────── */
          <section key="episode-list" className="collection-view slide-in-premium">
            {/* ── Breadcrumb header — NO back button, nav via gesture/Escape/remote ── */}
            <div className="season-header">
              <div className="season-breadcrumb">
                <span className="season-breadcrumb-series">{selectedSeason.seriesTitle}</span>
                <span className="season-breadcrumb-sep" aria-hidden="true">›</span>
                <span className="season-breadcrumb-season">Season {selectedSeason.seasonNum}</span>
              </div>
              {/* Last-watched pill shown at header level for quick context */}
              {(() => {
                const lw = getLastWatchedEp(selectedSeason.seriesTitle, selectedSeason.seasonNum);
                return lw ? (
                  <div className="season-continue-pill" aria-label={`Last watched episode ${lw.episodeNum}`}>
                    <span className="scp-play" aria-hidden="true">▶</span>
                    <span>Continue · EP&nbsp;{lw.episodeNum}</span>
                  </div>
                ) : null;
              })()}
            </div>

            <div className="grid" onKeyDown={handleGridKeyDown}>
              {(() => {
                const sorted = [...selectedSeason.episodes].sort(
                  (a, b) => naturalSort(String(a.episode), String(b.episode))
                );
                const lw = getLastWatchedEp(selectedSeason.seriesTitle, selectedSeason.seasonNum);
                return sorted.map((ep, i) => {
                  const cid        = cardId("ep", ep.id);
                  const isLastSeen = lw?.episodeId === ep.id;
                  return (
                    <FocusCard key={ep.id}
                      className={`card episode-card${isLastSeen ? " last-seen-episode" : ""}`}
                      style={{ "--i": i }} data-card-id={cid}
                      onClick={(e) => handleClick(e, () => playMovie(ep, sorted, i))}>
                      <PosterImg src={ep.img} alt={ep.title} loading="eager" />
                      {/* Episode number chip — top left corner */}
                      <div className="ep-num-badge" aria-hidden="true">
                        EP {ep.episode || "S"}
                      </div>
                      {/* Continue banner overlaid at bottom of poster */}
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
                });
              })()}
            </div>
          </section>

        ) : selectedCollection ? (
          /* ── Movie collection ─────────────────────────────────────────────── */
          <section key="collection-view" className="collection-view slide-in-premium">
            {/* Breadcrumb — no back button */}
            <div className="season-header">
              <div className="season-breadcrumb">
                <span className="season-breadcrumb-series">{selectedCollection.name}</span>
                <span className="season-breadcrumb-sep" aria-hidden="true">›</span>
                <span className="season-breadcrumb-season">Collection</span>
              </div>
            </div>
            <div className="grid" onKeyDown={handleGridKeyDown}>
              {selectedCollection.items.map((m, i) => (
                <FocusCard key={m.id} className="card" style={{ "--i": i }}
                  data-card-id={cardId("col", m.id)}
                  onClick={(e) => handleClick(e, () => playMovie(m))}>
                  <PosterImg src={m.img} alt={m.title} loading="eager" />
                  <div className="card-info"><h3>{m.title}</h3><p>{m.year}</p></div>
                </FocusCard>
              ))}
            </div>
          </section>

        ) : (
          /* ── Home browse ──────────────────────────────────────────────────── */
          <div key="home-browse">
            {(type === "all" || type === "movie") && movieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon} alt="" className="section-icon" aria-hidden="true" /> Movies
                </h2>
                <div className="grid" onKeyDown={handleGridKeyDown}>{renderMovieGrid(movieGroups, "mg")}</div>
              </section>
            )}

            {(type === "all" || type === "series") && seriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon} alt="" className="section-icon" aria-hidden="true" /> Series
                </h2>
                {seriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
              </section>
            )}

            {(type === "all" || type === "anime") && animeMovieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon} alt="" className="section-icon" aria-hidden="true" /> Anime Movies
                </h2>
                <div className="grid" onKeyDown={handleGridKeyDown}>{renderMovieGrid(animeMovieGroups, "amg")}</div>
              </section>
            )}

            {(type === "all" || type === "anime") && animeSeriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon} alt="" className="section-icon" aria-hidden="true" /> Anime Series
                </h2>
                {animeSeriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
              </section>
            )}

            {noResults && <NoResults img={NO_RESULTS_IMG[type] || NO_RESULTS_IMG.all} />}
          </div>
        )}
      </div>
    </>
  );
}