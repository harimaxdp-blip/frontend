import { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import "./Movies.css";

export default function EditMovies() {
  const [movies, setMovies] = useState([]);

  // store edits per movie
  const [editData, setEditData] = useState({});

  // 🔴 REALTIME FETCH
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

  // ✏️ UPDATE FULL MOVIE
  const handleUpdate = async (id) => {
    try {
      const ref = doc(db, "movies", id);

      await updateDoc(ref, {
        title: editData[id]?.title || "",
        year: editData[id]?.year || "",
        language: editData[id]?.language || "",
        genre: editData[id]?.genre || "",
        link: editData[id]?.link || "",
        img: editData[id]?.img || "",
      });

      alert("Updated Successfully");
    } catch (err) {
      console.error(err);
      alert("Update failed");
    }
  };

  // 🗑️ DELETE
  const handleDelete = async (id) => {
    try {
      await deleteDoc(doc(db, "movies", id));
      alert("Deleted Successfully");
    } catch (err) {
      console.error(err);
      alert("Delete failed");
    }
  };

  // 🧠 handle input change
  const handleChange = (id, field, value) => {
    setEditData((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  return (
    <div className="movies-page">

      <h2 style={{ color: "red" }}>EDIT MOVIES</h2>

      <div className="grid">

        {movies.map((m) => (
          <div className="card" key={m.id}>

            {/* IMAGE */}
            <img
              src={m.img || "https://via.placeholder.com/300x450"}
              alt={m.title}
            />

            {/* TITLE */}
            <input
              className="edit-input"
              placeholder="Title"
              defaultValue={m.title}
              onChange={(e) =>
                handleChange(m.id, "title", e.target.value)
              }
            />

            {/* YEAR */}
            <input
              className="edit-input"
              placeholder="Year"
              defaultValue={m.year}
              onChange={(e) =>
                handleChange(m.id, "year", e.target.value)
              }
            />

            {/* LANGUAGE */}
            <input
              className="edit-input"
              placeholder="Language"
              defaultValue={m.language}
              onChange={(e) =>
                handleChange(m.id, "language", e.target.value)
              }
            />

            {/* GENRE */}
            <input
              className="edit-input"
              placeholder="Genre"
              defaultValue={m.genre}
              onChange={(e) =>
                handleChange(m.id, "genre", e.target.value)
              }
            />

            {/* LINK */}
            <input
              className="edit-input"
              placeholder="Video Link"
              defaultValue={m.link}
              onChange={(e) =>
                handleChange(m.id, "link", e.target.value)
              }
            />

            {/* IMAGE URL */}
            <input
              className="edit-input"
              placeholder="Image URL"
              defaultValue={m.img}
              onChange={(e) =>
                handleChange(m.id, "img", e.target.value)
              }
            />

            {/* BUTTONS */}
            <button
              className="update-btn"
              onClick={() => handleUpdate(m.id)}
            >
              Update
            </button>

            <button
              className="delete-btn"
              onClick={() => handleDelete(m.id)}
            >
              Delete
            </button>

          </div>
        ))}

      </div>
    </div>
  );
}