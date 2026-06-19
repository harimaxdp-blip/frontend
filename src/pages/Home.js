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

const NO_RESULTS_IMG = {
  all:     noResultsAll,
  movie:   noResultsMovie,
  series:  noResultsSeries,
  anime:   noResultsAnime,
};
const POSTER_FALLBACK  = "https://via.placeholder.com/300x450";
const LAST_WATCHED_KEY = "ott_last_watched";
const RECENT_KEY       = "hm_recent";
const RECENT_LIMIT     = 10;
const ANDROID_LW_PREFS = "hm_last_watched";

let _navStateId = 0;
const nextNavId = () => ++_navStateId;

const ss = {
  get:     (k)    => { try { return sessionStorage.getItem(k); }              catch { return null; } },
  set:     (k, v) => { try { sessionStorage.setItem(k, v); }                  catch {} },
  del:     (k)    => { try { sessionStorage.removeItem(k); }                  catch {} },
  getJSON: (k)    => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  setJSON: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ls = {
  getJSON: (k)    => { try { return JSON.parse(localStorage.getItem(k)); }   catch { return null; } },
  setJSON: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); }   catch {} },
};

function readAndroidLastWatched() {
  try {
    if (window.HariMovies && typeof window.HariMovies.getSharedPrefAll === "function") {
      const raw = window.HariMovies.getSharedPrefAll(ANDROID_LW_PREFS);
      if (raw) {
        const map = JSON.parse(raw);
        const result = {};
        for (const [k, v] of Object.entries(map)) {
          try { result[k] = JSON.parse(v); } catch {}
        }
        return result;
      }
    }
  } catch (e) { console.warn("HariMovies bridge read failed:", e); }
  return ls.getJSON(LAST_WATCHED_KEY) || {};
}

function detectIsTV() {
  const ua = navigator.userAgent;
  return /android tv|googletv|smarttv|tv/i.test(ua) ||
    (/android/i.test(ua) && /tv/i.test(ua)) ||
    document.body.classList.contains("tv-mode") ||
    document.body.classList.contains("android-mode");
}

function randomImg(episodes) {
  const withImg = episodes.filter((e) => e.img);
  if (!withImg.length) return POSTER_FALLBACK;
  return withImg[Math.floor(Math.random() * withImg.length)].img;
}

function firstSeasonImg(seasons) {
  const entries = Object.entries(seasons || {}).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  const firstSeason = entries.find(([s]) => String(s) === "1") || entries[0];
  if (!firstSeason) return POSTER_FALLBACK;
  const sorted = [...firstSeason[1]].sort((a, b) =>
    String(a.episode || "").localeCompare(String(b.episode || ""), undefined, { numeric: true, sensitivity: "base" })
  );
  return sorted.find((ep) => ep.img)?.img || randomImg(firstSeason[1]);
}

const getScrollRoot = () =>
  document.querySelector(".content") || document.scrollingElement || document.documentElement;
const getPageScrollY = () => { const r = getScrollRoot(); return r ? r.scrollTop : window.scrollY; };
const scrollPageTo = (top, behavior = "auto") => {
  const r = getScrollRoot();
  if (r?.scrollTo) r.scrollTo({ top, left: 0, behavior });
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
      if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" }); }
    }
  };
  requestAnimationFrame(doIt);
  [60, 160, 350, 700, 1200].forEach((d) => setTimeout(doIt, d));
};

function triggerRipple(e, el) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? rect.left + rect.width  / 2;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? rect.top  + rect.height / 2;
  const span = document.createElement("span");
  span.className = "ripple-wave";
  Object.assign(span.style, {
    width: `${size}px`, height: `${size}px`,
    left: `${clientX - rect.left - size / 2}px`,
    top:  `${clientY - rect.top  - size / 2}px`,
  });
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
  const yA = parseInt(a.year) || 0, yB = parseInt(b.year) || 0;
  if (yB !== yA) return yB - yA;
  return getCreatedAt(b) - getCreatedAt(a);
}

function groupSortKey(items) {
  return {
    year:       Math.max(...items.map((m) => parseInt(m.year) || 0)),
    createdAt: Math.max(...items.map(getCreatedAt)),
  };
}

function sortGroups(a, b) {
  const ka = groupSortKey(a[1]), kb = groupSortKey(b[1]);
  if (kb.year !== ka.year) return kb.year - ka.year;
  return kb.createdAt - ka.createdAt;
}

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
    style={{ width: "14px", height: "14px", display: "block" }}>
    <path d="M3 6H5H21" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6M19 6L18.1245 19.1334C18.0544 20.1954 17.1818 21 16.1168 21H7.88316C6.81824 21 5.94558 20.1954 5.87546 19.1334L5 6H19Z"
      stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 11V17" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    <path d="M14 11V17" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const PosterImg = React.memo(function PosterImg({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);
  const finalSrc = error || !src ? POSTER_FALLBACK : src;
  return (
    <div className="poster-wrap">
      {!loaded && <div className="poster-shimmer" aria-hidden="true" />}
      <img src={finalSrc} alt={alt}
        className={`poster-img ${loaded ? "poster-img--loaded" : "poster-img--loading"}`}
        onLoad={() => setLoaded(true)}
        onError={() => { setError(true); setLoaded(true); }}
        {...props}
      />
    </div>
  );
});

