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

// ─── Pick a random image from an episode list ───────────────────────────────
function randomImg(episodes) {
  const withImg = episodes.filter((e) => e.img);
  if (!withImg.length) return "https://via.placeholder.com/300x450";
  return withImg[Math.floor(Math.random() * withImg.length)].img;
}

// ─── Android ripple ──────────────────────────────────────────────────────────
function triggerRipple(e, el) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? rect.left + rect.width / 2;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? rect.top + rect.height / 2;
  const x = clientX - rect.left - size / 2;
  const y = clientY - rect.top - size / 2;
  const span = document.createElement("span");
  span.className = "ripple-wave";
  Object.assign(span.style, { width: `${size}px`, height: `${size}px`, left: `${x}px`, top: `${y}px` });
  el.appendChild(span);
  setTimeout(() => span.remove(), 650);
}

function SkeletonCard() {
  return (
    <div className="card-skeleton">
      <div className="skel-img" />
      <div className="skel-title" />
      <div className="skel-sub" />
    </div>
  );
}

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

function NoResults({ img }) {
  return (
    <div className="no-results">
      <img src={img} alt="No results found" className="no-results-img" />
      <p>No items found.</p>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Home({ type = "all" }) {
  const [movies, setMovies]                 = useState([]);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [genreFilter, setGenreFilter]       = useState("all");
  const [yearFilter, setYearFilter]         = useState("all");
  const [search, setSearch]                 = useState("");
  const [isListening, setIsListening]       = useState(false);
  const [isDataLoaded, setIsDataLoaded]     = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [savedScrollPos, setSavedScrollPos] = useState(0);
  const [playerLoading, setPlayerLoading]   = useState(null);

  const navigate = useNavigate();

  const naturalSort = useCallback(
    (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    []
  );
  const normalize = useCallback((value) => String(value || "").toLowerCase().trim(), []);

  // ── Firestore ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setMovies(data);
      setIsDataLoaded(true);
    });
    return () => unsub();
  }, []);

  // ── Type helpers ───────────────────────────────────────────────────────────
  const isMovieType  = useCallback((t) => ["movie", "movies"].includes(normalize(t)), [normalize]);
  const isSeriesType = useCallback((t) => ["series", "tv", "show"].includes(normalize(t)), [normalize]);
  const isAnimeType  = useCallback((t) => normalize(t) === "anime", [normalize]);
  const isAnimeGenre = useCallback((item) => normalize(item.genre) === "anime", [normalize]);

  const matchesTab = useCallback(
    (item) => {
      const clean = normalize(item.type);
      if (type === "all")    return true;
      if (type === "movie")  return ["movie", "movies"].includes(clean);
      if (type === "series") return ["series", "tv", "show"].includes(clean);
      if (type === "anime")  return clean === "anime" || isAnimeGenre(item);
      return true;
    },
    [type, normalize, isAnimeGenre]
  );

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

  // ── Data groups ────────────────────────────────────────────────────────────
  const movieGroups = useMemo(() => {
    const filtered = movies.filter(
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

  // ── Browser back button ────────────────────────────────────────────────────
  useEffect(() => {
    const handlePopState = () => {
      if (selectedSeason) {
        setSelectedSeason(null);
        const bgPos = sessionStorage.getItem("bgScrollPos");
        setTimeout(() => window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos), 80);
      } else if (selectedCollection) {
        setSelectedCollection(null);
        const bgPos = sessionStorage.getItem("bgScrollPos");
        setTimeout(() => window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos), 80);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedCollection, selectedSeason, savedScrollPos]);

  // ── Scroll restoration ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDataLoaded) return;
    const savedCollectionName = sessionStorage.getItem("activeCollection");
    const savedSeasonRaw      = sessionStorage.getItem("activeSeason");
    const savedPos            = sessionStorage.getItem("scrollPos");
    const bgPos               = sessionStorage.getItem("bgScrollPos");

    if (savedCollectionName && movieGroups.length > 0) {
      const group = movieGroups.find(([name]) => name === savedCollectionName);
      if (group) {
        setSelectedCollection({ name: group[0], items: group[1] });
        if (bgPos) setSavedScrollPos(parseInt(bgPos));
        if (!window.history.state || window.history.state.collection !== group[0])
          window.history.pushState({ collection: group[0] }, "");
        sessionStorage.removeItem("activeCollection");
        if (savedPos) setTimeout(() => { window.scrollTo(0, parseInt(savedPos)); sessionStorage.removeItem("scrollPos"); }, 150);
        return;
      }
    }

    if (savedSeasonRaw) {
      try {
        const { seriesTitle, seasonNum } = JSON.parse(savedSeasonRaw);
        const allSeriesGroups = [...seriesGroups, ...animeSeriesGroups];
        const seriesEntry = allSeriesGroups.find(([t]) => t === seriesTitle);
        if (seriesEntry) {
          const episodes = seriesEntry[1].seasons[seasonNum];
          if (episodes) {
            setSelectedSeason({ seriesTitle, seasonNum, episodes });
            if (bgPos) setSavedScrollPos(parseInt(bgPos));
            if (!window.history.state || window.history.state.season !== `${seriesTitle}-S${seasonNum}`)
              window.history.pushState({ season: `${seriesTitle}-S${seasonNum}` }, "");
            sessionStorage.removeItem("activeSeason");
            if (savedPos) setTimeout(() => { window.scrollTo(0, parseInt(savedPos)); sessionStorage.removeItem("scrollPos"); }, 150);
            return;
          }
        }
      } catch (_) {}
      sessionStorage.removeItem("activeSeason");
    }

    if (savedPos) setTimeout(() => { window.scrollTo(0, parseInt(savedPos)); sessionStorage.removeItem("scrollPos"); }, 150);
  }, [isDataLoaded, movieGroups, seriesGroups, animeSeriesGroups]);

  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
    setSelectedCollection(null);
    setSelectedSeason(null);
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

  const handleOpenSeason = (seriesTitle, seasonNum, episodes) => {
    const currentScroll = window.scrollY;
    setSavedScrollPos(currentScroll);
    sessionStorage.setItem("bgScrollPos", currentScroll);
    window.history.pushState({ season: `${seriesTitle}-S${seasonNum}` }, "");
    setSelectedSeason({ seriesTitle, seasonNum, episodes });
    window.scrollTo(0, 0);
  };

  // passes sorted playlist + index so player can auto-play next episode
  const playMovie = useCallback((movie, playlist = null, currentIndex = 0) => {
    setPlayerLoading(movie.title);
    sessionStorage.setItem("scrollPos", window.scrollY);

    if (selectedCollection) {
      sessionStorage.setItem("activeCollection", selectedCollection.name);
    } else if (selectedSeason) {
      sessionStorage.setItem("activeSeason", JSON.stringify({
        seriesTitle: selectedSeason.seriesTitle,
        seasonNum:   selectedSeason.seasonNum,
      }));
    }

    setTimeout(() => {
      navigate("/player", {
        state: { movie, playlist, currentIndex },
      });
    }, 550);
  }, [navigate, selectedCollection, selectedSeason]);

  const playRandom = () => {
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

  // ── Filter options ─────────────────────────────────────────────────────────
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

  // ── Movie / Anime-movie grid ───────────────────────────────────────────────
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
        <img src={items[0].img || "https://via.placeholder.com/300x450"} alt={name} loading="lazy" />
        {items.length > 1 && <div className="collection-badge">{items.length} Parts</div>}
        <div className="card-info">
          <h3>{items.length > 1 ? `${name} (Collection)` : items[0].title}</h3>
          <p>{items.length > 1 ? "Multi-Part Series" : `${items[0].language} • ${items[0].year}`}</p>
        </div>
      </div>
    ));

  // ─────────────────────────────────────────────────────────────────────────
  // ── SERIES RENDERER
  //    • ALWAYS shows season cards (even if only 1 season)
  //    • Season card image = random episode image from that season
  //    • Clicking a season card → opens episode list
  //    • Episode list → clicking an episode plays with full playlist
  // ─────────────────────────────────────────────────────────────────────────
  const renderSeriesSection = (seriesTitle, data) => {
    const seasons = Object.entries(data.seasons).sort(
      (a, b) => parseInt(a[0]) - parseInt(b[0])
    );

    return (
      <section key={seriesTitle} className="series-section">
        <h2 className="series-main-title">{seriesTitle}</h2>

        {/* Always show season cards — single or multiple */}
        <div className="grid">
          {seasons.map(([sNum, eps], i) => {
            // Random image picked once per render from this season's episodes
            const coverImg = randomImg(eps);
            const totalEps = eps.length;

            return (
              <div
                key={sNum}
                className="card is-collection season-card"
                style={{ "--i": i }}
                onClick={(e) =>
                  handleClick(e, () => handleOpenSeason(seriesTitle, sNum, eps))
                }
              >
                <img src={coverImg} alt={`Season ${sNum}`} loading="lazy" />
                <div className="collection-badge">{totalEps} Ep{totalEps !== 1 ? "s" : ""}</div>
                <div className="card-info">
                  <h3>Season {sNum}</h3>
                  <p>{totalEps} Episode{totalEps !== 1 ? "s" : ""}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {playerLoading && <PlayerLoading title={playerLoading} />}

      <div className="fixed-controls">
        <button className="control-btn shuffle-btn" onClick={(e) => handleClick(e, playRandom)}>
          <img src={shuffleGif} alt="shuffle" />
        </button>
        <button
          className="control-btn top-btn"
          onClick={(e) => handleClick(e, () => window.scrollTo({ top: 0, behavior: "smooth" }))}
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
            {availableLanguages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
          <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            <option value="all">Genres</option>
            {availableGenres.map((g) => <option key={g} value={g}>{g.toUpperCase()}</option>)}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">Years</option>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* ── Loading ── */}
        {!isDataLoaded ? (
          <section className="content-section">
            <h2 className="section-title">Loading…</h2>
            <div className="grid">
              {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </section>

        ) : selectedSeason ? (
          /* ── Episode List (inside a season) ── */
          <section className="collection-view slide-down">
            <h2 className="section-title">
              {selectedSeason.seriesTitle} — Season {selectedSeason.seasonNum}
            </h2>
            <div className="grid">
              {(() => {
                const sortedEps = [...selectedSeason.episodes].sort(
                  (a, b) => naturalSort(String(a.episode), String(b.episode))
                );
                return sortedEps.map((ep, i) => (
                  <div
                    key={ep.id}
                    className="card episode-card"
                    style={{ "--i": i }}
                    onClick={(e) => handleClick(e, () => playMovie(ep, sortedEps, i))}
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
                ));
              })()}
            </div>
          </section>

        ) : selectedCollection ? (
          /* ── Movie collection ── */
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
                  <img src={m.img || "https://via.placeholder.com/300x450"} alt={m.title} loading="lazy" />
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
            {/* Movies */}
            {(type === "all" || type === "movie") && movieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon1} alt="🎬" className="section-icon" /> Movies
                </h2>
                <div className="grid">{renderMovieGrid(movieGroups)}</div>
              </section>
            )}

            {/* Series */}
            {(type === "all" || type === "series") && seriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon2} alt="📺" className="section-icon" /> Series
                </h2>
                {seriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
              </section>
            )}

            {/* Anime Movies */}
            {(type === "all" || type === "anime") && animeMovieGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon3} alt="🎌" className="section-icon" /> Anime Movies
                </h2>
                <div className="grid">{renderMovieGrid(animeMovieGroups)}</div>
              </section>
            )}

            {/* Anime Series */}
            {(type === "all" || type === "anime") && animeSeriesGroups.length > 0 && (
              <section className="content-section">
                <h2 className="section-title">
                  <img src={tvIcon4} alt="🎌" className="section-icon" /> Anime Series
                </h2>
                {animeSeriesGroups.map(([title, data]) => renderSeriesSection(title, data))}
              </section>
            )}

            {noResults && <NoResults img={NO_RESULTS_IMG[type] || NO_RESULTS_IMG.all} />}
          </>
        )}
      </div>
    </>
  );
}