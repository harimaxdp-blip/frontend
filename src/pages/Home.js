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
  import "./Movies.css";

  //import shuffleGif from "../assets/dice-game.gif";
  //import topGif     from "../assets/up.gif";

  import noResultsAll    from "../assets/no-results-all.png";
  import noResultsMovie  from "../assets/no-results-movie.png";
  import noResultsSeries from "../assets/no-results-series.png";
  import noResultsAnime  from "../assets/no-results-anime.png";

  import tvIcon1 from "../assets/tv1.png";
  import tvIcon2 from "../assets/tv2.png";
  import tvIcon3 from "../assets/tv.png";
  import tvIcon4 from "../assets/tv.png";

  // ─── Constants ────────────────────────────────────────────────────────────────
  const NO_RESULTS_IMG = {
    all:    noResultsAll,
    movie:  noResultsMovie,
    series: noResultsSeries,
    anime:  noResultsAnime,
  };
  const POSTER_FALLBACK = "https://via.placeholder.com/300x450";

  // ─── Unique navigation state key ─────────────────────────────────────────────
  let _navStateId = 0;
  const nextNavId = () => ++_navStateId;

  // ─── Session storage helpers ──────────────────────────────────────────────────
  const ss = {
    get:     (k)    => { try { return sessionStorage.getItem(k); }              catch { return null; } },
    set:     (k, v) => { try { sessionStorage.setItem(k, v); }                 catch {} },
    del:     (k)    => { try { sessionStorage.removeItem(k); }                 catch {} },
    getJSON: (k)    => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    setJSON: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ─── Pick a random image from an episode list ────────────────────────────────
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
    const token = ++restoreScrollToken;
    const targetY = Number(scrollY) || 0;
    const restore = () => {
      if (token !== restoreScrollToken) return;
      scrollPageTo(targetY);
      if (focusId) {
        const el = document.querySelector(`[data-card-id="${focusId}"]`);
        if (el) el.focus({ preventScroll: true });
      }
    };

    requestAnimationFrame(restore);
    [50, 150, 320, 650].forEach((delay) => setTimeout(restore, delay));
  };

  // ─── Ripple ───────────────────────────────────────────────────────────────────
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

  // ─── Sub-components ───────────────────────────────────────────────────────────
  const SkeletonCard = React.memo(function SkeletonCard() {
    return (
      <div className="card-skeleton">
        <div className="skel-img" />
        <div className="skel-title" />
        <div className="skel-sub" />
      </div>
    );
  });

  const PlayerLoading = React.memo(function PlayerLoading({ title }) {
    return (
      <div className="player-loading" role="status" aria-live="polite">
        <div className="player-loading-spinner" />
        <div className="player-loading-title">
          <strong>{title}</strong>Loading…
        </div>
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
/*
function DiceLoader() {
  return (
    <div className="dice-scene">
      <div className="dice">
        <div className="face front">
          <span className="dot center"></span>
        </div>

        <div className="face back">
          <span className="dot tl"></span>
          <span className="dot tr"></span>
          <span className="dot ml"></span>
          <span className="dot mr"></span>
          <span className="dot bl"></span>
          <span className="dot br"></span>
        </div>

        <div className="face right">
          <span className="dot tl"></span>
          <span className="dot center"></span>
          <span className="dot br"></span>
        </div>

        <div className="face left">
          <span className="dot tl"></span>
          <span className="dot tr"></span>
          <span className="dot bl"></span>
          <span className="dot br"></span>
        </div>

        <div className="face top">
          <span className="dot tl"></span>
          <span className="dot tr"></span>
          <span className="dot center"></span>
          <span className="dot bl"></span>
          <span className="dot br"></span>
        </div>

        <div className="face bottom">
          <span className="dot tl"></span>
          <span className="dot br"></span>
        </div>
      </div>
    </div>
  );
}
*/
  // ─── Hero Banner ──────────────────────────────────────────────────────────────
  const HeroBanner = React.memo(function HeroBanner({ banners, onPlay }) {
    const [current, setCurrent]           = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const timerRef    = useRef(null);
    const pendingIdx  = useRef(null);
    const isPausedRef = useRef(false);
    const bannerRef   = useRef(null);

    // ── Goto ──
    const goTo = useCallback((index) => {
      if (isTransitioning) { pendingIdx.current = index; return; }
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrent(index);
        setIsTransitioning(false);
        if (pendingIdx.current !== null) {
          const next = pendingIdx.current;
          pendingIdx.current = null;
          setTimeout(() => goTo(next), 50);
        }
      }, 350);
    }, [isTransitioning]);

    const next = useCallback(() => {
  if (!banners?.length) return;
  goTo((current + 1) % banners.length);
}, [current, banners, goTo]);
    // BUG FIX: previous button was calling resetTimer() instead of prev()
    const prev = useCallback(() => goTo((current - 1 + banners.length) % banners.length), [current, banners.length, goTo]);

    const resetTimer = useCallback(() => {
      clearInterval(timerRef.current);
      if (banners.length > 1 && !isPausedRef.current) {
        timerRef.current = setInterval(next, 5000);
      }
    }, [next, banners.length]);

    // ── Auto-slide ──
    useEffect(() => {
      resetTimer();
      return () => clearInterval(timerRef.current);
    }, [resetTimer]);

    // ── Pause on hover ──
    const handleMouseEnter = () => { isPausedRef.current = true;  clearInterval(timerRef.current); };
    const handleMouseLeave = () => { isPausedRef.current = false; resetTimer(); };

    // ── Touch swipe ──
    useEffect(() => {
      const el = bannerRef.current;
      if (!el) return;
      let startX = 0, startY = 0, moved = false;

      const onTouchStart = (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; moved = false; };
      const onTouchMove  = (e) => { moved = true; };
      const onTouchEnd   = (e) => {
        if (!moved) return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
          if (dx < 0) next(); else prev();
          resetTimer();
        }
      };

      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove",  onTouchMove,  { passive: true });
      el.addEventListener("touchend",   onTouchEnd);
      return () => {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove",  onTouchMove);
        el.removeEventListener("touchend",   onTouchEnd);
      };
    }, [next, prev, resetTimer]);

    // ── Keyboard ──
    const handleKeyDown = useCallback((e) => {
      if (e.key === "ArrowLeft")  { prev(); resetTimer(); }
      if (e.key === "ArrowRight") { next(); resetTimer(); }
    }, [prev, next, resetTimer]);

    if (!banners || banners.length === 0) return null;
    const banner = banners?.[current];

if (!banner) return null;

    return (
      <div
        ref={bannerRef}
        className="hero-banner"
        role="region"
        aria-label="Featured content"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div
          className={`hero-bg ${isTransitioning ? "hero-bg--out" : "hero-bg--in"}`}
          style={{ backgroundImage: `url(${banner.imageUrl})` }}
        />
        <div className="hero-overlay" />
        <div className={`hero-content ${isTransitioning ? "hero-content--out" : "hero-content--in"}`}>
          {banner.logo ? (
            <img src={banner.logo} alt={banner.title} className="hero-logo" />
          ) : (
            <h1 className="hero-title">{banner.title}</h1>
          )}
          {banner.description && <p className="hero-desc">{banner.description}</p>}
          <div className="hero-meta">
            {banner.year     && <span className="hero-tag">{banner.year}</span>}
            {banner.language && <span className="hero-tag">{banner.language.toUpperCase()}</span>}
            {banner.genre    && <span className="hero-tag">{banner.genre}</span>}
          </div>
          {banner.movieRef && (
            <button
              className="hero-play-btn"
              onClick={() => onPlay && onPlay(banner.movieRef)}
              aria-label={`Play ${banner.title}`}
            >
              <span className="hero-play-icon" aria-hidden="true">▶</span>Play Now
            </button>
          )}
        </div>

        {banners.length > 1 && (
          <>
            {/* BUG FIX: Previous button now calls prev() + resetTimer() */}
            <button
              className="hero-nav hero-nav--prev"
              onClick={() => { prev(); resetTimer(); }}
              aria-label="Previous slide"
            >‹</button>
            <button
              className="hero-nav hero-nav--next"
              onClick={() => { next(); resetTimer(); }}
              aria-label="Next slide"
            >›</button>
            <div className="hero-dots" role="tablist" aria-label="Slide indicators">
              {banners.map((_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === current}
                  className={`hero-dot ${i === current ? "hero-dot--active" : ""}`}
                  onClick={() => { goTo(i); resetTimer(); }}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
  });

  // ─── Focusable card ───────────────────────────────────────────────────────────
  const FocusCard = React.forwardRef(function FocusCard(
    { className, style, onClick, children, tabIndex = 0, "data-card-id": dataCardId },
    ref
  ) {
    const handleKeyDown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
    };
    return (
      <div
        ref={ref}
        className={className}
        style={style}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        tabIndex={tabIndex}
        data-card-id={dataCardId}
        role="button"
        aria-pressed="false"
      >
        {children}
      </div>
    );
  });

  // ─── Main Component ───────────────────────────────────────────────────────────
  export default function Home({ type = "all" }) {
    // ── Data state ──────────────────────────────────────────────────────────
    const [movies, setMovies]           = useState([]);
    const [banners, setBanners]         = useState([]);
    const [isDataLoaded, setIsDataLoaded] = useState(false);

    // ── Filter state ────────────────────────────────────────────────────────
    const [languageFilter, setLanguageFilter] = useState("all");
    const [genreFilter, setGenreFilter]       = useState("all");
    const [yearFilter, setYearFilter]         = useState("all");
    const [search, setSearch]                 = useState("");
    const [isListening, setIsListening]       = useState(false);

    // ── Up button ───────────────────────────────────────────────────────────
    const [showUpBtn, setShowUpBtn] = useState(false);

    // ── View stack ──────────────────────────────────────────────────────────
    const [viewStack, setViewStack] = useState([{ kind: "home" }]);

    // ── Player loading ──────────────────────────────────────────────────────
    const [playerLoading, setPlayerLoading] = useState(null);

    // ── Refs ─────────────────────────────────────────────────────────────────
    const navigate          = useNavigate();
    const savedScrollMap    = useRef({});
    const isNavigatingBack  = useRef(false);
    const navIdRef          = useRef(0);

    const currentView        = viewStack[viewStack.length - 1];
    const selectedCollection = currentView.kind === "collection" ? currentView.data : null;
    const selectedSeason     = currentView.kind === "season"     ? currentView.data : null;

    // ─── Up button visibility ─────────────────────────────────────────────────
    useEffect(() => {
      const root = getScrollRoot();
      const onScroll = () => setShowUpBtn(getPageScrollY() > 300);
      root.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => root.removeEventListener("scroll", onScroll);
    }, []);

    const scrollToTop = useCallback((e) => {
      triggerRipple(e, e.currentTarget);
      scrollPageTo(0, "smooth");
    }, []);

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const normalize   = useCallback((v) => String(v || "").toLowerCase().trim(), []);
    const naturalSort = useCallback(
      (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      []
    );

    // ─── Firestore ────────────────────────────────────────────────────────────
    useEffect(() => {
      const unsub = onSnapshot(collection(db, "movies"), (snap) => {
        setMovies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setIsDataLoaded(true);
      });
      return () => unsub();
    }, []);

    useEffect(() => {
      const unsub = onSnapshot(collection(db, "banners"), (snap) => {
        const data = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((b) => {
            if (b.active === false) return false;
            if (type === "movie")  return b.bannerType === "movie";
            if (type === "series") return b.bannerType === "series";
            if (type === "anime")  return b.bannerType === "anime";
            return true;
          })
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        setBanners(data);
      });
      return () => unsub();
    }, [type]);

    // ─── Type helpers ──────────────────────────────────────────────────────────
    const isMovieType  = useCallback((t) => ["movie", "movies"].includes(normalize(t)), [normalize]);
    const isSeriesType = useCallback((t) => ["series", "tv", "show"].includes(normalize(t)), [normalize]);
    const isAnimeType  = useCallback((t) => normalize(t) === "anime", [normalize]);
    const isAnimeGenre = useCallback((item) => normalize(item.genre) === "anime", [normalize]);

    const matchesTab = useCallback((item) => {
      const clean = normalize(item.type);
      if (type === "all")    return true;
      if (type === "movie")  return ["movie", "movies"].includes(clean);
      if (type === "series") return ["series", "tv", "show"].includes(clean);
      if (type === "anime")  return clean === "anime" || isAnimeGenre(item);
      return true;
    }, [type, normalize, isAnimeGenre]);

    const passesFilters = useCallback((item, titleField = "title") => {
      const matchLang   = languageFilter === "all" || normalize(item.language) === normalize(languageFilter);
      const matchGen    = genreFilter    === "all" || normalize(item.genre)    === normalize(genreFilter);
      const matchYear   = yearFilter     === "all" || String(item.year)        === String(yearFilter);
      const query       = normalize(search);
      const title       = normalize(item[titleField] || item.title);
      const matchSearch = !query || title.startsWith(query) || title.includes(query);
      return matchLang && matchGen && matchYear && matchSearch;
    }, [languageFilter, genreFilter, yearFilter, search, normalize]);

    const searchScore = useCallback((title, query) => {
      const t = normalize(title), q = normalize(query);
      if (!q) return 0;
      if (t === q)   return 1000;
      if (t.startsWith(q)) return 900;
      if (t.split(" ").some((w) => w.startsWith(q))) return 800;
      if (t.includes(q)) return 700;
      return 0;
    }, [normalize]);

    // ─── Data groups ──────────────────────────────────────────────────────────
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
        .sort((a, b) => {
          const sa = searchScore(a[0], search), sb = searchScore(b[0], search);
          if (sb !== sa) return sb - sa;
          const la = Math.max(...a[1].map((m) => parseInt(m.year) || 0));
          const lb = Math.max(...b[1].map((m) => parseInt(m.year) || 0));
          if (lb !== la) return lb - la;
          return a[0].localeCompare(b[0], undefined, { sensitivity: "base" });
        })
        .map(([name, items]) => [name, [...items].sort((a, b) => naturalSort(a.title, b.title))]);
    }, [movies, isMovieType, isAnimeGenre, matchesTab, passesFilters, naturalSort, search, searchScore]);

    const seriesGroups = useMemo(() => {
      const filtered = movies.filter(
        (item) => isSeriesType(item.type) && matchesTab(item) && passesFilters(item, "seriesTitle")
      );
      const groups = {};
      filtered.forEach((item) => {
        const title  = item.seriesTitle || item.title || "Unknown Series";
        const season = item.season || "1";
        if (!groups[title]) groups[title] = { seasons: {}, latestYear: 0 };
        const yr = parseInt(item.year) || 0;
        if (yr > groups[title].latestYear) groups[title].latestYear = yr;
        if (!groups[title].seasons[season]) groups[title].seasons[season] = [];
        groups[title].seasons[season].push(item);
      });
      return Object.entries(groups).sort((a, b) => b[1].latestYear - a[1].latestYear);
    }, [movies, isSeriesType, matchesTab, passesFilters]);

    const animeMovieGroups = useMemo(() => {
      const hasNoEpisode = (ep) => ep === undefined || ep === null || ep === "" || ep === 0 || ep === "0";
      const filtered = movies.filter(
        (item) => (isAnimeType(item.type) || isAnimeGenre(item)) && hasNoEpisode(item.episode) && passesFilters(item)
      );
      const groups = {};
      filtered.forEach((m) => {
        const base = m.collectionTitle?.trim() || m.title.split(/\s*[-–—]\s*\d|\d+/)[0].trim() || m.title;
        if (!groups[base]) groups[base] = [];
        groups[base].push(m);
      });
      return Object.entries(groups)
        .sort((a, b) => {
          const sa = searchScore(a[0], search), sb = searchScore(b[0], search);
          if (sb !== sa) return sb - sa;
          const la = Math.max(...a[1].map((m) => parseInt(m.year) || 0));
          const lb = Math.max(...b[1].map((m) => parseInt(m.year) || 0));
          if (lb !== la) return lb - la;
          return a[0].localeCompare(b[0], undefined, { sensitivity: "base" });
        })
        .map(([name, items]) => [name, [...items].sort((a, b) => naturalSort(a.title, b.title))]);
    }, [movies, isAnimeType, isAnimeGenre, passesFilters, naturalSort, search, searchScore]);

    const animeSeriesGroups = useMemo(() => {
      const hasEpisode = (ep) => ep !== undefined && ep !== null && ep !== "" && ep !== 0 && ep !== "0";
      const filtered = movies.filter(
        (item) => (isAnimeType(item.type) || isAnimeGenre(item)) && hasEpisode(item.episode) && passesFilters(item, "seriesTitle")
      );
      const groups = {};
      filtered.forEach((item) => {
        const title  = item.seriesTitle || item.title || "Unknown Series";
        const season = item.season || "1";
        if (!groups[title]) groups[title] = { seasons: {}, latestYear: 0 };
        const yr = parseInt(item.year) || 0;
        if (yr > groups[title].latestYear) groups[title].latestYear = yr;
        if (!groups[title].seasons[season]) groups[title].seasons[season] = [];
        groups[title].seasons[season].push(item);
      });
      return Object.entries(groups).sort((a, b) => b[1].latestYear - a[1].latestYear);
    }, [movies, isAnimeType, isAnimeGenre, passesFilters]);

    // ─── Navigation system ────────────────────────────────────────────────────
    const saveCurrentState = useCallback(() => {
      const id = navIdRef.current;
      savedScrollMap.current[id] = getPageScrollY();
      const focused = document.activeElement;
      if (focused && focused.dataset.cardId) {
        ss.set(`focus_${id}`, focused.dataset.cardId);
      }
    }, []);

    const pushView = useCallback((newView) => {
      saveCurrentState();
      const newId = nextNavId();
      navIdRef.current = newId;
      window.history.pushState({ id: newId, kind: newView.kind }, "");
      setViewStack((prev) => [...prev, newView]);
      // Instant scroll to top — no smooth scroll to avoid flash
      scrollPageTo(0);
    }, [saveCurrentState]);

    const popView = useCallback(() => {
      if (viewStack.length <= 1) return;
      isNavigatingBack.current = true;
      setViewStack((prev) => prev.slice(0, -1));
    }, [viewStack.length]);

    // Restore scroll + focus after pop — useLayoutEffect runs before paint
    useLayoutEffect(() => {
      if (!isNavigatingBack.current) return;
      isNavigatingBack.current = false;

      const state    = window.history.state;
      const id       = state?.id ?? 0;
      navIdRef.current = id;
      const targetY  = savedScrollMap.current[id] ?? 0;
      const focusId  = ss.get(`focus_${id}`);

      // Restore scroll before paint
      scrollPageTo(targetY);

      // Restore focus after paint
      requestAnimationFrame(() => {
        if (focusId) {
          const el = document.querySelector(`[data-card-id="${focusId}"]`);
          if (el) el.focus({ preventScroll: true });
        }
      });
    }, [viewStack]);

    // ─── Browser back / Escape key ───────────────────────────────────────────
    useEffect(() => {
      const handlePopState = () => { if (viewStack.length > 1) popView(); };
      const handleKeyDown  = (e) => {
        const isBack = e.key === "Escape" || e.key === "GoBack" || e.keyCode === 27 || e.keyCode === 10009;
        if (isBack && viewStack.length > 1) { e.preventDefault(); window.history.back(); }
      };
      window.addEventListener("popstate", handlePopState);
      window.addEventListener("keydown",  handleKeyDown);
      return () => {
        window.removeEventListener("popstate", handlePopState);
        window.removeEventListener("keydown",  handleKeyDown);
      };
    }, [viewStack, popView]);

    // ─── Restore state after page reload ─────────────────────────────────────
    useEffect(() => {
      if (!isDataLoaded) return;
      const savedState = ss.getJSON("ott_nav_state");
      if (!savedState) return;
      ss.del("ott_nav_state");

      const { kind, collectionName, seriesTitle, seasonNum, scrollY, focusId, parentScrollY, parentFocusId, filters } = savedState;

      // Restore filters/search if present
      if (filters) {
        try {
          if (filters.language !== undefined) setLanguageFilter(filters.language);
          if (filters.genre    !== undefined) setGenreFilter(filters.genre);
          if (filters.year     !== undefined) setYearFilter(filters.year);
          if (filters.search   !== undefined) setSearch(filters.search);
        } catch (e) {
          // ignore
        }
      }

      if (kind === "collection" && collectionName) {
        const group = movieGroups.find(([n]) => n === collectionName)
          || animeMovieGroups.find(([n]) => n === collectionName);
        if (group) {
          const id = nextNavId();
          navIdRef.current = id;
          savedScrollMap.current[0] = Number(parentScrollY) || 0;
          if (parentFocusId) ss.set("focus_0", parentFocusId);
          window.history.replaceState({ id: 0, kind: "home" }, "");
          window.history.pushState({ id, kind: "collection" }, "");
          setViewStack([
            { kind: "home" },
            {
              kind: "collection",
              data: {
                name: group[0],
                items: group[1],
                parentScrollY,
                parentFocusId,
              },
            },
          ]);
          restoreScrollAndFocus(scrollY, focusId);
          return;
        }
      }

      if (kind === "season" && seriesTitle && seasonNum) {
        const all   = [...seriesGroups, ...animeSeriesGroups];
        const entry = all.find(([t]) => t === seriesTitle);
        if (entry) {
          const eps = entry[1].seasons[seasonNum];
          if (eps) {
            const id = nextNavId();
            navIdRef.current = id;
            savedScrollMap.current[0] = Number(parentScrollY) || 0;
            if (parentFocusId) ss.set("focus_0", parentFocusId);
            window.history.replaceState({ id: 0, kind: "home" }, "");
            window.history.pushState({ id, kind: "season" }, "");
            setViewStack([
              { kind: "home" },
              { kind: "season", data: { seriesTitle, seasonNum, episodes: eps, parentScrollY, parentFocusId } },
            ]);
            restoreScrollAndFocus(scrollY, focusId);
            return;
          }
        }
      }

      restoreScrollAndFocus(scrollY, focusId);
    }, [isDataLoaded, movieGroups, animeMovieGroups, seriesGroups, animeSeriesGroups]);

    // ─── Reset on tab change ──────────────────────────────────────────────────
    useLayoutEffect(() => {
      setLanguageFilter("all");
      setGenreFilter("all");
      setYearFilter("all");
      setSearch("");
      setViewStack([{ kind: "home" }]);
      navIdRef.current = 0;
      savedScrollMap.current = {};
      if (!ss.getJSON("ott_nav_state")) {
        scrollPageTo(0);
      }
    }, [type]);

    // ─── Actions ──────────────────────────────────────────────────────────────
    const handleOpenCollection = useCallback((name, items) => {
      pushView({
        kind: "collection",
        data: {
          name,
          items,
          parentScrollY: getPageScrollY(),
          parentFocusId: document.activeElement?.dataset?.cardId || null,
        },
      });
    }, [pushView]);

    const handleOpenSeason = useCallback((seriesTitle, seasonNum, episodes) => {
      pushView({
        kind: "season",
        data: {
          seriesTitle,
          seasonNum,
          episodes,
          parentScrollY: getPageScrollY(),
          parentFocusId: document.activeElement?.dataset?.cardId || null,
        },
      });
    }, [pushView]);

    const playMovie = useCallback((movie, playlist = null, currentIndex = 0) => {
      setPlayerLoading(movie.title);
      const navState = {
        kind:           currentView.kind,
        collectionName: currentView.kind === "collection" ? currentView.data?.name       : null,
        seriesTitle:    currentView.kind === "season"     ? currentView.data?.seriesTitle : null,
        seasonNum:      currentView.kind === "season"     ? currentView.data?.seasonNum   : null,
        parentScrollY:   currentView.data?.parentScrollY ?? null,
        parentFocusId:   currentView.data?.parentFocusId ?? null,
        scrollY:        getPageScrollY(),
        focusId:        document.activeElement?.dataset?.cardId || null,
        // Save current filters so we can restore them when coming back
        filters: {
          language: languageFilter,
          genre:    genreFilter,
          year:     yearFilter,
          search:   search,
        },
      };
      ss.setJSON("ott_nav_state", navState);
      setTimeout(() => {
        navigate("/player", { state: { movie, playlist, currentIndex } });
      }, 550);
    }, [navigate, currentView, languageFilter, genreFilter, yearFilter, search]);
/*
const playRandom = useCallback(() => {
  const all = [
    ...movieGroups.flatMap((g) => g[1]),
    ...animeMovieGroups.flatMap((g) => g[1]),
  ];

  if (!all.length) return;

  playMovie(
    all[Math.floor(Math.random() * all.length)]
  );
}, [movieGroups, animeMovieGroups, playMovie]);
*/

    const startVoiceSearch = () => {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) return alert("Voice search not supported on this device");
      const rec     = new SpeechRec();
      rec.onstart   = () => setIsListening(true);
      rec.onend     = () => setIsListening(false);
      rec.onresult  = (e) => { setSearch(e.results[0][0].transcript); setIsListening(false); };
      rec.onerror   = () => setIsListening(false);
      rec.start();
    };

    const handleClick = (e, action) => {
      restoreScrollToken += 1;
      e.currentTarget?.focus?.({ preventScroll: true });
      triggerRipple(e, e.currentTarget);
      action();
    };

    // ─── Filter options ───────────────────────────────────────────────────────
    const availableLanguages = useMemo(() =>
      [...new Set(movies.filter((m) => matchesTab(m)).map((m) => normalize(m.language)))]
        .filter(Boolean).sort(),
    [movies, matchesTab, normalize]);

    const availableGenres = useMemo(() =>
      [...new Set(movies.filter((m) => matchesTab(m)).map((m) => normalize(m.genre)))]
        .filter(Boolean).sort(),
    [movies, matchesTab, normalize]);

    const availableYears = useMemo(() =>
      [...new Set(movies.filter((m) => matchesTab(m)).map((m) => m.year))]
        .filter(Boolean).sort((a, b) => b - a),
    [movies, matchesTab]);

    const noResults =
      isDataLoaded &&
      movieGroups.length      === 0 &&
      seriesGroups.length     === 0 &&
      animeMovieGroups.length  === 0 &&
      animeSeriesGroups.length === 0;

    const cardId = (prefix, id) => `${prefix}_${id}`;

    // ─── Render: movie/anime-movie grid ──────────────────────────────────────
    const renderMovieGrid = (groups, prefix = "m") =>
      groups.map(([name, items], i) => {
        const cid = cardId(prefix, items[0].id);
        return (
          <FocusCard
            key={name}
            className={`card ${items.length > 1 ? "is-collection" : ""}`}
            style={{ "--i": i }}
            data-card-id={cid}
            onClick={(e) =>
              handleClick(e, () =>
                items.length > 1
                  ? handleOpenCollection(name, items)
                  : playMovie(items[0])
              )
            }
          >
            <img
    src={items[0].img || POSTER_FALLBACK}
    alt={name}
    loading="eager"
    fetchPriority="high"
    decoding="sync"
  />
            {items.length > 1 && (
              <div className="collection-badge">{items.length} Parts</div>
            )}
            <div className="card-info">
              <h3>{items.length > 1 ? `${name} (Collection)` : items[0].title}</h3>
              <p>{items.length > 1 ? "Multi-Part Series" : `${items[0].language} • ${items[0].year}`}</p>
            </div>
          </FocusCard>
        );
      });

    // ─── Render: series section ───────────────────────────────────────────────
    const renderSeriesSection = (seriesTitle, data) => {
      const seasons = Object.entries(data.seasons).sort(
        (a, b) => parseInt(a[0]) - parseInt(b[0])
      );
      return (
        <section key={seriesTitle} className="series-section">
          <h2 className="series-main-title">{seriesTitle}</h2>
          <div className="grid">
            {seasons.map(([sNum, eps], i) => {
              const coverImg = randomImg(eps);
              const total    = eps.length;
              const cid      = cardId(`s_${seriesTitle}`, sNum);
              return (
                <FocusCard
                  key={sNum}
                  className="card is-collection season-card"
                  style={{ "--i": i }}
                  data-card-id={cid}
                  onClick={(e) =>
                    handleClick(e, () => handleOpenSeason(seriesTitle, sNum, eps))
                  }
                >
                  <img
                    src={coverImg}
                    alt={`Season ${sNum}`}
                    loading="eager"
                    decoding="async"
                    onError={(e) => { e.currentTarget.src = POSTER_FALLBACK; }}
                  />
                  <div className="collection-badge">{total} Ep{total !== 1 ? "s" : ""}</div>
                  <div className="card-info">
                    <h3>Season {sNum}</h3>
                    <p>{total} Episode{total !== 1 ? "s" : ""}</p>
                  </div>
                </FocusCard>
              );
            })}
          </div>
        </section>
      );
    };

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
      <>
        {playerLoading && <PlayerLoading title={playerLoading} />}

        {/* Fixed controls */}
        <div className="fixed-controls" aria-label="Quick actions">
{/*
<button
  className="control-btn shuffle-btn"
  onClick={(e) => handleClick(e, playRandom)}
  aria-label="Play random movie"
  title="Play random"
>
  <DiceLoader />
</button>
*/}

          {/* Up button — only visible after scrolling */}
          <button
            className={`control-btn top-btn ${showUpBtn ? "top-btn--visible" : ""}`}
            onClick={scrollToTop}
            aria-label="Scroll to top"
            title="Back to top"
          ><span className="fire"></span>
            <svg
    className="top-arrow"
    viewBox="0 0 24 24"
    fill="none"
  >
    <path
      d="M12 18V7"
      stroke="white"
      strokeWidth="2.8"
      strokeLinecap="round"
    />
    <path
      d="M7 12L12 7L17 12"
      stroke="white"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
          </button>
        </div>

        {/* Hero banner */}
        {currentView.kind === "home" && banners.length > 0 && (
          <HeroBanner banners={banners} onPlay={playMovie} />
        )}

        <div className="movies-page">
          {/* Search */}
          <div id="search-section" className="search-bar" role="search">
            <input
  id="search-input"
  className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isListening ? "Listening…" : "Search movies, series, anime…"}
              aria-label="Search content"
              type="search"
            />
            <button
              className={`mic-btn ${isListening ? "listening-active" : ""}`}
              onClick={startVoiceSearch}
              aria-label={isListening ? "Stop voice search" : "Start voice search"}
              title={isListening ? "Stop listening" : "Voice search"}
            >
              {isListening ? "🛑" : "🎙️"}
            </button>
          </div>

          {/* Filters */}
          <div className="filter-bar" role="group" aria-label="Filter content">
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              aria-label="Filter by language"
            >
              <option value="all">All Languages</option>
              {availableLanguages.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              aria-label="Filter by genre"
            >
              <option value="all">All Genres</option>
              {availableGenres.map((g) => (
                <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
              ))}
            </select>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              aria-label="Filter by year"
            >
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* ── Loading ── */}
          {!isDataLoaded ? (
            <section className="content-section" aria-busy="true" aria-label="Loading content">
              <h2 className="section-title">Loading…</h2>
              <div className="grid">
                {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            </section>

          ) : selectedSeason ? (
            /* ── Episode list ── */
            <section key="episode-list" className="collection-view slide-in-premium">
              <button
                type="button"
                className="back-btn"
                onClick={() => window.history.back()}
                aria-label="Go back"
              >
                ← Back
              </button>
              <h2 className="section-title">
                {selectedSeason.seriesTitle} — Season {selectedSeason.seasonNum}
              </h2>
              <div className="grid">
                {(() => {
                  const sortedEps = [...selectedSeason.episodes].sort(
                    (a, b) => naturalSort(String(a.episode), String(b.episode))
                  );
                  return sortedEps.map((ep, i) => {
                    const cid = cardId("ep", ep.id);
                    return (
                      <FocusCard
                        key={ep.id}
                        className="card episode-card"
                        style={{ "--i": i }}
                        data-card-id={cid}
                        onClick={(e) => handleClick(e, () => playMovie(ep, sortedEps, i))}
                      >
                        <img
                          src={ep.img || POSTER_FALLBACK}
                          alt={ep.title}
                          loading="eager"
                          decoding="async"
                          onError={(e) => { e.currentTarget.src = POSTER_FALLBACK; }}
                        />
                        <div className="card-info">
                          <h3>{ep.title}</h3>
                          <p>Episode {ep.episode || "Special"}</p>
                        </div>
                      </FocusCard>
                    );
                  });
                })()}
              </div>
            </section>

          ) : selectedCollection ? (
            /* ── Movie collection ── */
            <section key="collection-view" className="collection-view slide-in-premium">
              <button
                type="button"
                className="back-btn"
                onClick={() => window.history.back()}
                aria-label="Go back"
              >
                ← Back
              </button>
              <h2 className="section-title">{selectedCollection.name} Collection</h2>
              <div className="grid">
                {selectedCollection.items.map((m, i) => {
                  const cid = cardId("col", m.id);
                  return (
                    <FocusCard
                      key={m.id}
                      className="card"
                      style={{ "--i": i }}
                      data-card-id={cid}
                      onClick={(e) => handleClick(e, () => playMovie(m))}
                    >
                      <img
                        src={m.img || POSTER_FALLBACK}
                        alt={m.title}
                        loading="eager"
                        decoding="async"
                        onError={(e) => { e.currentTarget.src = POSTER_FALLBACK; }}
                      />
                      <div className="card-info">
                        <h3>{m.title}</h3>
                        <p>{m.year}</p>
                      </div>
                    </FocusCard>
                  );
                })}
              </div>
            </section>

          ) : (
            /* ── Home browse ── */
            <div key="home-browse">
              {(type === "all" || type === "movie") && movieGroups.length > 0 && (
                <section className="content-section">
                  <h2 className="section-title">
                    <img src={tvIcon1} alt="" className="section-icon" aria-hidden="true" /> Movies
                  </h2>
                  <div className="grid">{renderMovieGrid(movieGroups, "mg")}</div>
                </section>
              )}

              {(type === "all" || type === "series") && seriesGroups.length > 0 && (
                <section className="content-section">
                  <h2 className="section-title">
                    <img src={tvIcon2} alt="" className="section-icon" aria-hidden="true" /> Series
                  </h2>
                  {seriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
                </section>
              )}

              {(type === "all" || type === "anime") && animeMovieGroups.length > 0 && (
                <section className="content-section">
                  <h2 className="section-title">
                    <img src={tvIcon3} alt="" className="section-icon" aria-hidden="true" /> Anime Movies
                  </h2>
                  <div className="grid">{renderMovieGrid(animeMovieGroups, "amg")}</div>
                </section>
              )}

              {(type === "all" || type === "anime") && animeSeriesGroups.length > 0 && (
                <section className="content-section">
                  <h2 className="section-title">
                    <img src={tvIcon4} alt="" className="section-icon" aria-hidden="true" /> Anime Series
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
