import { useEffect, useState } from "react";
import { getMovies } from "../utils/movieStorage";

export default function Home() {
  const [movies, setMovies] = useState([]);

  useEffect(() => {
    setMovies(getMovies());
  }, []);

  return (
    <div className="grid">

      {movies.map((m, i) => (
        <div className="card" key={i}
          onClick={() => window.open(m.link, "_blank")}
          style={{ cursor: "pointer" }}
        >
          <img src={m.img} alt={m.title} />
          <h3>{m.title}</h3>
          <p>{m.language} • {m.year}</p>
        </div>
      ))}

    </div>
  );
}