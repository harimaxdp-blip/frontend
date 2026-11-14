<<<<<<< HEAD

import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

import {
  Search,
  Edit3,
  Trash2,
  Save,
  X,
  Link as LinkIcon,
  Image,
  Film,
  Copy,
  ClipboardPaste,
  Check,
} from "lucide-react";

import "./EditMovies.css";

const genres = [
  "Action", "Adventure", "Comedy", "Drama", "Horror",
  "Thriller", "Romance", "Sci-Fi", "Fantasy", "Animation",
  "Documentary", "Mystery", "Zombie", "Martial Arts",
  "Anime", "Crime", "Family", "Musical",
];

const languages = [
  "Tamil", "English", "Telugu", "Malayalam", "Hindi",
  "Kannada", "Punjabi", "Marathi", "Bengali", "Urdu",
  "Japanese", "Korean", "Chinese", "French", "Spanish",
  "German", "Italian", "Thai", "Arabic", "Russian",
  "Portuguese", "Turkish",
];

=======
import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";
import "./EditMovies.css";

>>>>>>> 00253219db3800c26f2415d137ec0174d23a2a85
export default function EditMovies() {
  const [movies, setMovies] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
<<<<<<< HEAD
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteMessage, setPasteMessage] = useState("");

  // FETCH MOVIES
  const fetchMovies = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "movies"));

      const data = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      data.sort((a, b) => {
        if (a.type === "movie" && b.type !== "movie") return -1;
        if (a.type !== "movie" && b.type === "movie") return 1;

        const titleCompare = (a.title || "").localeCompare(b.title || "");

        if (titleCompare !== 0) return titleCompare;

        return (
          Number(a.season || 0) - Number(b.season || 0) ||
          Number(a.episode || 0) - Number(b.episode || 0)
        );
      });

      setMovies(data);
    } catch (error) {
      console.error("Fetch error:", error);
      alert("Unable to load movies.");
    } finally {
      setLoading(false);
=======

const genres = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Horror",
  "Thriller",
  "Romance",
  "Sci-Fi",
  "Fantasy",
  "Animation",
  "Documentary",
  "Mystery",
  "Zombie",
  "Martial Arts",
  "Anime",
  "Crime",
  "Family",
  "Musical"
];

const languages = [
  "Tamil",
  "English",
  "Telugu",
  "Malayalam",
  "Hindi",
  "Kannada",
  "Punjabi",
  "Marathi",
  "Bengali",
  "Urdu",
  "Japanese",
  "Korean",
  "Chinese",
  "French",
  "Spanish",
  "German",
  "Italian",
  "Thai",
  "Arabic",
  "Russian",
  "Portuguese",
  "Turkish"
];
  const fetchMovies = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "movies"));
      const movieData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // ✅ SORT: movies first, then series/anime with season/episode order
      const sorted = movieData.sort((a, b) => {
        if (a.type === "movie" && b.type !== "movie") return -1;
        if (a.type !== "movie" && b.type === "movie") return 1;

        const titleA = (a.title || "").toLowerCase();
        const titleB = (b.title || "").toLowerCase();

        if (titleA !== titleB) return titleA.localeCompare(titleB);

        const seasonA = Number(a.season || 0);
        const seasonB = Number(b.season || 0);

        if (seasonA !== seasonB) return seasonA - seasonB;

        const episodeA = Number(a.episode || 0);
        const episodeB = Number(b.episode || 0);

        return episodeA - episodeB;
      });

      setMovies(sorted);
    } catch (err) {
      console.error("Fetch Error:", err);
>>>>>>> 00253219db3800c26f2415d137ec0174d23a2a85
    }
  };

  useEffect(() => {
    fetchMovies();
  }, []);