const SkeletonCard = React.memo(function SkeletonCard() {
  return (
    <div className="card-skeleton">
      <div className="skel-img" /><div className="skel-title" /><div className="skel-sub" />
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
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove",  tm);
      el.removeEventListener("touchend",   te);
    };
  }, [next, prev, resetTimer]);

  if (!banners?.length) return null;
  const banner = banners[current];
  if (!banner) return null;
  const isAd = banner.description === "For Adevertiment Call";

  return (
    <div ref={bannerRef} className="hero-banner" role="region" aria-label="Featured content"
      onMouseEnter={() => { pausedRef.current = true;  clearInterval(timerRef.current); }}
      onMouseLeave={() => { pausedRef.current = false; resetTimer(); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft")  { prev(); resetTimer(); }
        if (e.key === "ArrowRight") { next(); resetTimer(); }
      }}
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
          <button className="hero-nav hero-nav--prev" onClick={() => { prev(); resetTimer(); }} aria-label="Previous">‹</button>
          <button className="hero-nav hero-nav--next" onClick={() => { next(); resetTimer(); }} aria-label="Next">›</button>
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

export default function Home({ type = "all" }) {
  const [movies, setMovies]             = useState([]);
  const [allBanners, setAllBanners]     = useState([]);
  const [filterOpen, setFilterOpen]     = useState(false);
  const [filterTab, setFilterTab]       = useState("language"); // Updated order default
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const handleGridKeyDown               = useSpatialNav();

  const [isTV, setIsTV] = useState(() => detectIsTV());

  // Changed filter states to arrays to support multiple selections
  const [languageFilter, setLanguageFilter] = useState([]);
  const [genreFilter,    setGenreFilter]    = useState([]);
  const [yearFilter,     setYearFilter]     = useState([]);
  const [search,         setSearch]         = useState("");

  const [isListening,  setIsListening]  = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceHint,    setVoiceHint]    = useState("");
  const [voiceError,   setVoiceError]   = useState("");

  const [lastWatched, setLastWatched] = useState(() => {
    const a = readAndroidLastWatched(), l = ls.getJSON(LAST_WATCHED_KEY) || {};
    return { ...l, ...a };
  });

  const [recentWatched, setRecentWatched] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || { movies: [], series: [], anime: [] }; }
    catch { return { movies: [], series: [], anime: [] }; }
  });

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

  useEffect(() => {
    const ua = navigator.userAgent;
    const isAndroid = /android tv|googletv/i.test(ua) || (/android/i.test(ua) && /tv/i.test(ua));
    const isTVDev   = /tv|android tv|googletv|smarttv/i.test(ua);
    document.body.classList.remove("tv-mode", "android-mode");
    if (isAndroid)      { document.body.classList.add("android-mode", "tv-mode"); setIsTV(true); }
    else if (isTVDev)   { document.body.classList.add("tv-mode"); setIsTV(true); }
    else                { setIsTV(false); }
  }, []);

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      const a = readAndroidLastWatched();
      if (!a || !Object.keys(a).length) return;
      setLastWatched((prev) => {
        const merged  = { ...prev, ...a };
        const changed = Object.entries(a).some(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v));
        if (changed) { ls.setJSON(LAST_WATCHED_KEY, merged); return merged; }
        return prev;
      });
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    sync();
    return () => { document.removeEventListener("visibilitychange", sync); window.removeEventListener("focus", sync); };
  }, []);

  useEffect(() => {
    const root = getScrollRoot();
    const fn   = () => setShowUpBtn(getPageScrollY() > 300);
    root.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => root.removeEventListener("scroll", fn);
  }, []);

  const scrollToTop = useCallback((e) => { triggerRipple(e, e.currentTarget); scrollPageTo(0, "smooth"); }, []);

  const normalize   = useCallback((v) => String(v || "").toLowerCase().trim(), []);
  const naturalSort = useCallback((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }), []);

  useEffect(() => {
    const u = onSnapshot(collection(db, "movies"), (snap) => {
      setMovies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setIsDataLoaded(true);
    });
    return () => u();
  }, []);

  useEffect(() => {
    const u = onSnapshot(collection(db, "banners"), (snap) => {
      setAllBanners(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => u();
  }, []);

  const isMovieType  = useCallback((t) => ["movie", "movies"].includes(normalize(t)), [normalize]);
  const isSeriesType = useCallback((t) => ["series", "tv", "show"].includes(normalize(t)), [normalize]);
  const isAnimeType  = useCallback((t) => normalize(t) === "anime", [normalize]);
  const isAnimeGenre = useCallback((item) => normalize(item?.genre) === "anime", [normalize]);

  const banners = useMemo(() => {
    return allBanners.filter((b) => {
      if (b.active === false) return false;
      if (!b.image && !b.imageUrl) return false;
      const dn = normalize(b.description || ""), tn = normalize(b.title || "");
      if (dn.includes("advertisement") || dn.includes("adevertiment") || tn === "ad") return false;
      const bt = normalize(b.bannerType || ""), mr = b.movieRef || {};
      if (type === "movie")  { if (bt) return bt === "movie" && bt !== "anime"; return isMovieType(mr.type) && !isAnimeGenre(mr) && !isAnimeType(mr.type); }
      if (type === "series") { if (bt) return ["series","tv","show"].includes(bt) && bt !== "anime"; return isSeriesType(mr.type) && !isAnimeGenre(mr); }
      if (type === "anime")  { if (bt) return bt === "anime"; return isAnimeType(mr.type) || isAnimeGenre(mr) || normalize(b.genre) === "anime"; }
      return true;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [allBanners, type, normalize, isMovieType, isSeriesType, isAnimeType, isAnimeGenre]);

  const matchesTab = useCallback((item) => {
    const c = normalize(item.type);
    if (type === "all")    return true;
    if (type === "movie")  return ["movie","movies"].includes(c) && !isAnimeGenre(item);
    if (type === "series") return ["series","tv","show"].includes(c) && !isAnimeGenre(item);
    if (type === "anime")  return c === "anime" || isAnimeGenre(item);
    return true;
  }, [type, normalize, isAnimeGenre]);

  const isSimilar = (title, query) => {
    title = String(title || "").toLowerCase(); query = String(query || "").toLowerCase();
    let m = 0; for (const c of query) { if (title.includes(c)) m++; }
    return m / query.length > 0.7;
  };

  // Adjusted filtering to accommodate multiple matching elements
  const passesFilters = useCallback((item, titleField = "title") => {
    const mL = languageFilter.length === 0 || languageFilter.includes(normalize(item.language));
    const mG = genreFilter.length === 0 || genreFilter.includes(normalize(item.genre));
    const mY = yearFilter.length === 0 || yearFilter.includes(String(item.year));
    const q  = normalize(search), t = normalize(item[titleField] || item.title);
    return mL && mG && mY && (!q || t.includes(q) || isSimilar(t, q));
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

  const movieGroups = useMemo(() => {
    const filtered = movies.filter((i) => isMovieType(i.type) && !isAnimeGenre(i) && matchesTab(i) && passesFilters(i));
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

  const buildSeriesGroups = useCallback((filterFn) => {
    const filtered = movies.filter(filterFn);
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
  }, [movies, normalize]);

  const seriesGroups = useMemo(() =>
    buildSeriesGroups((i) => isSeriesType(i.type) && !isAnimeGenre(i) && matchesTab(i) && passesFilters(i, "seriesTitle")),
  [buildSeriesGroups, isSeriesType, isAnimeGenre, matchesTab, passesFilters]);

  const animeMovieGroups = useMemo(() => {
    const noEp = (ep) => ep === undefined || ep === null || ep === "" || ep === 0 || ep === "0";
    const filtered = movies.filter((i) => (isAnimeType(i.type) || isAnimeGenre(i)) && noEp(i.episode) && passesFilters(i));
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

  const animeSeriesGroups = useMemo(() => {
    const hasEp = (ep) => ep !== undefined && ep !== null && ep !== "" && ep !== 0 && ep !== "0";
    return buildSeriesGroups((i) => (isAnimeType(i.type) || isAnimeGenre(i)) && hasEp(i.episode) && passesFilters(i, "seriesTitle"));
  }, [buildSeriesGroups, isAnimeType, isAnimeGenre, passesFilters]);

  const lwKey = useCallback((seriesTitle, seasonNum) => {
    const s = !seasonNum || seasonNum === "0" || seasonNum === 0 ? "1" : String(seasonNum);
    return `${normalize(seriesTitle)}_s${s}`;
  }, [normalize]);

  const getLastWatchedEp = useCallback(
    (seriesTitle, seasonNum) => lastWatched[lwKey(seriesTitle, seasonNum)] || null,
    [lastWatched, lwKey]
  );

  const saveLastWatched = useCallback((seriesTitle, seasonNum, episodeNum, episodeId) => {
    const s   = !seasonNum || seasonNum === "0" || seasonNum === 0 ? "1" : String(seasonNum);
    const key = lwKey(seriesTitle, s);
    setLastWatched((prev) => {
      const updated = { ...prev, [key]: { episodeNum, episodeId } };
      ls.setJSON(LAST_WATCHED_KEY, updated);
      return updated;
    });
  }, [lwKey]);

  const addRecentWatched = useCallback((movie) => {
    const isAnimeItem  = movie.type === "anime" || normalize(movie.genre) === "anime";
    const isMovieItem  = ["movie", "movies"].includes(normalize(movie.type)) && !isAnimeItem;
    const isEpisode    = movie.episode !== undefined && movie.episode !== null &&
                         movie.episode !== "" && movie.episode !== 0 && movie.episode !== "0";

    const category = isAnimeItem ? "anime" : isMovieItem ? "movies" : "series";
    const entryId = isEpisode ? normalize(movie.seriesTitle || movie.title) : movie.id;

    const entry = isEpisode
      ? {
          id:             entryId,
          realId:         movie.id,
          title:          movie.seriesTitle || movie.title,
          seriesTitle:    movie.seriesTitle || movie.title,
          img:            movie.img,
          type:           movie.type,
          genre:          movie.genre,
          year:           movie.year,
          lastEpisodeId:  movie.id,
          lastEpisodeNum: movie.episode,
          lastSeason:     String(movie.season || "1"),
        }
      : { ...movie };

    setRecentWatched((prev) => {
      const filtered = (prev[category] || []).filter((x) => x.id !== entryId);
      const updated  = { ...prev, [category]: [entry, ...filtered].slice(0, RECENT_LIMIT) };
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [normalize]);

  const deleteRecentWatched = useCallback((category, itemId) => {
    setRecentWatched((prev) => {
      const updated = { ...prev, [category]: (prev[category] || []).filter((x) => x.id !== itemId) };
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const saveCurrentScrollAndFocus = useCallback(() => {
    savedScrollMap.current[navIdRef.current]  = getPageScrollY();
    const focused = document.activeElement;
    if (focused?.dataset?.cardId) savedFocusMap.current[navIdRef.current] = focused.dataset.cardId;
  }, []);

  const pushView = useCallback((newView) => {
    saveCurrentScrollAndFocus();
    const newId = nextNavId();
    navIdRef.current = newId;
    window.history.pushState({ id: newId, kind: newView.kind }, "");
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
    const state   = window.history.state;
    const id      = state?.id ?? 0;
    navIdRef.current = id;
    const targetY = savedScrollMap.current[id] ?? 0;
    const focusId = savedFocusMap.current[id] ?? null;
    const doRestore = () => {
      scrollPageTo(targetY);
      if (focusId) {
        const el = document.querySelector(`[data-card-id="${focusId}"]`);
        if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center", inline: "nearest" }); }
      }
    };
    requestAnimationFrame(doRestore);
    [80, 200, 400, 800].forEach((d) => setTimeout(doRestore, d));
  }, [viewStack]);

  useEffect(() => {
    const onPop = () => { if (viewStack.length > 1) popView(); };
    const onKey = (e) => {
      const isBack = e.key === "Escape" || e.key === "GoBack" || e.key === "Backspace" ||
                     e.keyCode === 27   || e.keyCode === 10009 || e.keyCode === 8;
      if (isBack && viewStack.length > 1) { e.preventDefault(); window.history.back(); }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown",  onKey);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); };
  }, [viewStack, popView]);

  useEffect(() => {
    if (!isDataLoaded) return;
    const saved = ss.getJSON("ott_nav_state");
    if (!saved) return;
    ss.del("ott_nav_state");

    const {
      stackKinds, collectionName, seriesTitle, seriesDisplayName, seasonNum,
      scrollY, focusId, homeScrollY, homeFocusId, seriesScrollY, seriesFocusId, filters,
    } = saved;

    const androidData = readAndroidLastWatched();
    if (androidData && Object.keys(androidData).length > 0) {
      setLastWatched((prev) => {
        const merged = { ...prev, ...androidData };
        ls.setJSON(LAST_WATCHED_KEY, merged);
        return merged;
      });
    }

    try {
      if (filters?.language !== undefined) setLanguageFilter(filters.language);
      if (filters?.genre    !== undefined) setGenreFilter(filters.genre);
      if (filters?.year     !== undefined) setYearFilter(filters.year);
      setFilterOpen(false);
    } catch {}

    const kinds = stackKinds || [];

    if (kinds.includes("season") && seriesTitle && seasonNum) {
      const entry = [...seriesGroups, ...animeSeriesGroups].find(([t]) => t === seriesTitle);
      if (entry) {
        const eps = entry[1].seasons[seasonNum];
        if (eps) {
          const id0 = 0, id1 = nextNavId(), id2 = nextNavId();
          navIdRef.current = id2;
          savedScrollMap.current[id0]  = Number(homeScrollY)   || 0;
          savedScrollMap.current[id1]  = Number(seriesScrollY) || 0;
          savedFocusMap.current[id0]   = homeFocusId   || null;
          savedFocusMap.current[id1]   = seriesFocusId || null;
          window.history.replaceState({ id: id0, kind: "home"   }, "");
          window.history.pushState(   { id: id1, kind: "series" }, "");
          window.history.pushState(   { id: id2, kind: "season" }, "");
          setViewStack([
            { kind: "home" },
            { kind: "series", data: { titleKey: seriesTitle, seriesTitle: entry[1].displayName || seriesDisplayName || seriesTitle, seasons: entry[1].seasons } },
            { kind: "season", data: { seriesTitle: entry[1].displayName || seriesDisplayName || seriesTitle, seasonNum, episodes: eps } },
          ]);
          restoreScrollAndFocus(scrollY, focusId);
          return;
        }
      }
    }

    if (kinds.includes("series") && seriesTitle) {
      const entry = [...seriesGroups, ...animeSeriesGroups].find(([t]) => t === seriesTitle);
      if (entry) {
        const id0 = 0, id1 = nextNavId();
        navIdRef.current = id1;
        savedScrollMap.current[id0] = Number(homeScrollY) || 0;
        savedFocusMap.current[id0]  = homeFocusId || null;
        window.history.replaceState({ id: id0, kind: "home"   }, "");
        window.history.pushState(   { id: id1, kind: "series" }, "");
        setViewStack([
          { kind: "home" },
          { kind: "series", data: { titleKey: seriesTitle, seriesTitle: entry[1].displayName || seriesDisplayName || seriesTitle, seasons: entry[1].seasons } },
        ]);
        restoreScrollAndFocus(scrollY, focusId);
        return;
      }
    }

    if (kinds.includes("collection") && collectionName) {
      const group = movieGroups.find(([n]) => n === collectionName) ||
                    animeMovieGroups.find(([n]) => n === collectionName);
      if (group) {
        const id0 = 0, id1 = nextNavId();
        navIdRef.current = id1;
        savedScrollMap.current[id0] = Number(homeScrollY) || 0;
        savedFocusMap.current[id0]  = homeFocusId || null;
        window.history.replaceState({ id: id0, kind: "home"       }, "");
        window.history.pushState(   { id: id1, kind: "collection" }, "");
        setViewStack([
          { kind: "home" },
          { kind: "collection", data: { name: group[0], items: group[1] } },
        ]);
        restoreScrollAndFocus(scrollY, focusId);
        return;
      }
    }

    restoreScrollAndFocus(scrollY, focusId);
  }, [isDataLoaded, movieGroups, animeMovieGroups, seriesGroups, animeSeriesGroups, normalize]);

  useEffect(() => {
    if (!isDataLoaded) return;
    requestAnimationFrame(() => {
      if (!document.body.classList.contains("tv-mode")) return;
      if (document.activeElement !== document.body) return;
      const first = document.querySelector("[data-card-id]");
      if (first) first.focus({ preventScroll: true });
    });
  }, [isDataLoaded, currentView.kind]);

  useLayoutEffect(() => {
    setLanguageFilter([]); setGenreFilter([]); setYearFilter([]); setSearch("");
    setViewStack([{ kind: "home" }]);
    navIdRef.current = 0;
    savedScrollMap.current = {};
    savedFocusMap.current  = {};
    if (!ss.getJSON("ott_nav_state")) scrollPageTo(0);
  }, [type]);

  const handleOpenCollection = useCallback((name, items) => {
    pushView({ kind: "collection", data: { name, items } });
  }, [pushView]);

  const handleOpenSeries = useCallback((seriesTitle, data) => {
    pushView({ kind: "series", data: {
      titleKey:    normalize(seriesTitle),
      seriesTitle: data.displayName || seriesTitle,
      seasons:     data.seasons,
    }});
  }, [pushView, normalize]);

  const handleOpenSeason = useCallback((seriesTitle, seasonNum, episodes) => {
    pushView({ kind: "season", data: { seriesTitle, seasonNum, episodes } });
  }, [pushView]);

  const cardId = useCallback((prefix, id) => `${prefix}_${id}`, []);

  const playMovie = useCallback((movie, playlist = null, currentIndex = 0) => {
    if (movie.episode !== undefined && movie.episode !== null &&
        movie.episode !== "" && movie.episode !== 0 && movie.episode !== "0") {
      const sTitle = movie.seriesTitle || movie.title;
      const sNum   = String(movie.season || "1");
      if (sTitle) saveLastWatched(sTitle, sNum, movie.episode, movie.id);
    }

    let finalPlaylist = playlist, finalIndex = currentIndex;
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

    const stackKinds = viewStack.map((v) => v.kind);
    const getNavInfo = (idx) => ({
      scrollY: savedScrollMap.current[idx] ?? getPageScrollY(),
      focusId: savedFocusMap.current[idx]  ?? null,
    });
    const homeInfo   = getNavInfo(0);
    const seriesInfo = viewStack.length >= 3 ? getNavInfo(navIdRef.current - 1) : null;

    saveCurrentScrollAndFocus();
    const deepScrollY = savedScrollMap.current[navIdRef.current] ?? 0;
    const deepFocusId = savedFocusMap.current[navIdRef.current]  ?? cardId("ep", movie.id);

    const seasonView = viewStack.find((v) => v.kind === "season");
    const seriesView = viewStack.find((v) => v.kind === "series");
    const colView    = viewStack.find((v) => v.kind === "collection");

    ss.setJSON("ott_nav_state", {
      stackKinds,
      collectionName:    colView?.data?.name    ?? null,
      seriesTitle:       seriesView?.data?.titleKey ?? (seasonView ? normalize(seasonView.data?.seriesTitle) : null),
      seriesDisplayName: seriesView?.data?.seriesTitle ?? seasonView?.data?.seriesTitle ?? null,
      seasonNum:         seasonView?.data?.seasonNum   ?? null,
      scrollY:           deepScrollY,
      focusId:           deepFocusId,
      homeScrollY:       homeInfo.scrollY,
      homeFocusId:       homeInfo.focusId,
      seriesScrollY:     seriesInfo?.scrollY ?? null,
      seriesFocusId:     seriesInfo?.focusId ?? null,
      filters: { language: languageFilter, genre: genreFilter, year: yearFilter, search: "" },
    });

    setSearch("");
    addRecentWatched(movie);
    navigate("/player", { state: { movie, playlist: finalPlaylist, currentIndex: finalIndex } });
  }, [
    navigate, viewStack, languageFilter, genreFilter, yearFilter,
    seriesGroups, animeSeriesGroups, normalize, saveLastWatched, addRecentWatched,
    saveCurrentScrollAndFocus, cardId,
  ]);

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
      if (final) { setIsProcessing(true); setVoiceHint("Processing..."); }
      else        { setIsProcessing(false); setVoiceHint("Listening..."); }
      scheduleSilence();
    };
    rec.onerror = (ev) => {
      setVoiceError(ev.error === "not-allowed" || ev.error === "service-not-allowed"
        ? "Microphone permission denied." : "Voice recognition failed. Try again.");
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

  const availableLanguages = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => normalize(m.language)))].filter(Boolean).sort(),
  [movies, matchesTab, normalize]);

  const availableYears = useMemo(() =>
    [...new Set(movies.filter(matchesTab).map((m) => m.year))].filter(Boolean).sort((a, b) => b - a),
  [movies, matchesTab]);

  const noResults = isDataLoaded &&
    movieGroups.length === 0 && seriesGroups.length === 0 &&
    animeMovieGroups.length === 0 && animeSeriesGroups.length === 0;

  const isSearchActive = search.trim().length > 0;

  const renderMovieGrid = useCallback((groups, prefix = "m") =>
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
    }), [cardId, handleClick, handleOpenCollection, playMovie]);

  const renderSeriesCard = useCallback((titleKey, data, i = 0) => {
    const seriesTitle = data.displayName || titleKey;
    const seasons     = Object.entries(data.seasons).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const episodes    = seasons.flatMap(([, eps]) => eps);
    const posterImg   = firstSeasonImg(data.seasons);
    return (
      <FocusCard key={titleKey} className="card is-collection series-card" style={{ "--i": i }}
        data-card-id={cardId("series", titleKey)}
        onClick={(e) => handleClick(e, () => handleOpenSeries(seriesTitle, data))}>
        <PosterImg src={posterImg} alt={seriesTitle} loading="eager" />
        <div className="collection-badge">{seasons.length} Season{seasons.length !== 1 ? "s" : ""}</div>
        <div className="card-info">
          <h3>{seriesTitle}</h3>
          <p>{episodes.length} Episode{episodes.length !== 1 ? "s" : ""}</p>
        </div>
      </FocusCard>
    );
  }, [cardId, handleClick, handleOpenSeries]);

  const renderRecentSection = useCallback((title, items, category) => {
    if (isSearchActive) return null;
    if (!items?.length) return null;
    return (
      <section className="recently-watched-section" key={`rw_${category}`}>
        <h2 className="section-title">{title}</h2>
        <div className="rw-hstrip">
          {items.map((item, i) => {
            const isEpisode = item.lastEpisodeNum !== undefined && item.lastEpisodeNum !== null;
            const cid = cardId(`rw_${category}`, item.id);
            return (
              <div
                key={`rw_${category}_${item.id}_${i}`}
                className="rw-hcard"
                tabIndex={0}
                role="button"
                aria-pressed="false"
                data-card-id={cid}
                onClick={(e) => {
                  triggerRipple(e, e.currentTarget);
                  if (isEpisode) {
                    const sKey  = item.id;
                    const sNum  = item.lastSeason || "1";
                    const entry = [...seriesGroups, ...animeSeriesGroups].find(([t]) => t === sKey);
                    if (entry) {
                      const eps    = entry[1].seasons[sNum] || [];
                      const sorted = [...eps].sort((a, b) =>
                        String(a.episode).localeCompare(String(b.episode), undefined, { numeric: true, sensitivity: "base" })
                      );
                      const lw = getLastWatchedEp(item.seriesTitle || item.title, sNum);
                      const epToPlay = lw
                        ? (sorted.find(ep => ep.id === lw.episodeId)
                           || sorted.find(ep => String(ep.episode) === String(lw.episodeNum))
                           || sorted[0])
                        : sorted[0];
                      if (epToPlay) {
                        const idx = sorted.findIndex(ep => ep.id === epToPlay.id);
                        playMovie(epToPlay, sorted, idx >= 0 ? idx : 0);
                        return;
                      }
                    }
                  }
                  playMovie(item);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
              >
                <div className="rw-hcard-poster">
                  <PosterImg src={item.img} alt={item.seriesTitle || item.title} />
                  {isEpisode && <div className="rw-hcard-bar" />}
                  <span className={`rw-hcard-badge rw-hcard-badge--${
                    category === "anime" ? "anime" : category === "series" ? "series" : "movie"
                  }`}>
                    {category === "anime" ? "ANIME" : category === "series" ? "SERIES" : "MOVIE"}
                  </span>
                  <button
                    className="rw-hcard-delete"
                    aria-label="Remove from recently watched"
                    title="Remove"
                    onClick={(e) => { e.stopPropagation(); deleteRecentWatched(category, item.id); }}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div className="rw-hcard-info">
                  <p className="rw-hcard-title">{item.seriesTitle || item.title}</p>
                  <p className="rw-hcard-meta">
                    {isEpisode ? `S${item.lastSeason || 1} · EP ${item.lastEpisodeNum}` : item.year || ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }, [isSearchActive, cardId, seriesGroups, animeSeriesGroups, getLastWatchedEp, playMovie, deleteRecentWatched]);

  // Safely display chosen tags without .charAt runtime crashes
  const getFilterLabel = (filterArray, fallbackText) => {
    if (!filterArray || filterArray.length === 0) return fallbackText;
    if (filterArray.length === 1) return filterArray[0].charAt(0).toUpperCase() + filterArray[0].slice(1);
    return `${filterArray.length} Items`;
  };

  return (
    <>
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

      {currentView.kind === "home" && banners.length > 0 && !isTV && (
        <HeroBanner banners={banners} onPlay={playMovie} />
      )}

      <FilterPopup
        open={filterOpen}
        initialTab={filterTab}
        onClose={() => setFilterOpen(false)}
        genre={genreFilter}
        onGenreChange={setGenreFilter}
        lang={languageFilter}
        onLangChange={setLanguageFilter}
        year={yearFilter}
        onYearChange={setYearFilter}
        availableLanguages={availableLanguages}
        availableYears={availableYears}
        onApply={({ genre, lang, year }) => {
          if (genre) setGenreFilter(genre);
          if (lang) setLanguageFilter(lang);
          if (year) setYearFilter(year);
          setFilterOpen(false);
        }}
        onReset={() => {
          setGenreFilter([]);
          setLanguageFilter([]);
          setYearFilter([]);
        }}
      />

      <div className="movies-page">
        {currentView.kind === "home" && (
          <>
            <div id="search-section" className="search-bar" role="search">
              <input id="search-input" className="search-input" value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                placeholder={isListening ? "Listening…" : "Search movies, series, anime…"}
                aria-label="Search content" type="search" enterKeyHint="search" />
              <div className="search-voice-group">
                <button
                  className={`mic-btn ${isListening ? "listening-active" : isProcessing ? "processing-active" : ""}`}
                  onClick={startVoice}
                  aria-label={isListening ? "Stop voice search" : "Start voice search"}
                  title={isListening ? "Stop listening" : "Voice search"}
                  type="button">
                  <svg viewBox="0 0 24 24" className="mic-icon" aria-hidden="true">
                    <path d="M12 14.5c1.93 0 3.5-1.57 3.5-3.5V5c0-1.93-1.57-3.5-3.5-3.5S8.5 3.07 8.5 5v6c0 1.93 1.57 3.5 3.5 3.5ZM7 9.5C7 6.46 9.46 4 12.5 4S18 6.46 18 9.5v1.5H17v-1.5C17 7.57 15.43 6 13.5 6S10 7.57 10 9.5v1.5H7V9.5Z" />
                    <path d="M19 11.5c0 3.38-2.71 6.15-6 6.46V20h2v2h-6v-2h2v-2.04c-3.29-.31-6-3.08-6-6.46h2c0 2.76 2.24 5 5 5s5-2.24 5-5h2Z" />
                  </svg>
                  {isProcessing && <span className="mic-spinner" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {(voiceHint || voiceError) && (
              <div className="voice-status-row">
                {voiceHint  && <div className="voice-hint">{voiceHint}</div>}
                {voiceError && <div className="voice-error">{voiceError}</div>}
              </div>
            )}

            {/* Layout filter elements updated inside layout to request pattern: Language -> Genre -> Year */}
            <div className="filter-bar search-filter-gap" role="group" aria-label="Filter content">
              
              {/* 1. Language Trigger */}
              <button
                className={`fp-trigger ${languageFilter.length > 0 ? "fp-trigger--active-teal" : ""}`}
                onClick={() => {
                  setFilterTab("language");
                  setFilterOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={filterOpen && filterTab === "language"}
              >
                <Globe size={16} aria-hidden="true" />
                <span className="fp-trigger-label-wrap">
                  <span>{getFilterLabel(languageFilter, "Language")}</span>
                  {languageFilter.length > 0 && <span className="fp-trigger-hint">Tap to change</span>}
                </span>
                {languageFilter.length > 0 && <span className="fp-trigger-dot" aria-hidden="true" />}
              </button>

              {/* 2. Genre Trigger */}
              <button
                className={`fp-trigger ${genreFilter.length > 0 ? "fp-trigger--active-red" : ""}`}
                onClick={() => {
                  setFilterTab("genre");
                  setFilterOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={filterOpen && filterTab === "genre"}
              >
                <Film size={16} aria-hidden="true" />
                <span className="fp-trigger-label-wrap">
                  <span>
                    {genreFilter.length === 0
                      ? "Genre"
                      : genreFilter.length === 1
                      ? GENRES.find((g) => g.value === genreFilter[0])?.label || genreFilter[0]
                      : `${genreFilter.length} Genres`}
                  </span>
                  {genreFilter.length > 0 && <span className="fp-trigger-hint">Tap to change</span>}
                </span>
                {genreFilter.length > 0 && <span className="fp-trigger-dot" aria-hidden="true" />}
              </button>

              {/* 3. Year Trigger */}
              <button
                className={`fp-trigger ${yearFilter.length > 0 ? "fp-trigger--active-gold" : ""}`}
                onClick={() => {
                  setFilterTab("year");
                  setFilterOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={filterOpen && filterTab === "year"}
              >
                <Calendar size={16} aria-hidden="true" />
                <span className="fp-trigger-label-wrap">
                  <span>{getFilterLabel(yearFilter, "Year")}</span>
                  {yearFilter.length > 0 && <span className="fp-trigger-hint">Tap to change</span>}
                </span>
                {yearFilter.length > 0 && <span className="fp-trigger-dot" aria-hidden="true" />}
              </button>
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
              <div className="series-view-poster">
                <img src={firstSeasonImg(selectedSeries.seasons)} alt={selectedSeries.seriesTitle} />
              </div>
              <div className="series-view-titles">
                <h2 className="series-view-title">{selectedSeries.seriesTitle}</h2>
                <div className="series-view-count">
                  {Object.keys(selectedSeries.seasons).length} Season{Object.keys(selectedSeries.seasons).length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>
            <div className="grid" onKeyDown={handleGridKeyDown}>
              {Object.entries(selectedSeries.seasons)
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                .map(([sNum, eps], i) => {
                  const lw        = getLastWatchedEp(selectedSeries.seriesTitle, sNum);
                  const sortedEps = [...eps].sort((a, b) =>
                    String(a.episode).localeCompare(String(b.episode), undefined, { numeric: true, sensitivity: "base" })
                  );
                  return (
                    <FocusCard key={sNum} className="card is-collection season-card-v2" style={{ "--i": i }}
                      data-card-id={cardId(`sv_${selectedSeries.titleKey}`, sNum)}
                      onClick={(e) => handleClick(e, () => handleOpenSeason(selectedSeries.seriesTitle, sNum, eps))}>
                      <PosterImg src={randomImg(eps)} alt={`Season ${sNum}`} loading="eager" />
                      <div className="season-num-badge">Season {sNum}</div>
                      <div className="collection-badge">{eps.length} Ep{eps.length !== 1 ? "s" : ""}</div>
                      {lw && (
                        <button className="continue-play-btn"
                          aria-label={`Continue from episode ${lw.episodeNum}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const epToPlay = sortedEps.find(ep => ep.id === lw.episodeId)
                              || sortedEps.find(ep => String(ep.episode) === String(lw.episodeNum))
                              || sortedEps[0];
                            if (epToPlay) {
                              const idx = sortedEps.findIndex(ep => ep.id === epToPlay.id);
                              playMovie(epToPlay, sortedEps, idx >= 0 ? idx : 0);
                            }
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
        ) : selectedSeason ? (
          <section key="episode-list" className="collection-view slide-in-premium">
            <div className="season-header">
              <div className="season-breadcrumb">
                <span className="season-breadcrumb-series">{selectedSeason.seriesTitle}</span>
                <span className="season-breadcrumb-sep" aria-hidden="true">›</span>
                <span className="season-breadcrumb-season">Season {selectedSeason.seasonNum}</span>
              </div>
              {(() => {
                const lw        = getLastWatchedEp(selectedSeason.seriesTitle, selectedSeason.seasonNum);
                const sortedEps = [...selectedSeason.episodes].sort((a, b) =>
                  String(a.episode).localeCompare(String(b.episode), undefined, { numeric: true, sensitivity: "base" })
                );
                return lw ? (
                  <button className="season-continue-pill season-continue-pill--btn"
                    aria-label={`Continue from episode ${lw.episodeNum}`}
                    onClick={() => {
                      const epToPlay = sortedEps.find(ep => ep.id === lw.episodeId)
                        || sortedEps.find(ep => String(ep.episode) === String(lw.episodeNum))
                        || sortedEps[0];
                      if (epToPlay) {
                        const idx = sortedEps.findIndex(ep => ep.id === epToPlay.id);
                        playMovie(epToPlay, sortedEps, idx >= 0 ? idx : 0);
                      }
                    }}>
                    <span className="scp-play" aria-hidden="true">▶</span>
                    <span>Continue · EP&nbsp;{lw.episodeNum}</span>
                  </button>
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
                });
              })()}
            </div>
          </section>
        ) : selectedCollection ? (
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
          <div key="home-browse">
            {type === "movie"  && renderRecentSection("Recently Watched", recentWatched.movies,  "movies")}
            {type === "series" && renderRecentSection("Recently Watched", recentWatched.series,  "series")}
            {type === "anime"  && renderRecentSection("Recently Watched", recentWatched.anime,   "anime")}

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
                  <img src={seriIcon} alt="" className="section-icon" aria-hidden="true" /> Series
                </h2>
                <div className="grid" onKeyDown={handleGridKeyDown}>
                  {seriesGroups.map(([title, data], i) => renderSeriesCard(title, data, i))}
                </div>
              </section>
            )}

            {(type === "all" || type === "anime") && animeMovieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={animeIcon} alt="" className="section-icon" aria-hidden="true" /> Anime Movies
                </h2>
                <div className="grid" onKeyDown={handleGridKeyDown}>{renderMovieGrid(animeMovieGroups, "amg")}</div>
              </section>
            )}

            {(type === "all" || type === "anime") && animeSeriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={animeIcon} alt="" className="section-icon" aria-hidden="true" /> Anime Series
                </h2>
                <div className="grid" onKeyDown={handleGridKeyDown}>
                  {animeSeriesGroups.map(([title, data], i) => renderSeriesCard(title, data, i))}
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