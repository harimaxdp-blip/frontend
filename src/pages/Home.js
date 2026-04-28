import { useEffect, useRef, useState } from "react";
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
  // FILTER DATA BY CURRENT TYPE
  // =========================
  const dataByType =
    type === "all"
      ? movies
      : movies.filter(
          (m) =>
            (m.type || "").toLowerCase().trim() ===
            type.toLowerCase().trim()
        );

  // =========================
  // AUTO FILTER OPTIONS
  // =========================
  const availableLanguages = [
    ...new Set(
      dataByType
        .map((m) => (m.language || "").trim())
        .filter(Boolean)
    ),
  ].sort();

  const availableGenres = [
    ...new Set(
      dataByType
        .map((m) => (m.genre || "").trim())
        .filter(Boolean)
    ),
  ].sort();

  const availableYears = [
    ...new Set(
      dataByType
        .map((m) => Number(m.year))
        .filter(Boolean)
    ),
  ].sort((a, b) => b - a);

  // =========================
  // STOP VOICE
  // =========================
  const stopVoice = () => {
    setIsListening(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

  // =========================
  // VOICE SEARCH
  // =========================
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

  // =========================
  // MAIN FILTER LOGIC
  // =========================
  const filteredMovies = dataByType.filter((item) => {
    const itemLanguage = (item.language || "").toLowerCase().trim();
    const itemGenre = (item.genre || "").toLowerCase().trim();
    const itemTitle = (item.title || "").toLowerCase().trim();

    return (
      (languageFilter === "all" ||
        itemLanguage === languageFilter.toLowerCase().trim()) &&

      (genreFilter === "all" ||
        itemGenre === genreFilter.toLowerCase().trim()) &&

      (yearFilter === "all" ||
        Number(item.year) === Number(yearFilter)) &&

      itemTitle.includes(search.toLowerCase().trim())
    );
  });

  // =========================
  // GROUP SERIES + ANIME
  // =========================
  const groupedContent = {};

  filteredMovies.forEach((item) => {
    // MOVIES DIRECT GRID
    if (item.type === "movie") return;

    if (!groupedContent[item.title]) {
      groupedContent[item.title] = {};
    }

    const seasonKey = item.season || "1";

    if (!groupedContent[item.title][seasonKey]) {
      groupedContent[item.title][seasonKey] = [];
    }

    groupedContent[item.title][seasonKey].push(item);
  });

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

        {/* LANGUAGE */}
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
        >
          <option value="all">All Languages</option>
          {availableLanguages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        {/* GENRE */}
        <select
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
        >
          <option value="all">All Genres</option>
          {availableGenres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        {/* YEAR */}
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
        >
          <option value="all">All Years</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

      </div>

      {/* TITLE */}
      <h2 style={{ color: "white", marginBottom: 20 }}>
        🎬 {type.toUpperCase()}
      </h2>

      {/* MOVIE GRID */}
      <div className="grid">
        {filteredMovies
          .filter(
            (m) =>
              (m.type || "").toLowerCase().trim() === "movie"
          )
          .map((m) => (
            <div
              className="card"
              key={m.id}
              onClick={() => window.open(m.link, "_blank")}
            >
              <img
                src={m.img || "https://via.placeholder.com/300x450"}
                alt={m.title}
              />

              <h3>{m.title}</h3>

              <p>
                {m.language || "Unknown"} • {m.year || "N/A"}
              </p>

              <p style={{ color: "#999", fontSize: "12px" }}>
                {m.genre || "Unknown"}
              </p>
            </div>
          ))}
      </div>

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
                      src={
                        ep.img ||
                        "https://via.placeholder.com/300x450"
                      }
                      alt={ep.title}
                    />

                    <p>
                      Episode {ep.episode || "N/A"}
                    </p>

                    <p style={{ color: "#999", fontSize: "12px" }}>
                      {ep.genre || "Unknown"}
                    </p>
                  </div>
                ))}
              </div>

            </div>
          ))}

        </div>
      ))}

      {/* NO RESULTS */}
      {filteredMovies.length === 0 && (
        <p style={{ color: "gray", marginTop: 30 }}>
          No content found
        </p>
      )}

    </div>
  );
}