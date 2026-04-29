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

// Assets for GIFs (kept as per your requirement)
import shuffleGif from "../assets/dice-game.gif";
import topGif from "../assets/up.gif";

export default function Home({ type = "all" }) {
  const [movies, setMovies] = useState([]);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isListening, setIsListening] = useState(false);

  const navigate = useNavigate();

  // =========================
  // HELPER: NORMALIZE
  // =========================
  const normalize = useCallback((value) => {
    return String(value || "").toLowerCase().trim();
  }, []);

  // =========================
  // FETCH DATA
  // =========================
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) || [];
      setMovies(data);
    });
    return () => unsub();
  }, []);

  // RESET FILTERS ON NAV CHANGE
  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
  }, [type]);

  // =========================
  // FILTER LOGIC
  // =========================
  const matchesType = useCallback((itemType) => {
    const clean = normalize(itemType);
    if (type === "all") return true;
    if (type === "movie") return ["movie", "movies"].includes(clean);
    if (type === "series") return ["series", "tv", "show"].includes(clean);
    if (type === "anime") return clean === "anime";
    return true;
  }, [type, normalize]);

  const filteredContent = useMemo(() => {
    return movies.filter((item) => {
      const matchType = matchesType(item.type);
      const matchLang = languageFilter === "all" || normalize(item.language) === normalize(languageFilter);
      const matchGen = genreFilter === "all" || normalize(item.genre) === normalize(genreFilter);
      const matchYear = yearFilter === "all" || String(item.year) === String(yearFilter);
      const matchSearch = normalize(item.title).includes(normalize(search));

      return matchType && matchLang && matchGen && matchYear && matchSearch;
    });
    // Removed 'type' from dependency to fix ESLint warning
  }, [movies, languageFilter, genreFilter, yearFilter, search, normalize, matchesType]);

  // =========================
  // DYNAMIC OPTIONS
  // =========================
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
  // GROUPING
  // =========================
  const movieItems = useMemo(() => 
    filteredContent.filter(m => ["movie", "movies", "anime"].includes(normalize(m.type)))
  , [filteredContent, normalize]);

  const seriesGrouped = useMemo(() => {
    const grouped = {};
    filteredContent.forEach((item) => {
      const t = normalize(item.type);
      if (["movie", "movies"].includes(t)) return;

      const title = item.seriesTitle || item.title || "Unknown Series";
      const sNum = item.season || "1";

      if (!grouped[title]) grouped[title] = {};
      if (!grouped[title][sNum]) grouped[title][sNum] = [];
      grouped[title][sNum].push(item);
    });
    return grouped;
  }, [filteredContent, normalize]);

  // =========================
  // ACTIONS
  // =========================
  const playMovie = (movie) => navigate("/player", { state: { movie } });
  
  const playRandom = () => {
    if (!filteredContent.length) return;
    const random = filteredContent[Math.floor(Math.random() * filteredContent.length)];
    playMovie(random);
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const startVoiceSearch = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return alert("Voice search not supported");
    const recognition = new SpeechRec();
    recognition.lang = "en-IN";
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e) => setSearch(e.results[0][0].transcript);
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  return (
    <div className="movies-page">
      <div className="fixed-controls">
        <button className="control-btn shuffle-btn" onClick={playRandom} title="Random Play">
          <img src={shuffleGif} alt="shuffle" />
        </button>
        <button className="control-btn top-btn" onClick={scrollToTop} title="Scroll to Top">
          <img src={topGif} alt="top" />
        </button>
      </div>

      <div className="search-bar">
        <input
          className="search-input"
          placeholder={isListening ? "Listening..." : "Search movies, series..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button 
          className={`mic-btn ${isListening ? "listening" : ""}`} 
          onClick={startVoiceSearch}
        >
          {/* Changed from <img> to dynamic Icon symbols */}
          <span className="icon-symbol">
            {isListening ? "⏹" : "🎙"}
          </span>
        </button>
      </div>

      <div className="filter-bar">
        <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
          <option value="all">All Languages</option>
          {availableLanguages.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>

        <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
          <option value="all">All Genres</option>
          {availableGenres.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
        </select>

        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="all">All Years</option>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {movieItems.length > 0 && (
        <section className="content-section">
          <h2 className="section-title">Latest Updates</h2>
          <div className="grid">
            {movieItems.map((m) => (
              <div key={m.id} className="card" onClick={() => playMovie(m)}>
                <img src={m.img || "https://via.placeholder.com/300x450"} alt={m.title} loading="lazy" />
                <div className="card-info">
                  <h3>{m.title}</h3>
                  <p>{m.language} • {m.year}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Object.entries(seriesGrouped).map(([title, seasons]) => (
        <section key={title} className="series-section">
          <h2 className="series-main-title">{title}</h2>
          {Object.entries(seasons).map(([season, eps]) => (
            <div key={season} className="season-container">
              <h3 className="season-title">Season {season}</h3>
              <div className="grid">
                {eps.map((ep) => (
                  <div key={ep.id} className="card episode-card" onClick={() => playMovie(ep)}>
                    <img src={ep.img || "https://via.placeholder.com/300x450"} alt={ep.title} loading="lazy" />
                    <div className="card-info">
                      <h3>{ep.title}</h3>
                      <p>Episode {ep.episode || ep.id.slice(-2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {filteredContent.length === 0 && (
        <div className="no-results">No results found for your search/filter.</div>
      )}
    </div>
  );
}