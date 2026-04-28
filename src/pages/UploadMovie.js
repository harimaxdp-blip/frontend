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

  const genres = [
    "Action","Adventure","Comedy","Drama","Horror","Thriller",
    "Romance","Sci-Fi","Fantasy","Mystery","Crime",
    "Animation","Documentary","Musical","Historical"
  ];

  const languages = [
    "Tamil",
    "Tamil Dubbed",
    "English",
    "Telugu",
    "Malayalam",
    "Hindi"
  ];

  // ✅ HANDLE UPLOAD
  const handleUpload = async () => {
    try {
      const { title, year, language, genre, link, img, type } = movie;

      // validation
      if (!title || !year || !language || !genre || !link || !img) {
        alert("⚠️ Please fill all fields");
        return;
      }

      await addDoc(collection(db, "movies"), {
        title: title.trim(),
        year: Number(year),   // 🔥 IMPORTANT FIX
        language,
        genre,
        link,
        img,
        type,

        // series / anime only
        season: type === "movie" ? null : Number(movie.season) || 1,
        episode: type === "movie" ? null : Number(movie.episode) || 1,

        createdAt: new Date()
      });

      alert("🎬 Upload Success!");

      // reset form properly
      setMovie({
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

    } catch (err) {
      console.error("UPLOAD ERROR:", err);
      alert("Upload failed");
    }
  };

  return (
    <div className="tv-upload">

      <h1 className="tv-title">🎬 Upload Movie / Series / Anime</h1>

      <div className="tv-grid">

        {/* TITLE */}
        <input
          className="tv-input"
          placeholder="Title"
          value={movie.title}
          onChange={(e) =>
            setMovie({ ...movie, title: e.target.value })
          }
        />

        {/* TYPE */}
        <select
          className="tv-input"
          value={movie.type}
          onChange={(e) =>
            setMovie({ ...movie, type: e.target.value })
          }
        >
          <option value="movie">Movie</option>
          <option value="series">Series</option>
          <option value="anime">Anime</option>
        </select>

        {/* YEAR */}
        <input
          className="tv-input"
          type="number"
          min="1900"
          max={currentYear}
          placeholder="Year"
          value={movie.year}
          onChange={(e) =>
            setMovie({ ...movie, year: e.target.value })
          }
        />

        {/* LANGUAGE */}
        <select
          className="tv-input"
          value={movie.language}
          onChange={(e) =>
            setMovie({ ...movie, language: e.target.value })
          }
        >
          <option value="">Select Language</option>
          {languages.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        {/* GENRE */}
        <select
          className="tv-input"
          value={movie.genre}
          onChange={(e) =>
            setMovie({ ...movie, genre: e.target.value })
          }
        >
          <option value="">Select Genre</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        {/* SEASON + EPISODE */}
        {movie.type !== "movie" && (
          <>
            <input
              className="tv-input"
              placeholder="Season"
              value={movie.season}
              onChange={(e) =>
                setMovie({ ...movie, season: e.target.value })
              }
            />

            <input
              className="tv-input"
              placeholder="Episode"
              value={movie.episode}
              onChange={(e) =>
                setMovie({ ...movie, episode: e.target.value })
              }
            />
          </>
        )}

        {/* LINK */}
        <input
          className="tv-input"
          placeholder="Video Link"
          value={movie.link}
          onChange={(e) =>
            setMovie({ ...movie, link: e.target.value })
          }
        />

        {/* IMAGE */}
        <input
          className="tv-input"
          placeholder="Image URL"
          value={movie.img}
          onChange={(e) =>
            setMovie({ ...movie, img: e.target.value })
          }
        />

      </div>

      <button className="tv-button" onClick={handleUpload}>
        UPLOAD
      </button>

    </div>
  );
}