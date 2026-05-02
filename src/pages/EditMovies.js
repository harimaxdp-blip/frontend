import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";
import "./EditMovies.css";

export default function EditMovies() {
  const [movies, setMovies] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const genres = ["Action", "Adventure", "Comedy", "Drama", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Animation", "Documentary", "Mystery","Zombie"];
  const languages = ["Tamil", "English", "Telugu", "Malayalam", "Hindi", "Korean", "Chinese", "Japanese"];

  const fetchMovies = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "movies"));
      const movieData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMovies(movieData);
    } catch (err) {
      console.error("Fetch Error:", err);
    }
  };

  useEffect(() => {
    fetchMovies();
  }, []);

  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this content?")) {
      try {
        await deleteDoc(doc(db, "movies", id));
        setMovies(movies.filter((m) => m.id !== id));
        alert("Deleted successfully!");
      } catch (err) {
        console.error(err);
      }
    }
  };

  const startEdit = (movie) => {
    setEditingId(movie.id);
    setEditForm(movie);
  };

  const handleUpdate = async () => {
    try {
      const movieRef = doc(db, "movies", editingId);
      await updateDoc(movieRef, {
        ...editForm,
        title: editForm.title.trim(),
        link: editForm.link.trim(),
        img: editForm.img.trim(),
        year: Number(editForm.year),
        season: editForm.type === "movie" ? null : Number(editForm.season) || 1,
        episode: editForm.type === "movie" ? null : Number(editForm.episode) || 1,
      });
      alert("Updated successfully!");
      setEditingId(null);
      fetchMovies();
    } catch (err) {
      console.error("Update Error:", err);
      alert("Failed to update.");
    }
  };

  return (
    <div className="edit-container">
      <h1 className="edit-title">🎬 Manage Content</h1>
      
      <div className="movie-list">
        {movies.map((m) => (
          <div key={m.id} className="movie-card">
            {editingId === m.id ? (
              <div className="edit-mode-form">
                <input 
                  className="edit-input"
                  value={editForm.title} 
                  onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                  placeholder="Title"
                />
                
                <div className="edit-row">
                  <input 
                    className="edit-input"
                    type="number"
                    value={editForm.year} 
                    onChange={(e) => setEditForm({...editForm, year: e.target.value})}
                  />
                  <select 
                    className="edit-input"
                    value={editForm.language} 
                    onChange={(e) => setEditForm({...editForm, language: e.target.value})}
                  >
                    {languages.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <select 
                    className="edit-input"
                    value={editForm.genre} 
                    onChange={(e) => setEditForm({...editForm, genre: e.target.value})}
                  >
                    {genres.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>

                <input 
                  className="edit-input"
                  value={editForm.img} 
                  onChange={(e) => setEditForm({...editForm, img: e.target.value})}
                  placeholder="Poster URL"
                />

                <input 
                  className="edit-input"
                  value={editForm.link} 
                  onChange={(e) => setEditForm({...editForm, link: e.target.value})}
                  placeholder="Video URL (Link)"
                />

                <div className="btn-group">
                  <button className="save-btn" onClick={handleUpdate}>SAVE CHANGES</button>
                  <button className="cancel-btn" onClick={() => setEditingId(null)}>CANCEL</button>
                </div>
              </div>
            ) : (
              <div className="view-mode">
                <img src={m.img} alt={m.title} className="edit-poster" />
                <div className="movie-info">
                  <h3>{m.title} ({m.year})</h3>
                  <p>{m.language} | {m.genre}</p>
                  <code className="link-preview">{m.link.substring(0, 40)}...</code>
                </div>
                <div className="action-btns">
                  <button className="edit-btn" onClick={() => startEdit(m)}>Edit</button>
                  <button className="delete-btn" onClick={() => handleDelete(m.id)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}