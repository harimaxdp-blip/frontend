import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";
import "./Movies.css";

export default function Home({ active }) {
  const [movies, setMovies] = useState([]);

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

  // FILTER LOGIC
  const filteredMovies = movies.filter((item) => {
    if (active === "MOVIES") return item.type === "movie";
    if (active === "SERIES") return item.type === "series";
    return true; // ALL
  });

  return (
    <div className="movies-page">

      <h2 style={{ color: "white", marginBottom: 20 }}>
        🎬 {active}
      </h2>

      <div className="grid">

        {filteredMovies.length === 0 ? (
          <p style={{ color: "gray" }}>No content found</p>
        ) : (
          filteredMovies.map((m) => (
            <div
              className="card"
              key={m.id}
              onClick={() => window.open(m.link, "_blank")}
            >
              <img src={m.img} alt={m.title} />
              <h3>{m.title}</h3>
              <p>{m.language} • {m.year}</p>
              <p style={{ color: "gray", fontSize: 12 }}>
                {m.genre}
              </p>
            </div>
          ))
        )}

      </div>

    </div>
  );
}