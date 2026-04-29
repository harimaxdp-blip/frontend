import { useState } from "react";
import "./Movies.css";
import { db } from "../firebase";
import { collection, addDoc } from "firebase/firestore";

export default function UploadMovie() {
  const currentYear = new Date().getFullYear();

  const [movie, setMovie] = useState({
    title: "",
    year: currentYear,
    language: "",
    genre: "",
    link: "",
    img: "",
    type: "movie",
    season: "",
    episode: "",
  });

  const genres = ["Action", "Adventure", "Comedy", "Drama", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Animation", "Documentary","Mystery"];
  const languages = ["Tamil", "Tamil Dubbed", "English", "Telugu", "Malayalam", "Hindi","Korean", "Chinese", "Japanese"];
  const handleUpload = async () => {
    try {
      const { title, year, language, genre, link, img, type } = movie;

      if (!title || !year || !language || !genre || !link || !img) {
        alert("⚠️ Please fill all required fields");
        return;
      }

      await addDoc(collection(db, "movies"), {
        title: title.trim(),
        year: Number(year),
        language,
        genre,
        link: link.trim(),
        img: img.trim(),
        type,
        season: type === "movie" ? null : Number(movie.season) || 1,
        episode: type === "movie" ? null : Number(movie.episode) || 1,
        createdAt: new Date()
      });

      alert("🎬 Upload Success!");
      
      setMovie({
        title: "", year: currentYear, language: "", genre: "",
        link: "", img: "", type: "movie", season: "", episode: ""
      });

    } catch (err) {
      console.error("UPLOAD ERROR:", err);
      alert("Upload failed");
    }
  };

  return (
    <div className="movies-page">
      <div className="tv-upload">
        <h1 className="tv-title">🎬 Add Content</h1>

        <div className="tv-grid">
          {/* Row 1: Title & Year */}
          <input
            className="tv-input span-2"
            placeholder="Movie Title"
            value={movie.title}
            onChange={(e) => setMovie({ ...movie, title: e.target.value })}
          />
          <input
            className="tv-input"
            type="number"
            placeholder="Year"
            value={movie.year}
            onChange={(e) => setMovie({ ...movie, year: e.target.value })}
          />

          {/* Row 2: Type, Lang, Genre */}
          <select
            className="tv-input"
            value={movie.type}
            onChange={(e) => setMovie({ ...movie, type: e.target.value })}
          >
            <option value="movie">Movie</option>
            <option value="series">Series</option>
            <option value="anime">Anime</option>
          </select>

          <select
            className="tv-input"
            value={movie.language}
            onChange={(e) => setMovie({ ...movie, language: e.target.value })}
          >
            <option value="">Select Language</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          <select
            className="tv-input"
            value={movie.genre}
            onChange={(e) => setMovie({ ...movie, genre: e.target.value })}
          >
            <option value="">Select Genre</option>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>

          {/* Conditional Row: Season & Episode */}
          {movie.type !== "movie" && (
            <>
              <input
                className="tv-input"
                placeholder="Season Number"
                type="number"
                value={movie.season}
                onChange={(e) => setMovie({ ...movie, season: e.target.value })}
              />
              <input
                className="tv-input span-2"
                placeholder="Episode Number"
                type="number"
                value={movie.episode}
                onChange={(e) => setMovie({ ...movie, episode: e.target.value })}
              />
            </>
          )}

          {/* Row 3: URLs */}
          <input
            className="tv-input span-3"
            placeholder="Image URL (Poster)"
            value={movie.img}
            onChange={(e) => setMovie({ ...movie, img: e.target.value })}
          />
          <input
            className="tv-input span-3"
            placeholder="Video Link (Direct URL)"
            value={movie.link}
            onChange={(e) => setMovie({ ...movie, link: e.target.value })}
          />
        </div>

        <button className="tv-button" onClick={handleUpload}>
          CONFIRM UPLOAD
        </button>
      </div>
    </div>
  );
}