<<<<<<< HEAD
  // UPDATE FORM FIELD
  const updateField = (field, value) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // START EDITING
  const startEdit = (movie) => {
    setEditingId(movie.id);
    setEditForm({ ...movie });
    setPasteMessage("");
  };

  // CANCEL EDITING
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
    setPasteMessage("");
  };

  // SELECT ALL TEXT
  const selectAllText = (e) => {
    e.target.select();
  };

  // PASTE LINK FROM CLIPBOARD
  const pasteLink = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();

      if (!clipboardText.trim()) {
        setPasteMessage("Clipboard is empty!");
        return;
      }

      updateField("link", clipboardText.trim());
      setPasteMessage("New link pasted successfully!");
    } catch (error) {
      console.error("Clipboard error:", error);
      setPasteMessage(
        "Clipboard permission denied. Click URL field and press Ctrl + V."
      );
    }
  };

  // COPY LINK
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(editForm.link || "");
      setPasteMessage("Link copied successfully!");
    } catch (error) {
      console.error(error);
      setPasteMessage("Unable to copy link.");
    }
  };

  // DELETE MOVIE
  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this content?"
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "movies", id));

      setMovies((prev) => prev.filter((movie) => movie.id !== id));

      alert("Deleted successfully!");
    } catch (error) {
      console.error(error);
      alert("Failed to delete content.");
    }
  };

  // SAVE MOVIE
  const handleUpdate = async () => {
    if (!editForm.title?.trim()) {
      alert("Please enter a movie title.");
      return;
    }

    if (!editForm.link?.trim()) {
      alert("Please enter the video URL.");
      return;
    }

    try {
      setSaving(true);

      const movieRef = doc(db, "movies", editingId);

      const updatedData = {
        ...editForm,
        title: editForm.title.trim(),
        link: editForm.link.trim(),
        img: (editForm.img || "").trim(),
        year: Number(editForm.year) || 0,
        season:
          editForm.type === "movie"
            ? null
            : Number(editForm.season) || 1,
        episode:
          editForm.type === "movie"
            ? null
            : Number(editForm.episode) || 1,
      };

      await updateDoc(movieRef, updatedData);

      setMovies((prev) =>
        prev.map((movie) =>
          movie.id === editingId
            ? { ...movie, ...updatedData }
            : movie
        )
      );

      cancelEdit();

      alert("Updated successfully!");
    } catch (error) {
      console.error("Update error:", error);
      alert("Failed to update movie.");
    } finally {
      setSaving(false);
    }
  };

  // SEARCH AND FILTER
  const filteredMovies = movies.filter((movie) => {
    const matchesSearch = (movie.title || "")
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesFilter =
      filter === "all" ||
      movie.type === filter;

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="edit-container">

      {/* HEADER */}
      <div className="edit-header">
        <div>
          <span className="edit-subtitle">MOVIEHUB ADMIN PANEL</span>
          <h1>Manage Content</h1>
          <p>Manage your movies, series and anime.</p>
        </div>

        <div className="total-count">
          <Film size={22} />
          <div>
            <strong>{movies.length}</strong>
            <span>Total Content</span>
          </div>
        </div>
      </div>

      {/* SEARCH */}
      <div className="manage-toolbar">

        <div className="search-box">
          <Search size={19} />

          <input
            type="text"
            placeholder="Search movie or series..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {search && (
            <button onClick={() => setSearch("")}>×</button>
          )}
        </div>

        <div className="filter-tabs">
          {["all", "movie", "series", "anime"].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "All" : item}
            </button>
          ))}
        </div>

      </div>

      {/* LOADING */}
      {loading ? (
        <div className="empty-state">
          <Film size={35} />
          <p>Loading content...</p>
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="empty-state">
          <Film size={40} />
          <h3>No content found</h3>
          <p>Try another search.</p>
        </div>
      ) : (

        <div className="movie-list">

          {filteredMovies.map((movie) => (

            <div className="movie-card" key={movie.id}>

              {editingId === movie.id ? (

                /* EDIT MODE */
                <div className="movie-editor">

                  {/* EDIT HEADER */}
                  <div className="editor-heading">
                    <div>
                      <span>EDITING CONTENT</span>
                      <h2>{editForm.title || "Movie Details"}</h2>
                    </div>

                    <button
                      className="close-editor"
                      onClick={cancelEdit}
                    >
                      <X size={21} />
                    </button>
                  </div>

                  {/* VIDEO LINK AT TOP */}
                  <div className="top-link-editor">

                    <div className="link-label">

                      <label>
                        <LinkIcon size={18} />
                        Video / Streaming URL
                      </label>

                      <div className="link-actions">

                        <button
                          type="button"
                          className="copy-btn"
                          onClick={copyLink}
                        >
                          <Copy size={15} />
                          COPY
                        </button>

                        <button
                          type="button"
                          className="paste-btn"
                          onClick={pasteLink}
                        >
                          <ClipboardPaste size={16} />
                          PASTE LINK
                        </button>

                      </div>
                    </div>

                    <textarea
                      id={`video-link-${movie.id}`}
                      className="editor-input link-textarea"
                      value={editForm.link || ""}
                      onChange={(e) =>
                        updateField("link", e.target.value)
                      }
                      onFocus={selectAllText}
                      onClick={selectAllText}
                      placeholder="Click here and paste your new video link..."
                      spellCheck={false}
                      rows={3}
                    />

                    <div className="url-bottom-info">

                      <span>
                        <Check size={14} />
                        Click the box to select the old URL
                      </span>

                      <span>Ctrl + V to paste replacement</span>

                    </div>

                    {pasteMessage && (
                      <div className="paste-message">
                        {pasteMessage}
                      </div>
                    )}

                  </div>

                  {/* MOVIE DETAILS */}
                  <div className="editor-grid">

                    {/* POSTER */}
                    <div className="poster-section">

                      <div className="poster-preview">

                        {editForm.img ? (
                          <img
                            src={editForm.img}
                            alt="Poster preview"
                          />
                        ) : (
                          <Image size={40} />
                        )}

                      </div>

                      <label>Poster URL</label>

                      <input
                        className="editor-input"
                        value={editForm.img || ""}
                        onChange={(e) =>
                          updateField("img", e.target.value)
                        }
                        onFocus={selectAllText}
                        placeholder="Poster URL"
                      />

                    </div>

                    {/* FIELDS */}
                    <div className="editor-fields">

                      <div className="field-group">
                        <label>Movie / Series Title</label>

                        <input
                          className="editor-input"
                          value={editForm.title || ""}
                          onChange={(e) =>
                            updateField("title", e.target.value)
                          }
                          placeholder="Enter title"
                        />
                      </div>

                      <div className="field-row">

                        <div className="field-group">
                          <label>Release Year</label>

                          <input
                            className="editor-input"
                            type="number"
                            value={editForm.year ?? ""}
                            onChange={(e) =>
                              updateField("year", e.target.value)
                            }
                          />
                        </div>

                        <div className="field-group">
                          <label>Language</label>

                          <select
                            className="editor-input"
                            value={editForm.language || "Tamil"}
                            onChange={(e) =>
                              updateField("language", e.target.value)
                            }
                          >
                            {languages.map((language) => (
                              <option key={language} value={language}>
                                {language}
                              </option>
                            ))}
                          </select>
                        </div>

                      </div>

                      <div className="field-row">

                        <div className="field-group">
                          <label>Genre</label>

                          <select
                            className="editor-input"
                            value={editForm.genre || "Action"}
                            onChange={(e) =>
                              updateField("genre", e.target.value)
                            }
                          >
                            {genres.map((genre) => (
                              <option key={genre} value={genre}>
                                {genre}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field-group">
                          <label>Content Type</label>

                          <select
                            className="editor-input"
                            value={editForm.type || "movie"}
                            onChange={(e) =>
                              updateField("type", e.target.value)
                            }
                          >
                            <option value="movie">Movie</option>
                            <option value="series">Series</option>
                            <option value="anime">Anime</option>
                          </select>
                        </div>

                      </div>

                      {editForm.type !== "movie" && (

                        <div className="field-row">

                          <div className="field-group">
                            <label>Season Number</label>

                            <input
                              className="editor-input"
                              type="number"
                              min="1"
                              value={editForm.season ?? 1}
                              onChange={(e) =>
                                updateField("season", e.target.value)
                              }
                            />
                          </div>

                          <div className="field-group">
                            <label>Episode Number</label>

                            <input
                              className="editor-input"
                              type="number"
                              min="1"
                              value={editForm.episode ?? 1}
                              onChange={(e) =>
                                updateField("episode", e.target.value)
                              }
                            />
                          </div>

                        </div>

                      )}

                    </div>
                  </div>

                  {/* SAVE AND CANCEL */}
                  <div className="editor-actions">

                    <button
                      className="save-btn"
                      onClick={handleUpdate}
                      disabled={saving}
                    >
                      <Save size={17} />
                      {saving ? "SAVING..." : "SAVE CHANGES"}
                    </button>

                    <button
                      className="cancel-btn"
                      onClick={cancelEdit}
                      disabled={saving}
                    >
                      <X size={17} />
                      CANCEL
                    </button>

                  </div>

                </div>

              ) : (

                /* VIEW MODE */
                <div className="view-mode">

                  <img
                    src={movie.img || ""}
                    alt={movie.title}
                    className="edit-poster"
                  />

                  <div className="movie-info">

                    <div className="movie-title-row">
                      <h3>{movie.title}</h3>

                      <span className="type-badge">
                        {movie.type || "movie"}
                      </span>
                    </div>

                    <p>
                      {movie.year} • {movie.language} • {movie.genre}
                    </p>

                    {movie.type !== "movie" && (
                      <p className="episode-info">
                        Season {movie.season || 1} • Episode {movie.episode || 1}
                      </p>
                    )}

                    <span className="link-preview">
                      {(movie.link || "No video link").substring(0, 65)}
                      {(movie.link || "").length > 65 ? "..." : ""}
                    </span>

                  </div>

                  <div className="action-btns">

                    <button
                      className="edit-btn"
                      onClick={() => startEdit(movie)}
                    >
                      <Edit3 size={16} />
                      Edit
                    </button>

                    <button
                      className="delete-btn"
                      onClick={() => handleDelete(movie.id)}
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>

                  </div>

                </div>

              )}

            </div>

          ))}

        </div>

      )}

      <div className="results-count">
        Showing {filteredMovies.length} of {movies.length} content items
      </div>

    </div>
  );
}
=======
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
                  onChange={(e) =>
                    setEditForm({ ...editForm, title: e.target.value })
                  }
                  placeholder="Title"
                />

                <div className="edit-row">
                  <input
                    className="edit-input"
                    type="number"
                    value={editForm.year}
                    onChange={(e) =>
                      setEditForm({ ...editForm, year: e.target.value })
                    }
                  />

                  <select
                    className="edit-input"
                    value={editForm.language}
                    onChange={(e) =>
                      setEditForm({ ...editForm, language: e.target.value })
                    }
                  >
                    {languages.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>

                  <select
                    className="edit-input"
                    value={editForm.genre}
                    onChange={(e) =>
                      setEditForm({ ...editForm, genre: e.target.value })
                    }
                  >
                    {genres.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Season / Episode only for series/anime */}
                {editForm.type !== "movie" && (
                  <div className="edit-row">
                    <input
                      className="edit-input"
                      type="number"
                      placeholder="Season"
                      value={editForm.season || ""}
                      onChange={(e) =>
                        setEditForm({ ...editForm, season: e.target.value })
                      }
                    />

                    <input
                      className="edit-input"
                      type="number"
                      placeholder="Episode"
                      value={editForm.episode || ""}
                      onChange={(e) =>
                        setEditForm({ ...editForm, episode: e.target.value })
                      }
                    />
                  </div>
                )}

                <input
                  className="edit-input"
                  value={editForm.img}
                  onChange={(e) =>
                    setEditForm({ ...editForm, img: e.target.value })
                  }
                  placeholder="Poster URL"
                />

                <input
                  className="edit-input"
                  value={editForm.link}
                  onChange={(e) =>
                    setEditForm({ ...editForm, link: e.target.value })
                  }
                  placeholder="Video URL (Link)"
                />

                <div className="btn-group">
                  <button className="save-btn" onClick={handleUpdate}>
                    SAVE CHANGES
                  </button>
                  <button
                    className="cancel-btn"
                    onClick={() => setEditingId(null)}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <div className="view-mode">

                <img src={m.img} alt={m.title} className="edit-poster" />

                <div className="movie-info">
                  <h3>
                    {m.title} ({m.year})
                  </h3>

                  <p>
                    {m.language} | {m.genre}
                  </p>

                  {/* ✅ Season/Episode Display FIX */}
                  {m.type !== "movie" && (
                    <p className="episode-info">
                      Season {m.season || 1} • Episode {m.episode || 1}
                    </p>
                  )}

                  <code className="link-preview">
                    {(m.link || "").substring(0, 40)}...
                  </code>
                </div>

                <div className="action-btns">
                  <button className="edit-btn" onClick={() => startEdit(m)}>
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(m.id)}
                  >
                    Delete
                  </button>
                </div>

              </div>
            )}

          </div>
        ))}
      </div>
    </div>
  );
}
>>>>>>> 00253219db3800c26f2415d137ec0174d23a2a85
