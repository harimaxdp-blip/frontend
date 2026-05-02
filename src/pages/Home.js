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

export default function Home({ type = "all" }) {
  const [movies, setMovies] = useState([]);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [savedScrollPos, setSavedScrollPos] = useState(0);

  const navigate = useNavigate();

  const naturalSort = useCallback((a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }, []);

  const normalize = useCallback((value) => {
    return String(value || "").toLowerCase().trim();
  }, []);

  // =========================
  // DATA FETCH
  // =========================
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snapshot) => {
      let data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) || [];
      setMovies(data);
      setIsDataLoaded(true);
    });
    return () => unsub();
  }, []);

  // =========================
  // FILTER & GROUPING LOGIC
  // =========================
  const matchesType = useCallback((itemType) => {
    const clean = normalize(itemType);
    if (type === "all") return true;
    if (type === "movie") return ["movie", "movies"].includes(clean);
    if (type === "series") return ["series", "tv", "show"].includes(clean);
    if (type === "anime") return clean === "anime";
    return true;
  }, [type, normalize]);

  const movieGroups = useMemo(() => {
    const filtered = movies.filter((item) => {
      const isMovieType = ["movie", "movies", "anime"].includes(normalize(item.type));
      const matchType = matchesType(item.type);
      const matchLang = languageFilter === "all" || normalize(item.language) === normalize(languageFilter);
      const matchGen = genreFilter === "all" || normalize(item.genre) === normalize(genreFilter);
      const matchYear = yearFilter === "all" || String(item.year) === String(yearFilter);
      const matchSearch = normalize(item.title).includes(normalize(search));
      return isMovieType && matchType && matchLang && matchGen && matchYear && matchSearch;
    });

    const groups = {};
    filtered.forEach(m => {
      const baseName = m.title.split(/[-–—0-9]/)[0].trim();
      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push(m);
    });

    return Object.entries(groups).sort((a, b) => {
      const latestA = Math.max(...a[1].map(m => parseInt(m.year) || 0));
      const latestB = Math.max(...b[1].map(m => parseInt(m.year) || 0));
      return latestB - latestA;
    }).map(([name, items]) => {
      const sortedItems = [...items].sort((a, b) => naturalSort(a.title, b.title));
      return [name, sortedItems];
    });
  }, [movies, languageFilter, genreFilter, yearFilter, search, matchesType, normalize, naturalSort]);

  const seriesGroups = useMemo(() => {
    const filtered = movies.filter(item => {
      const isSeriesType = !["movie", "movies"].includes(normalize(item.type));
      const matchSearch = normalize(item.seriesTitle || item.title).includes(normalize(search));
      return isSeriesType && matchesType(item.type) && matchSearch;
    });

    const groups = {};
    filtered.forEach(item => {
      const title = item.seriesTitle || item.title || "Unknown Series";
      const season = item.season || "1";
      if (!groups[title]) groups[title] = { seasons: {}, latestYear: 0 };
      
      const yr = parseInt(item.year) || 0;
      if (yr > groups[title].latestYear) groups[title].latestYear = yr;

      if (!groups[title].seasons[season]) groups[title].seasons[season] = [];
      groups[title].seasons[season].push(item);
    });

    return Object.entries(groups).sort((a, b) => b[1].latestYear - a[1].latestYear);
  }, [movies, matchesType, normalize, search]);

  // =========================
  // BROWSER BACK BUTTON LOGIC
  // =========================
  useEffect(() => {
    const handlePopState = () => {
      if (selectedCollection) {
        setSelectedCollection(null);
        const bgPos = sessionStorage.getItem("bgScrollPos");
        setTimeout(() => {
          window.scrollTo(0, bgPos ? parseInt(bgPos) : savedScrollPos);
        }, 50);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedCollection, savedScrollPos]);

  // =========================
  // SCROLL RESTORATION (FROM PLAYER)
  // =========================
  useEffect(() => {
    if (isDataLoaded && movieGroups.length > 0) {
      const savedCollectionName = sessionStorage.getItem("activeCollection");
      const savedPos = sessionStorage.getItem("scrollPos");
      const bgPos = sessionStorage.getItem("bgScrollPos");

      if (savedCollectionName) {
        const group = movieGroups.find(([name]) => name === savedCollectionName);
        if (group) {
          setSelectedCollection({ name: group[0], items: group[1] });
          if (bgPos) setSavedScrollPos(parseInt(bgPos));
          
          // Ensure history state is updated so next back press works
          if (!window.history.state || window.history.state.collection !== group[0]) {
            window.history.replaceState({ collection: group[0] }, "");
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
    }
  }, [isDataLoaded, movieGroups]);

  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
    setSelectedCollection(null);
  }, [type]);

  // =========================
  // ACTIONS
  // =========================
  const handleOpenCollection = (name, items) => {
    const currentScroll = window.scrollY;
    setSavedScrollPos(currentScroll);
    sessionStorage.setItem("bgScrollPos", currentScroll); 
    
    // Push dummy state to capture next back-button click
    window.history.pushState({ collection: name }, "");
    setSelectedCollection({ name, items });
    window.scrollTo(0, 0); 
  };

  const playMovie = (movie) => {
    sessionStorage.setItem("scrollPos", window.scrollY);
    if (selectedCollection) {
      sessionStorage.setItem("activeCollection", selectedCollection.name);
    }
    navigate("/player", { state: { movie } });
  };

  const playRandom = () => {
    const flatList = movieGroups.flatMap(g => g[1]);
    if (!flatList.length) return;
    playMovie(flatList[Math.floor(Math.random() * flatList.length)]);
  };

  const startVoiceSearch = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return alert("Voice search not supported");
    const recognition = new SpeechRec();
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (e) => {
      setSearch(e.results[0][0].transcript);
      setIsListening(false);
    };
    recognition.start();
  };

  const availableLanguages = useMemo(() => 
    [...new Set(movies.filter(m => matchesType(m.type)).map(m => normalize(m.language)))].filter(Boolean).sort()
  , [movies, matchesType, normalize]);

  const availableGenres = useMemo(() => 
    [...new Set(movies.filter(m => matchesType(m.type)).map(m => normalize(m.genre)))].filter(Boolean).sort()
  , [movies, matchesType, normalize]);

  const availableYears = useMemo(() => 
    [...new Set(movies.filter(m => matchesType(m.type)).map(m => m.year))].filter(Boolean).sort((a, b) => b - a)
  , [movies, matchesType]);

  // =========================
  // CARD COMPONENT
  // =========================
  const MovieCard = ({ item, label, subLabel, typePill, isCollection, badgeCount, onClick }) => (
    <div className={`card${isCollection ? " is-collection" : ""}`} onClick={onClick}>
      <div className="card-thumb">
        <img src={item.img || "https://via.placeholder.com/300x450"} alt={label} loading="lazy" />
        <div className="card-shine" />
        <div className="card-hover-overlay">
          <div className="hover-label">▶ Play Now</div>
          <div className="hover-title">{label}</div>
        </div>
        {typePill && <div className="card-type-pill">{typePill}</div>}
        {isCollection && badgeCount > 1 && (
          <div className="collection-badge">{badgeCount} Parts</div>
        )}
      </div>
      <div className="card-info">
        <h3 title={label}>{label}</h3>
        <p>{subLabel}</p>
      </div>
    </div>
  );

  return (
    <div className="movies-page">
      <div className="fixed-controls">
        <button className="control-btn shuffle-btn" onClick={playRandom}><img src={shuffleGif} alt="shuffle" /></button>
        <button className="control-btn top-btn" onClick={() => window.scrollTo({top:0, behavior:'smooth'})}><img src={topGif} alt="top" /></button>
      </div>

      <div className="search-bar">
        <input 
          className="search-input" 
          value={search} 
          onChange={(e) => setSearch(e.target.value)} 
          placeholder={isListening ? "Listening..." : "Search movies, anime, series..."} 
        />
        <button className={`mic-btn ${isListening ? "listening-active" : ""}`} onClick={startVoiceSearch}>
          {isListening ? "🛑" : "🎙️"}
        </button>
      </div>

      <div className="filter-bar">
        <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
          <option value="all">Languages</option>
          {availableLanguages.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
        <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
          <option value="all">Genres</option>
          {availableGenres.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
        </select>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="all">Years</option>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {selectedCollection ? (
        <section className="collection-view slide-down">
          <h2 className="section-title">{selectedCollection.name} Collection</h2>
          <div className="grid">
            {selectedCollection.items.map(m => (
              <MovieCard 
                key={m.id}
                item={m}
                label={m.title}
                subLabel={`${m.language?.toUpperCase() || ''} · ${m.year || ''}`}
                typePill={m.type?.toUpperCase()}
                onClick={() => playMovie(m)}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          {movieGroups.length > 0 && (
            <section className="content-section">
              <h2 className="section-title">Movies & Anime</h2>
              <div className="grid">
                {movieGroups.map(([name, items]) => {
                  const isCol = items.length > 1;
                  return (
                    <MovieCard 
                      key={name}
                      item={items[0]}
                      label={isCol ? `${name} (Collection)` : items[0].title}
                      subLabel={isCol ? `${items.length} Parts` : `${items[0].language?.toUpperCase() || ''} · ${items[0].year || ''}`}
                      isCollection={isCol}
                      badgeCount={items.length}
                      typePill={isCol ? "COLLECTION" : items[0].type?.toUpperCase()}
                      onClick={() => isCol ? handleOpenCollection(name, items) : playMovie(items[0])}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {seriesGroups.map(([title, data]) => (
            <section key={title} className="series-section">
              <h2 className="series-main-title">{title}</h2>
              {Object.entries(data.seasons).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([sNum, eps]) => (
                <div key={sNum} className="season-container">
                  <h3 className="season-title">Season {sNum}</h3>
                  <div className="grid">
                    {eps.sort((a, b) => naturalSort(String(a.episode), String(b.episode))).map(ep => (
                      <MovieCard 
                        key={ep.id}
                        item={ep}
                        label={ep.title}
                        subLabel={`Episode ${ep.episode || "Special"}`}
                        typePill="EPISODE"
                        onClick={() => playMovie(ep)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {(movieGroups.length === 0 && seriesGroups.length === 0) && (
        <div className="no-results">No items found.</div>
      )}
    </div>
  );
}