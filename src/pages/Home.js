import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";
import "./Movies.css";

export default function Home({ type = "all" }) {
  const [movies, setMovies] = useState([]);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef(null);

  // =========================
  // NORMALIZE UTILITY
  // =========================
  const normalize = useCallback((value) =>
    String(value || "")
      .toLowerCase()
      .trim(), []);

  // =========================
  // FETCH DATA FROM FIRESTORE
  // =========================
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMovies(data);
    });

    return () => unsub();
  }, []);

  // =========================
  // RESET FILTERS ON TAB CHANGE
  // =========================
  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
  }, [type]);

  // =========================
  // TYPE MATCHER LOGIC
  // =========================
  const matchesType = useCallback(
    (itemType) => {
      const cleanType = normalize(itemType);
      if (type === "all") return true;
      if (type === "movie") return ["movie", "movies"].includes(cleanType);
      if (type === "series") return ["series", "tv", "show"].includes(cleanType);
      if (type === "anime") return ["anime"].includes(cleanType);
      return true;
    },
    [type, normalize]
  );

  // =========================
  // DATA FILTERING & SORTING
  // =========================
  const dataByType = useMemo(() => {
    return movies.filter((item) => matchesType(item.type));
  }, [movies, matchesType]);

  const availableLanguages = useMemo(() => {
    return [...new Set(dataByType.map((item) => normalize(item.language)).filter(Boolean))].sort();
  }, [dataByType, normalize]);

  const availableGenres = useMemo(() => {
    return [...new Set(dataByType.map((item) => normalize(item.genre)).filter(Boolean))].sort();
  }, [dataByType, normalize]);

  const availableYears = useMemo(() => {
    return [...new Set(dataByType.map((item) => Number(item.year)).filter(Boolean))].sort((a, b) => b - a);
  }, [dataByType]);

  const filteredContent = useMemo(() => {
    return dataByType.filter((item) => {
      const itemLanguage = normalize(item.language);
      const itemGenre = normalize(item.genre);
      const itemTitle = normalize(item.title);
      const itemYear = Number(item.year);

      const languageMatch = languageFilter === "all" || itemLanguage === normalize(languageFilter);
      const genreMatch = genreFilter === "all" || itemGenre === normalize(genreFilter);
      const yearMatch = yearFilter === "all" || itemYear === Number(yearFilter);
      const searchMatch = itemTitle.includes(normalize(search));

      return languageMatch && genreMatch && yearMatch && searchMatch;
    });
  }, [dataByType, languageFilter, genreFilter, yearFilter, search, normalize]);

  // Split content for Rendering
  const movieItems = useMemo(() => {
    return filteredContent.filter((item) => ["movie", "movies"].includes(normalize(item.type)));
  }, [filteredContent, normalize]);

  const groupedContent = useMemo(() => {
    const grouped = {};
    filteredContent.forEach((item) => {
      const cleanType = normalize(item.type);
      if (["movie", "movies"].includes(cleanType)) return;

      const title = item.title || "Unknown Title";
      const season = item.season || "1";

      if (!grouped[title]) grouped[title] = {};
      if (!grouped[title][season]) grouped[title][season] = [];
      grouped[title][season].push(item);
    });
    return grouped;
  }, [filteredContent, normalize]);

  // =========================
  // PRO FEATURES: RANDOM & TOP
  // =========================
  const playRandom = () => {
    if (filteredContent.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredContent.length);
      window.open(filteredContent[randomIndex].link, "_blank");
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // =========================
  // VOICE SEARCH LOGIC
  // =========================
  const startVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Voice search not supported");

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    setIsListening(true);

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setSearch(text.trim());
    };

    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const stopVoice = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  };

  return (
    <div className="movies-page">
      
      {/* FLOATING PRO CONTROLS */}
      <div className="fixed-controls">
        <button className="control-btn shuffle-btn" onClick={playRandom} title="Pick Random">
          🎲
        </button>
        <button className="control-btn top-btn" onClick={scrollToTop} title="Back to Top">
          ↑
        </button>
      </div>

      {/* SEARCH SECTION */}
      <div className={`search-bar ${isListening ? "active-search" : ""}`}>
        <input
          type="text"
          placeholder={isListening ? "Listening..." : "Search HARI MOVIE..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        

<button
  className={`mic-btn ${isListening ? "listening" : ""}`}
  onClick={isListening ? stopVoice : startVoiceSearch}
  aria-label={isListening ? "Stop listening" : "Start voice search"}
>
  {isListening ? (
    <img src="/icons/s.png" alt="Stop" className="btn-icon" />
  ) : (
    <img src="/icons/mic-icon.png" alt="Mic" className="btn-icon" />
  )}
</button>
      </div>

      {/* FILTER SECTION */}
      <div className="filter-bar">
        <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
          <option value="all">All Languages</option>
          {availableLanguages.map((lang) => <option key={lang} value={lang}>{lang.toUpperCase()}</option>)}
        </select>

        <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
          <option value="all">All Genres</option>
          {availableGenres.map((genre) => <option key={genre} value={genre}>{genre.toUpperCase()}</option>)}
        </select>

        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="all">All Years</option>
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>

      <h2 className="section-title">🎬 {type.toUpperCase()}</h2>

      {/* RENDER MOVIES GRID */}
      {movieItems.length > 0 && (
        <div className="grid">
          {movieItems.map((movie) => (
            <div className="card" key={movie.id} onClick={() => window.open(movie.link, "_blank")}>
              <img src={movie.img || "https://via.placeholder.com/300x450"} alt={movie.title} />
              <h3>{movie.title}</h3>
              <p>{movie.language} • {movie.year}</p>
            </div>
          ))}
        </div>
      )}

      {/* RENDER SERIES/ANIME GROUPED */}
      {Object.entries(groupedContent).map(([title, seasons]) => (
        <div key={title} className="series-block">
          <h2 className="series-title">📺 {title}</h2>
          {Object.entries(seasons).map(([season, episodes]) => (
            <div key={season} className="season-container">
              <h3 className="season-label">Season {season}</h3>
              <div className="episode-row">
                {episodes.map((ep) => (
                  <div key={ep.id} className="episode-card" onClick={() => window.open(ep.link, "_blank")}>
                    <img src={ep.img || "https://via.placeholder.com/300x450"} alt={ep.title} />
                    <p>{ep.title}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* NO RESULTS STATE */}
      {filteredContent.length === 0 && (
        <div className="no-results">
          <p>No content matches your filters. Try a different search! 🔍</p>
        </div>
      )}
    </div>
  );
}