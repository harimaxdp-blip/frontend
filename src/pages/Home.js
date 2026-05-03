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

// Per-tab no-results images — add these 4 files to your assets folder
import noResultsAll    from "../assets/no-results-all.png";
import noResultsMovie  from "../assets/no-results-movie.png";
import noResultsSeries from "../assets/no-results-series.png";
import noResultsAnime  from "../assets/no-results-anime.png";

import tvIcon1 from "../assets/tv1.png";
import tvIcon2 from "../assets/tv2.png";
import tvIcon3 from "../assets/tv.png";
import tvIcon4 from "../assets/tv.png";

const NO_RESULTS_IMG = {
  all:    noResultsAll,
  movie:  noResultsMovie,
  series: noResultsSeries,
  anime:  noResultsAnime,
};

// ─── Android ripple helper ──────────────────────────────────────────────────
function triggerRipple(e, el) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? rect.left + rect.width / 2;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? rect.top + rect.height / 2;
  const x = clientX - rect.left - size / 2;
  const y = clientY - rect.top - size / 2;

  const span = document.createElement("span");
  span.className = "ripple-wave";
  Object.assign(span.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${x}px`,
    top: `${y}px`,
  });
  el.appendChild(span);
  setTimeout(() => span.remove(), 650);
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

// ─── Player loading overlay ─────────────────────────────────────────────────
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

// ─── No Results ─────────────────────────────────────────────────────────────
function NoResults({ img }) {
  return (
    <div className="no-results">
      <img src={img} alt="No results found" className="no-results-img" />
      <p>No items found.</p>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function Home({ type = "all" }) {
  const [movies, setMovies]                 = useState([]);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [genreFilter, setGenreFilter]       = useState("all");
  const [yearFilter, setYearFilter]         = useState("all");
  const [search, setSearch]                 = useState("");
  const [isListening, setIsListening]       = useState(false);
  const [isDataLoaded, setIsDataLoaded]     = useState(false);

  // For movie / anime-movie multi-part collections
  const [selectedCollection, setSelectedCollection] = useState(null);

  // For series/anime-series: { seriesTitle, seasonNum, episodes[] }
  const [selectedSeason, setSelectedSeason] = useState(null);

  const [savedScrollPos, setSavedScrollPos] = useState(0);
  const [playerLoading, setPlayerLoading]   = useState(null);

  const navigate = useNavigate();

  const naturalSort = useCallback(
    (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    []
  );

  const normalize = useCallback(
    (value) => String(value || "").toLowerCase().trim(),
    []
  );

  // =========================
  // DATA FETCH
  // =========================
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setMovies(data);
      setIsDataLoaded(true);
    });
    return () => unsub();
  }, []);

  // =========================
  // TYPE HELPERS
  // =========================
  const isMovieType  = useCallback((t) => ["movie", "movies"].includes(normalize(t)), [normalize]);
  const isSeriesType = useCallback((t) => ["series", "tv", "show"].includes(normalize(t)), [normalize]);
  const isAnimeType  = useCallback((t) => normalize(t) === "anime", [normalize]);

  // True for movies/series whose genre is "anime" (even if type is "movie")
  const isAnimeGenre = useCallback((item) => normalize(item.genre) === "anime", [normalize]);

  /**
   * Returns true when an item should be visible on the current tab.
   * "all" shows everything; other tabs show only their own types.
   * Anime tab also shows movies/series whose genre === "anime".
   */
  const matchesTab = useCallback(
    (item) => {
      const clean = normalize(item.type);
      if (type === "all")    return true;
      if (type === "movie")  return ["movie", "movies"].includes(clean);
      if (type === "series") return ["series", "tv", "show"].includes(clean);
      // Anime tab: type is anime  OR  genre is anime
      if (type === "anime")  return clean === "anime" || isAnimeGenre(item);
      return true;
    },
    [type, normalize, isAnimeGenre]
  );

  // =========================
  // SHARED FILTER CHECK
  // =========================
  const passesFilters = useCallback(
    (item, titleField = "title") => {
      const matchLang   = languageFilter === "all" || normalize(item.language) === normalize(languageFilter);
      const matchGen    = genreFilter    === "all" || normalize(item.genre)    === normalize(genreFilter);
      const matchYear   = yearFilter     === "all" || String(item.year)        === String(yearFilter);
      const matchSearch = normalize(item[titleField] || item.title).includes(normalize(search));
      return matchLang && matchGen && matchYear && matchSearch;
    },
    [languageFilter, genreFilter, yearFilter, search, normalize]
  );

  // =========================
  // 1. MOVIE GROUPS  (type: movie / movies)
  // =========================
  const movieGroups = useMemo(() => {
    const filtered = movies.filter(
      // Exclude genre-anime movies from the Movies section (they appear in Anime tab)
      (item) => isMovieType(item.type) && !isAnimeGenre(item) && matchesTab(item) && passesFilters(item)
    );

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
  }, [movies, isMovieType, isAnimeGenre, matchesTab, passesFilters, naturalSort]);

  // =========================
  // 2. SERIES GROUPS  (type: series / tv / show)
  // =========================
  const seriesGroups = useMemo(() => {
    const filtered = movies.filter(
      (item) =>
        isSeriesType(item.type) &&
        matchesTab(item) &&
        passesFilters(item, "seriesTitle")
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

  // =========================
  // 3. ANIME MOVIE GROUPS  (type: anime  AND  no season/episode → movie-like)
  // =========================
  const animeMovieGroups = useMemo(() => {
    // Anime movies: (type === "anime" OR genre === "anime") AND no real episode
    // Robust: treat "", "0", 0, null, undefined as "no episode"
    const hasNoEpisode = (ep) =>
      ep === undefined || ep === null || ep === "" || ep === 0 || ep === "0";
    const filtered = movies.filter(
      (item) =>
        (isAnimeType(item.type) || isAnimeGenre(item)) &&
        hasNoEpisode(item.episode) &&
        passesFilters(item)
    );

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
  }, [movies, isAnimeType, isAnimeGenre, passesFilters, naturalSort]);

  // =========================
  // 4. ANIME SERIES GROUPS  (type: anime  AND  has episode → episodic series)
  // =========================
  const animeSeriesGroups = useMemo(() => {
    // Anime series: (type === "anime" OR genre === "anime") AND has a real episode value
    const hasEpisode = (ep) =>
      ep !== undefined && ep !== null && ep !== "" && ep !== 0 && ep !== "0";
    const filtered = movies.filter(
      (item) =>
        (isAnimeType(item.type) || isAnimeGenre(item)) &&
        hasEpisode(item.episode) &&
        passesFilters(item, "seriesTitle")
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

  // =========================
  // BROWSER BACK BUTTON
  // =========================
  useEffect(() => {
    const handlePopState = () => {
      if (selectedSeason) {
        // Back from episode-list → go back to main grid, scroll to where series was
        setSelectedSeason(null);
        const bgPos = sessionStorage.getItem("bgScrollPos");
        setTimeout(() => window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos), 80);
      } else if (selectedCollection) {
        // Back from collection → go back to main grid, scroll to where collection was
        setSelectedCollection(null);
        const bgPos = sessionStorage.getItem("bgScrollPos");
        setTimeout(() => window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos), 80);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedCollection, selectedSeason, savedScrollPos]);

  // =========================
  // SCROLL RESTORATION
  // =========================
  useEffect(() => {
    if (!isDataLoaded) return;

    const savedCollectionName = sessionStorage.getItem("activeCollection");
    const savedSeasonRaw      = sessionStorage.getItem("activeSeason");
    const savedPos            = sessionStorage.getItem("scrollPos");
    const bgPos               = sessionStorage.getItem("bgScrollPos");

    // ── Restore movie collection ──
    if (savedCollectionName && movieGroups.length > 0) {
      const group = movieGroups.find(([name]) => name === savedCollectionName);
      if (group) {
        setSelectedCollection({ name: group[0], items: group[1] });
        if (bgPos) setSavedScrollPos(parseInt(bgPos));
        if (!window.history.state || window.history.state.collection !== group[0]) {
          window.history.pushState({ collection: group[0] }, "");
        }
        sessionStorage.removeItem("activeCollection");
        // Restore scroll inside the collection view (episode list scroll)
        if (savedPos) {
          setTimeout(() => {
            window.scrollTo(0, parseInt(savedPos));
            sessionStorage.removeItem("scrollPos");
          }, 150);
        }
        return;
      }
    }

    // ── Restore season view (series / anime series) ──
    if (savedSeasonRaw) {
      try {
        const { seriesTitle, seasonNum } = JSON.parse(savedSeasonRaw);
        // Search all series groups + anime series groups for this season
        const allSeriesGroups = [...seriesGroups, ...animeSeriesGroups];
        const seriesEntry = allSeriesGroups.find(([t]) => t === seriesTitle);
        if (seriesEntry) {
          const episodes = seriesEntry[1].seasons[seasonNum];
          if (episodes) {
            setSelectedSeason({ seriesTitle, seasonNum, episodes });
            if (bgPos) setSavedScrollPos(parseInt(bgPos));
            if (!window.history.state || window.history.state.season !== `${seriesTitle}-S${seasonNum}`) {
              window.history.pushState({ season: `${seriesTitle}-S${seasonNum}` }, "");
            }
            sessionStorage.removeItem("activeSeason");
            // Restore scroll inside the episode list
            if (savedPos) {
              setTimeout(() => {
                window.scrollTo(0, parseInt(savedPos));
                sessionStorage.removeItem("scrollPos");
              }, 150);
            }
            return;
          }
        }
      } catch (_) {}
      sessionStorage.removeItem("activeSeason");
    }

    // ── Restore main grid scroll position ──
    if (savedPos) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedPos));
        sessionStorage.removeItem("scrollPos");
      }, 150);
    }
  }, [isDataLoaded, movieGroups, seriesGroups, animeSeriesGroups]);

  // Reset filters when switching tabs
  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
    setSelectedCollection(null);
    setSelectedSeason(null);
  }, [type]);

  // =========================
  // ACTIONS
  // =========================
  const handleOpenCollection = (name, items) => {
    const currentScroll = window.scrollY;
    setSavedScrollPos(currentScroll);
    sessionStorage.setItem("bgScrollPos", currentScroll);
    window.history.pushState({ collection: name }, "");
    setSelectedCollection({ name, items });
    window.scrollTo(0, 0);
  };

  const handleOpenSeason = (seriesTitle, seasonNum, episodes) => {
    const currentScroll = window.scrollY;
    setSavedScrollPos(currentScroll);
    // bgScrollPos = the main grid scroll, used when back-navigating out of season
    sessionStorage.setItem("bgScrollPos", currentScroll);
    window.history.pushState({ season: `${seriesTitle}-S${seasonNum}` }, "");
    setSelectedSeason({ seriesTitle, seasonNum, episodes });
    window.scrollTo(0, 0);
  };

  const playMovie = (movie) => {
    setPlayerLoading(movie.title);
    // Save current scroll so we can return to it
    sessionStorage.setItem("scrollPos", window.scrollY);

    if (selectedCollection) {
      // Coming from a movie collection → restore collection on back
      sessionStorage.setItem("activeCollection", selectedCollection.name);
    } else if (selectedSeason) {
      // Coming from a season episode list → restore season on back
      sessionStorage.setItem("activeSeason", JSON.stringify({
        seriesTitle: selectedSeason.seriesTitle,
        seasonNum:   selectedSeason.seasonNum,
      }));
      // Also remember the background scroll (the main grid scroll before season was opened)
      // bgScrollPos is already stored when we entered the season
    }

    setTimeout(() => {
      navigate("/player", { state: { movie } });
    }, 550);
  };

  const playRandom = () => {
    // Include all item types in random shuffle
    const all = [
      ...movieGroups.flatMap((g) => g[1]),
      ...animeMovieGroups.flatMap((g) => g[1]),
    ];
    if (!all.length) return;
    playMovie(all[Math.floor(Math.random() * all.length)]);
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

  const handleClick = (e, action) => {
    triggerRipple(e, e.currentTarget);
    action();
  };

  // =========================
  // FILTER OPTIONS
  // =========================
  const availableLanguages = useMemo(() =>
    [...new Set(movies.filter((m) => matchesTab(m)).map((m) => normalize(m.language)))]
      .filter(Boolean).sort()
  , [movies, matchesTab, normalize]);

  const availableGenres = useMemo(() =>
    [...new Set(movies.filter((m) => matchesTab(m)).map((m) => normalize(m.genre)))]
      .filter(Boolean).sort()
  , [movies, matchesTab, normalize]);

  const availableYears = useMemo(() =>
    [...new Set(movies.filter((m) => matchesTab(m)).map((m) => m.year))]
      .filter(Boolean).sort((a, b) => b - a)
  , [movies, matchesTab]);

  const noResults =
    isDataLoaded &&
    movieGroups.length === 0 &&
    seriesGroups.length === 0 &&
    animeMovieGroups.length === 0 &&
    animeSeriesGroups.length === 0;

  // =========================
  // SERIES RENDERER (reused for both TV-series and anime-series)
  // =========================
  const renderSeriesSection = (title, data) => {
    const seasons = Object.entries(data.seasons).sort(
      (a, b) => parseInt(a[0]) - parseInt(b[0])
    );

    return (
      <section key={title} className="series-section">
        <h2 className="series-main-title">{title}</h2>

        {seasons.length === 1 ? (
          /* Only one season → show episodes directly */
          <div>
            <h3 className="season-title">Season {seasons[0][0]}</h3>
            <div className="grid">
              {seasons[0][1]
                .sort((a, b) => naturalSort(String(a.episode), String(b.episode)))
                .map((ep, i) => (
                  <div
                    key={ep.id}
                    className="card episode-card"
                    style={{ "--i": i }}
                    onClick={(e) => handleClick(e, () => playMovie(ep))}
                  >
                    <img
                      src={ep.img || "https://via.placeholder.com/300x450"}
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
        ) : (
          /* Multiple seasons → season cards */
          <div className="grid">
            {seasons.map(([sNum, eps], i) => {
              const coverImg = eps[0]?.img || "https://via.placeholder.com/300x450";
              return (
                <div
                  key={sNum}
                  className="card is-collection season-card"
                  style={{ "--i": i }}
                  onClick={(e) => handleClick(e, () => handleOpenSeason(title, sNum, eps))}
                >
                  <img src={coverImg} alt={`Season ${sNum}`} loading="lazy" />
                  <div className="collection-badge">{eps.length} Eps</div>
                  <div className="card-info">
                    <h3>Season {sNum}</h3>
                    <p>{eps.length} Episodes</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  // =========================
  // MOVIE/ANIME-MOVIE GRID RENDERER
  // =========================
  const renderMovieGrid = (groups) =>
    groups.map(([name, items], i) => (
      <div
        key={name}
        className={`card ${items.length > 1 ? "is-collection" : ""}`}
        style={{ "--i": i }}
        onClick={(e) =>
          handleClick(e, () =>
            items.length > 1
              ? handleOpenCollection(name, items)
              : playMovie(items[0])
          )
        }
      >
        <img
          src={items[0].img || "https://via.placeholder.com/300x450"}
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
    ));

  // =========================
  // RENDER
  // =========================
  return (
    <>
      {playerLoading && <PlayerLoading title={playerLoading} />}

      {/* ── FIXED CONTROLS ── */}
      <div className="fixed-controls">
        <button
          className="control-btn shuffle-btn"
          onClick={(e) => handleClick(e, playRandom)}
        >
          <img src={shuffleGif} alt="shuffle" />
        </button>
        <button
          className="control-btn top-btn"
          onClick={(e) =>
            handleClick(e, () => window.scrollTo({ top: 0, behavior: "smooth" }))
          }
        >
          <img src={topGif} alt="top" />
        </button>
      </div>

      <div className="movies-page">

        {/* Search */}
        <div className="search-bar">
          <input
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isListening ? "Listening..." : "Search..."}
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
            <option value="all">Languages</option>
            {availableLanguages.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
          <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            <option value="all">Genres</option>
            {availableGenres.map((g) => (
              <option key={g} value={g}>{g.toUpperCase()}</option>
            ))}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">Years</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* ── LOADING STATE ── */}
        {!isDataLoaded ? (
          <section className="content-section">
            <h2 className="section-title">Loading…</h2>
            <div className="grid">
              {Array.from({ length: 10 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>

        ) : selectedSeason ? (
          /* ── SEASON EPISODE VIEW ── */
          <section className="collection-view slide-down">
            <h2 className="section-title">
              {selectedSeason.seriesTitle} — Season {selectedSeason.seasonNum}
            </h2>
            <div className="grid">
              {selectedSeason.episodes
                .sort((a, b) => naturalSort(String(a.episode), String(b.episode)))
                .map((ep, i) => (
                  <div
                    key={ep.id}
                    className="card episode-card"
                    style={{ "--i": i }}
                    onClick={(e) => handleClick(e, () => playMovie(ep))}
                  >
                    <img
                      src={ep.img || "https://via.placeholder.com/300x450"}
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
          </section>

        ) : selectedCollection ? (
          /* ── COLLECTION VIEW ── */
          <section className="collection-view slide-down">
            <h2 className="section-title">{selectedCollection.name} Collection</h2>
            <div className="grid">
              {selectedCollection.items.map((m, i) => (
                <div
                  key={m.id}
                  className="card"
                  style={{ "--i": i }}
                  onClick={(e) => handleClick(e, () => playMovie(m))}
                >
                  <img
                    src={m.img || "https://via.placeholder.com/300x450"}
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
            {/* ══════════════════════════════
                SECTION 1 — MOVIES
            ══════════════════════════════ */}
            {(type === "all" || type === "movie") && movieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
  <img src={tvIcon1} alt="🎬" className="section-icon" />
  Movies
</h2>
                <h2 className="section-title"> </h2>
                <div className="grid">
                  {renderMovieGrid(movieGroups)}
                </div>
              </section>
            )}

            {/* ══════════════════════════════
                SECTION 2 — SERIES
            ══════════════════════════════ */}
            {(type === "all" || type === "series") && seriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
  <img src={tvIcon2} alt="📺" className="section-icon" />
  Series
</h2>
                {seriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
              </section>
            )}

            {/* ══════════════════════════════
                SECTION 3 — ANIME MOVIES
            ══════════════════════════════ */}
            {(type === "all" || type === "anime") && animeMovieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
  <img src={tvIcon3} alt="🎌" className="section-icon" />
  Anime Movies
</h2>
                <div className="grid">
                  {renderMovieGrid(animeMovieGroups)}
                </div>
              </section>
            )}

            {/* ══════════════════════════════
                SECTION 4 — ANIME SERIES
            ══════════════════════════════ */}
            {(type === "all" || type === "anime") && animeSeriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
  <img src={tvIcon4} alt="🎌" className="section-icon" />
  Anime Series
</h2>
                {animeSeriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
              </section>
            )}

            {/* ── NO RESULTS ── */}
            {noResults && <NoResults img={NO_RESULTS_IMG[type] || NO_RESULTS_IMG.all} />}
          </>
        )}
      </div>
    </>
  );
}