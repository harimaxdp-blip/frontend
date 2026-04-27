import { useState } from "react";
import { getMovies, saveMovies } from "../utils/movieStorage";
import "./Movies.css";

export default function UploadMovie() {
  const [movie, setMovie] = useState({
    title: "",
    year: "",
    language: "",
    genre: "",
    link: "",
    img: "",
  });

  const handleUpload = () => {
    const existing = getMovies();
    const updated = [...existing, movie];

    saveMovies(updated);

    alert("Movie Uploaded Successfully!");

    setMovie({
      title: "",
      year: "",
      language: "",
      genre: "",
      link: "",
      img: "",
    });
  };

  return (
    <div className="upload-page">

      <div className="form-box">

        <h2>🎬 Upload Movie</h2>

        <input placeholder="Title"
          value={movie.title}
          onChange={(e) => setMovie({ ...movie, title: e.target.value })}
        />

        <input placeholder="Year"
          value={movie.year}
          onChange={(e) => setMovie({ ...movie, year: e.target.value })}
        />

        <input placeholder="Language"
          value={movie.language}
          onChange={(e) => setMovie({ ...movie, language: e.target.value })}
        />

        <input placeholder="Genre"
          value={movie.genre}
          onChange={(e) => setMovie({ ...movie, genre: e.target.value })}
        />

        <input placeholder="Video Link"
          value={movie.link}
          onChange={(e) => setMovie({ ...movie, link: e.target.value })}
        />

        <input placeholder="Image URL"
          value={movie.img}
          onChange={(e) => setMovie({ ...movie, img: e.target.value })}
        />

        <button onClick={handleUpload}>Upload Movie</button>

      </div>

    </div>
  );
}