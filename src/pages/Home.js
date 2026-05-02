import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";
import "./Movies.css";

import shuffleGif from "../assets/dice-game.gif";
import topGif from "../assets/up.gif";

// ─── Android-style ripple helper ───────────────────────────────────────────
function createRipple(e, element) {
  const rect = element.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = (e.clientX || e.touches?.[0]?.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (e.clientY || e.touches?.[0]?.clientY || rect.top + rect.height / 2) - rect.top - size / 2;

  const ripple = document.createElement("span");
  ripple.className = "ripple-wave";
  ripple.style.cssText = `
    width:${size}px; height:${size}px;
    left:${x}px; top:${y}px;
    position:absolute; border-radius:50%;
    background:rgba(255,255,255,0.18);
    transform:scale(0);
    animation:rippleExpand 0.55s cubic-bezier(0.22,1,0.36,1) forwards;
    pointer-events:none; z-index:10;
  `;

  element.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}

// ─── Skeleton card ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="card-skeleton">
      <div className="skel-img" />
      <div className="skel-title" />
      <div className="skel-sub" />
    </div>
  );
}

// ─── Player loading screen ──────────────────────────────────────────────────
function PlayerLoading({ title }) {
  return (
    <div className="player-loading">
      <div className="player-loading-spinner" />
      <div className="player-loading-title">
        <strong>{title}</strong>
        Loading…
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function Home({ type = "all" }) {
  const [movies, setMovies]                   = useState([]);
  const [languageFilter, setLanguageFilter]   = useState("all");
  const [genreFilter, setGenreFilter]         = useState("all");
  const [yearFilter, setYearFilter]           = useState("all");
  const [search, setSearch]                   = useState("");
  const [isListening, setIsListening]         = useState(false);
  const [isDataLoaded, setIsDataLoaded]       = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [savedScrollPos, setSavedScrollPos]   = useState(0);
  const [playerLoading, setPlayerLoading]     = useState(null); // movie title

  const navigate = useNavigate();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const naturalSort = useCallback((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  , []);

  const normalize = useCallback((value) =>
    String(value || "").toLowerCase().trim()
  , []);

  // ── Firestore ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setMovies(data);
      setIsDataLoaded(true);
    });
    return () => unsub();
  }, []);

  // ── Type matching ──────────────────────────────────────────────────────────
  const matchesType = useCallback((itemType) => {
    const clean = normalize(itemType);
    if (type === "all")    return true;
    if (type === "movie")  return ["movie", "movies"].includes(clean);
    if (type === "series") return ["series", "tv", "show"].includes(clean);
    if (type === "anime")  return clean === "anime";
    return true;
  }, [type, normalize]);

  // ── Movie groups ───────────────────────────────────────────────────────────
  const movieGroups = useMemo(() => {
    const filtered = movies.filter((item) => {
      const isMovieType = ["movie", "movies", "anime"].includes(normalize(item.type));
      return (
        isMovieType &&
        matchesType(item.type) &&
        (languageFilter === "all" || normalize(item.language) === normalize(languageFilter)) &&
        (genreFilter   === "all" || normalize(item.genre)    === normalize(genreFilter)) &&
        (yearFilter    === "all" || String(item.year)        === String(yearFilter)) &&
        normalize(item.title).includes(normalize(search))
      );
    });

    const groups = {};
    filtered.forEach((m) => {
      const baseName = m.title.split(/[-–—0-9]/)[0].trim();
      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push(m);
    });

    return Object.entries(groups)
      .sort((a, b) => {
        const latestA = Math.max(...a[1].map((m) => parseInt(m.year) || 0));
        const latestB = Math.max(...b[1].map((m) => parseInt(m.year) || 0));
        return latestB - latestA;
      })
      .map(([name, items]) => [name, [...items].sort((a, b) => naturalSort(a.title, b.title))]);
  }, [movies, languageFilter, genreFilter, yearFilter, search, matchesType, normalize, naturalSort]);

  // ── Series groups ──────────────────────────────────────────────────────────
  const seriesGroups = useMemo(() => {
    const filtered = movies.filter((item) => {
      const isSeriesType = !["movie", "movies"].includes(normalize(item.type));
      return (
        isSeriesType &&
        matchesType(item.type) &&
        normalize(item.seriesTitle || item.title).includes(normalize(search))
      );
    });

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
  }, [movies, matchesType, normalize, search]);

  // ── Browser back button ────────────────────────────────────────────────────
  useEffect(() => {
    const handlePopState = () => {
      if (selectedCollection) {
        setSelectedCollection(null);
        const bgPos = sessionStorage.getItem("bgScrollPos");
        setTimeout(() => window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos), 50);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedCollection, savedScrollPos]);

  // ── Scroll restoration ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDataLoaded || movieGroups.length === 0) return;

    const savedCollectionName = sessionStorage.getItem("activeCollection");
    const savedPos            = sessionStorage.getItem("scrollPos");
    const bgPos               = sessionStorage.getItem("bgScrollPos");

    if (savedCollectionName) {
      const group = movieGroups.find(([name]) => name === savedCollectionName);
      if (group) {
        setSelectedCollection({ name: group[0], items: group[1] });
        if (bgPos) setSavedScrollPos(parseInt(bgPos));
        if (!window.history.state || window.history.state.collection !== group[0]) {
          window.history.pushState({ collection: group[0] }, "");
        }
        sessionStorage.removeItem("activeCollection");
      }
    }

    if (savedPos) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedPos));
        sessionStorage.removeItem("scrollPos");
      }, 150);
    }
  }, [isDataLoaded, movieGroups]);

  // ── Reset on type change ───────────────────────────────────────────────────
  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
    setSelectedCollection(null);
  }, [type]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleOpenCollection = (name, items) => {
    const currentScroll = window.scrollY;
    setSavedScrollPos(currentScroll);
    sessionStorage.setItem("bgScrollPos", currentScroll);
    window.history.pushState({ collection: name }, "");
    setSelectedCollection({ name, items });
    window.scrollTo(0, 0);
  };

  const playMovie = (movie) => {
    // Show player loading screen
    setPlayerLoading(movie.title);
    sessionStorage.setItem("scrollPos", window.scrollY);
    if (selectedCollection) {
      sessionStorage.setItem("activeCollection", selectedCollection.name);
    }
    // Brief delay for UX feedback, then navigate
    setTimeout(() => {
      navigate("/player", { state: { movie } });
    }, 600);
  };

  const playRandom = () => {
    const flatList = movieGroups.flatMap((g) => g[1]);
    if (!flatList.length) return;
    playMovie(flatList[Math.floor(Math.random() * flatList.length)]);
  };

  const startVoiceSearch = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return alert("Voice search not supported");
    const recognition = new SpeechRec();
    recognition.onstart  = () => setIsListening(true);
    recognition.onend    = () => setIsListening(false);
    recognition.onresult = (e) => { setSearch(e.results[0][0].transcript); setIsListening(false); };
    recognition.start();
  };

  // ── Ripple handler ─────────────────────────────────────────────────────────
  const handleCardClick = (e, callback) => {
    createRipple(e, e.currentTarget);
    callback();
  };

  // ── Filter options ─────────────────────────────────────────────────────────
  const availableLanguages = useMemo(() =>
    [...new Set(movies.filter((m) => matchesType(m.type)).map((m) => normalize(m.language)))]
      .filter(Boolean).sort()
  , [movies, matchesType, normalize]);

  const availableGenres = useMemo(() =>
    [...new Set(movies.filter((m) => matchesType(m.type)).map((m) => normalize(m.genre)))]
      .filter(Boolean).sort()
  , [movies, matchesType, normalize]);

  const availableYears = useMemo(() =>
    [...new Set(movies.filter((m) => matchesType(m.type)).map((m) => m.year))]
      .filter(Boolean).sort((a, b) => b - a)
  , [movies, matchesType]);

  // ── Loading skeleton grid ──────────────────────────────────────────────────
  const SkeletonGrid = () => (
    <div className="grid">
      {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Player loading overlay */}
      {playerLoading && <PlayerLoading title={playerLoading} />}

      <div className="movies-page">

        {/* Floating controls */}
        <div className="fixed-controls">
          <button
            className="control-btn shuffle-btn"
            onClick={(e) => { createRipple(e, e.currentTarget); playRandom(); }}
            title="Play random"
          >
            <img src={shuffleGif} alt="Shuffle" />
          </button>
          <button
            className="control-btn top-btn"
            onClick={(e) => { createRipple(e, e.currentTarget); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            title="Back to top"
          >
            <img src={topGif} alt="Top" />
          </button>
        </div>

        {/* Search */}
        <div className="search-bar">
          <input
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isListening ? "Listening…" : "Search titles…"}
          />
          <button
            className={`mic-btn ${isListening ? "listening-active" : ""}`}
            onClick={startVoiceSearch}
          >
            {isListening ? "🛑" : "🎙️"}
          </button>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
            <option value="all">All Languages</option>
            {availableLanguages.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
          <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            <option value="all">All Genres</option>
            {availableGenres.map((g) => (
              <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
            ))}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Content */}
        {!isDataLoaded ? (
          <section className="content-section">
            <h2 className="section-title">Loading…</h2>
            <SkeletonGrid />
          </section>
        ) : selectedCollection ? (
          /* ── Collection view ── */
          <section className="collection-view">
            <button
              className="back-btn"
              onClick={() => {
                setSelectedCollection(null);
                const bgPos = sessionStorage.getItem("bgScrollPos");
                setTimeout(() => window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos), 50);
                window.history.back();
              }}
            >
              ← Back
            </button>
            <h2 className="section-title">{selectedCollection.name} — Collection</h2>
            <div className="grid">
              {selectedCollection.items.map((m, i) => (
                <div
                  key={m.id}
                  className="card"
                  style={{ "--i": i }}
                  onClick={(e) => handleCardClick(e, () => playMovie(m))}
                >
                  <img
                    src={m.img || "https://via.placeholder.com/300x450?text=No+Image"}
                    alt={m.title}
                    loading="lazy"
                  />
                  <div className="card-info">
                    <h3>{m.title}</h3>
                    <p>{m.year}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            {/* ── Movies & Anime grid ── */}
            {movieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">Movies &amp; Anime</h2>
                <div className="grid">
                  {movieGroups.map(([name, items], i) => (
                    <div
                      key={name}
                      className={`card ${items.length > 1 ? "is-collection" : ""}`}
                      style={{ "--i": i }}
                      onClick={(e) =>
                        handleCardClick(e, () =>
                          items.length > 1
                            ? handleOpenCollection(name, items)
                            : playMovie(items[0])
                        )
                      }
                    >
                      <img
                        src={items[0].img || "https://via.placeholder.com/300x450?text=No+Image"}
                        alt={name}
                        loading="lazy"
                      />
                      {items.length > 1 && (
                        <div className="collection-badge">{items.length} Parts</div>
                      )}
                      <div className="card-info">
                        <h3>{items.length > 1 ? `${name} (Collection)` : items[0].title}</h3>
                        <p>
                          {items.length > 1
                            ? "Multi-Part Series"
                            : `${items[0].language} • ${items[0].year}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Series sections ── */}
            {seriesGroups.map(([title, data]) => (
              <section key={title} className="series-section">
                <h2 className="series-main-title">{title}</h2>
                {Object.entries(data.seasons)
                  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                  .map(([sNum, eps]) => (
                    <div key={sNum} className="season-container">
                      <h3 className="season-title">Season {sNum}</h3>
                      <div className="grid">
                        {eps
                          .sort((a, b) => naturalSort(String(a.episode), String(b.episode)))
                          .map((ep, i) => (
                            <div
                              key={ep.id}
                              className="card episode-card"
                              style={{ "--i": i }}
                              onClick={(e) => handleCardClick(e, () => playMovie(ep))}
                            >
                              <img
                                src={ep.img || "https://via.placeholder.com/300x450?text=No+Image"}
                                alt={ep.title}
                                loading="lazy"
                              />
                              <div className="card-info">
                                <h3>{ep.title}</h3>
                                <p>Episode {ep.episode || "Special"}</p>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
              </section>
            ))}
          </>
        )}

        {/* Empty state */}
        {isDataLoaded && movieGroups.length === 0 && seriesGroups.length === 0 && (
          <div className="no-results">No titles found. Try a different search or filter.</div>
        )}
      </div>
    </>
  );
}