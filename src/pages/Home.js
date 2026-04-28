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

  // 🔥 FETCH DATA
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

  // 🔥 IMPORTANT FIX: FILTER DATA BY TYPE FIRST
  const dataByType = type === "all"
    ? movies
    : movies.filter((m) => m.type === type);

  // 🔥 AUTO FILTER OPTIONS BASED ON TYPE ONLY
  const availableLanguages = [
    ...new Set(dataByType.map((m) => m.language).filter(Boolean))
  ];

  const availableGenres = [
    ...new Set(dataByType.map((m) => m.genre).filter(Boolean))
  ];

  const availableYears = [
    ...new Set(dataByType.map((m) => Number(m.year)).filter(Boolean))
  ].sort((a, b) => b - a);

  // 🛑 STOP MIC
  const stopVoice = () => {
    setIsListening(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

  // 🎤 VOICE SEARCH
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

  // 🔥 FILTER LOGIC (NOW SAFE + CLEAN)
  const filteredMovies = dataByType.filter((item) => {
    return (
      (languageFilter === "all" || item.language === languageFilter) &&
      (genreFilter === "all" || item.genre === genreFilter) &&
      (yearFilter === "all" || Number(item.year) === Number(yearFilter)) &&
      (item.title || "").toLowerCase().includes(search.toLowerCase())
    );
  });

  // SERIES GROUPING
  const groupedSeries = {};

  filteredMovies.forEach((item) => {
    if (item.type === "movie") return;

    if (!groupedSeries[item.title]) {
      groupedSeries[item.title] = {};
    }

    if (!groupedSeries[item.title][item.season]) {
      groupedSeries[item.title][item.season] = [];
    }

    groupedSeries[item.title][item.season].push(item);
  });

  return (
    <div className="movies-page">

      {/* SEARCH */}
      <div className={`search-bar ${isListening ? "active-search" : ""}`}>
        <input
          type="text"
          placeholder={isListening ? "🎤 Listening..." : "Search movies..."}
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
        <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
          <option value="all">All Languages</option>
          {availableLanguages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        {/* GENRE */}
        <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
          <option value="all">All Genres</option>
          {availableGenres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        {/* YEAR */}
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="all">All Years</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

      </div>

      <h2 style={{ color: "white", marginBottom: 20 }}>
        🎬 {type.toUpperCase()}
      </h2>

      {/* MOVIES */}
      <div className="grid">
        {filteredMovies
          .filter((m) => m.type === "movie")
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
              <p>{m.language} • {m.year}</p>
            </div>
          ))}
      </div>

      {/* SERIES */}
      {Object.entries(groupedSeries).map(([title, seasons]) => (
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
                    <img src={ep.img} alt={ep.title} />
                    <p>Episode {ep.episode}</p>
                  </div>
                ))}
              </div>

            </div>
          ))}

        </div>
      ))}

    </div>
  );
}