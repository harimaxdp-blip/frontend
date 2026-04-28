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
  // NORMALIZE
  // =========================
  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .trim();

  // =========================
  // FETCH DATA
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
  // RESET FILTERS WHEN TAB CHANGES
  // =========================
  useEffect(() => {
    setLanguageFilter("all");
    setGenreFilter("all");
    setYearFilter("all");
    setSearch("");
  }, [type]);

  // =========================
  // TYPE MATCHER
  // =========================
  const matchesType = useCallback(
    (itemType) => {
      const cleanType = normalize(itemType);

      if (type === "all") return true;

      if (type === "movie") {
        return ["movie", "movies"].includes(cleanType);
      }

      if (type === "series") {
        return ["series", "tv", "show"].includes(cleanType);
      }

      if (type === "anime") {
        return ["anime"].includes(cleanType);
      }

      return true;
    },
    [type]
  );

  // =========================
  // TAB DATA
  // =========================
  const dataByType = useMemo(() => {
    return movies.filter((item) => matchesType(item.type));
  }, [movies, matchesType]);

  // =========================
  // FILTER OPTIONS BASED ON CURRENT TAB
  // =========================
  const availableLanguages = useMemo(() => {
    return [
      ...new Set(
        dataByType
          .map((item) => normalize(item.language))
          .filter(Boolean)
      ),
    ].sort();
  }, [dataByType]);

  const availableGenres = useMemo(() => {
    return [
      ...new Set(
        dataByType
          .map((item) => normalize(item.genre))
          .filter(Boolean)
      ),
    ].sort();
  }, [dataByType]);

  const availableYears = useMemo(() => {
    return [
      ...new Set(
        dataByType
          .map((item) => Number(item.year))
          .filter(Boolean)
      ),
    ].sort((a, b) => b - a);
  }, [dataByType]);

  // =========================
  // MAIN FILTER
  // IMPORTANT:
  // FILTER ON ALL TYPES, NOT JUST MOVIES
  // =========================
  const filteredContent = useMemo(() => {
    return dataByType.filter((item) => {
      const itemLanguage = normalize(item.language);
      const itemGenre = normalize(item.genre);
      const itemTitle = normalize(item.title);
      const itemYear = Number(item.year);

      const languageMatch =
        languageFilter === "all" ||
        itemLanguage === normalize(languageFilter);

      const genreMatch =
        genreFilter === "all" ||
        itemGenre === normalize(genreFilter);

      const yearMatch =
        yearFilter === "all" ||
        itemYear === Number(yearFilter);

      const searchMatch =
        itemTitle.includes(normalize(search));

      return (
        languageMatch &&
        genreMatch &&
        yearMatch &&
        searchMatch
      );
    });
  }, [
    dataByType,
    languageFilter,
    genreFilter,
    yearFilter,
    search,
  ]);

  // =========================
  // MOVIES
  // =========================
  const movieItems = useMemo(() => {
    return filteredContent.filter((item) =>
      ["movie", "movies"].includes(normalize(item.type))
    );
  }, [filteredContent]);

  // =========================
  // SERIES + ANIME
  // IMPORTANT:
  // ANIME MUST ALSO FILTER HERE
  // =========================
  const groupedContent = useMemo(() => {
    const grouped = {};

    filteredContent.forEach((item) => {
      const cleanType = normalize(item.type);

      // Skip only movies
      if (["movie", "movies"].includes(cleanType)) return;

      const title = item.title || "Unknown Title";
      const season = item.season || "1";

      if (!grouped[title]) {
        grouped[title] = {};
      }

      if (!grouped[title][season]) {
        grouped[title][season] = [];
      }

      grouped[title][season].push(item);
    });

    return grouped;
  }, [filteredContent]);

  // =========================
  // VOICE
  // =========================
  const stopVoice = () => {
    setIsListening(false);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const startVoiceSearch = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice search not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;

    setIsListening(true);

    recognition.onresult = (event) => {
      let text = "";

      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }

      setSearch(text.trim());
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.start();
  };

  return (
    <div className="movies-page">

      {/* SEARCH */}
      <div className={`search-bar ${isListening ? "active-search" : ""}`}>
        <input
          type="text"
          placeholder={isListening ? "🎤 Listening..." : "Search content..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />

        <button
          className={`mic-btn ${isListening ? "listening" : ""}`}
          onClick={isListening ? stopVoice : startVoiceSearch}
        >
          {isListening ? "⛔" : "🎤"}
        </button>
      </div>

      {/* FILTERS */}
      <div className="filter-bar">
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
        >
          <option value="all">All Languages</option>
          {availableLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>

        <select
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
        >
          <option value="all">All Genres</option>
          {availableGenres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>

        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
        >
          <option value="all">All Years</option>
          {availableYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {/* TITLE */}
      <h2 style={{ color: "white", marginBottom: 20 }}>
        🎬 {type.toUpperCase()}
      </h2>

      {/* MOVIES */}
      {movieItems.length > 0 && (
        <div className="grid">
          {movieItems.map((movie) => (
            <div
              className="card"
              key={movie.id}
              onClick={() => window.open(movie.link, "_blank")}
            >
              <img
                src={movie.img || "https://via.placeholder.com/300x450"}
                alt={movie.title}
              />

              <h3>{movie.title}</h3>

              <p>
                {movie.language || "Unknown"} • {movie.year || "N/A"}
              </p>

              <p style={{ color: "#999", fontSize: "12px" }}>
                {movie.genre || "Unknown"}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* SERIES + ANIME */}
      {Object.entries(groupedContent).map(([title, seasons]) => (
        <div key={title} className="series-block">

          <h2 style={{ color: "white", marginTop: 30 }}>
            📺 {title}
          </h2>

          {Object.entries(seasons).map(([season, episodes]) => (
            <div key={season} style={{ marginLeft: 20 }}>

              <h3 style={{ color: "#aaa" }}>
                Season {season}
              </h3>

              <div className="episode-row">
                {episodes.map((ep) => (
                  <div
                    key={ep.id}
                    className="episode-card"
                    onClick={() => window.open(ep.link, "_blank")}
                  >
                    <img
                      src={ep.img || "https://via.placeholder.com/300x450"}
                      alt={ep.title}
                    />

                    <p>{ep.title}</p>

                    <p style={{ color: "#999", fontSize: "12px" }}>
                      {ep.language || "Unknown"} • {ep.genre || "Unknown"}
                    </p>
                  </div>
                ))}
              </div>

            </div>
          ))}

        </div>
      ))}

      {/* EMPTY */}
      {filteredContent.length === 0 && (
        <p style={{ color: "gray", marginTop: 30 }}>
          No content found
        </p>
      )}

    </div>
  );
}