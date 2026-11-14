import React, { useEffect, useState } from "react";
import { db } from "../firebase";

import {
  collection,
  addDoc,
  onSnapshot,
  deleteDoc,
  doc,
} from "firebase/firestore";

import "./Banner.css";

export default function Banner() {
  const [movies, setMovies] = useState([]);
  const [banners, setBanners] = useState([]);

  const [form, setForm] = useState({
    title: "",
    description: "",
    imageUrl: "",
    logo: "",
    movieRef: "",
    language: "",
    genre: "",
    year: "",
    order: 0,
    active: true,
  });

  // Load movies
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "movies"), (snap) => {
      setMovies(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    });

    return () => unsub();
  }, []);

  // Load banners
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "banners"), (snap) => {
      setBanners(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    });

    return () => unsub();
  }, []);

  // Select movie
  const handleMovieSelect = (movieId) => {
    const movie = movies.find((m) => m.id === movieId);

    if (!movie) return;

    setForm({
      ...form,
      title: movie.title || "",
      description: movie.description || "",
      imageUrl: movie.banner || movie.img || "",
      movieRef: movie,
      language: movie.language || "",
      genre: movie.genre || "",
      year: movie.year || "",
    });
  };

  // Save banner
  const saveBanner = async () => {
    if (!form.title || !form.imageUrl) {
      alert("Fill all required fields");
      return;
    }

    await addDoc(collection(db, "banners"), form);

    alert("Banner Added!");

    setForm({
      title: "",
      description: "",
      imageUrl: "",
      logo: "",
      movieRef: "",
      language: "",
      genre: "",
      year: "",
      order: 0,
      active: true,
    });
  };

  // Delete banner
  const removeBanner = async (id) => {
    await deleteDoc(doc(db, "banners", id));
  };

  return (
    <div className="banner-page">

      <h1>Banner Manager</h1>

      <div className="banner-form">

        {/* Movie Select */}
        <select
          onChange={(e) => handleMovieSelect(e.target.value)}
        >
          <option value="">Select Movie</option>

          {movies.map((movie) => (
            <option key={movie.id} value={movie.id}>
              {movie.title}
            </option>
          ))}
        </select>

        {/* Banner Image */}
        <input
          type="text"
          placeholder="Banner Image URL"
          value={form.imageUrl}
          onChange={(e) =>
            setForm({ ...form, imageUrl: e.target.value })
          }
        />

        {/* Logo */}
        <input
          type="text"
          placeholder="Logo URL"
          value={form.logo}
          onChange={(e) =>
            setForm({ ...form, logo: e.target.value })
          }
        />

        {/* Title */}
        <input
          type="text"
          placeholder="Title"
          value={form.title}
          onChange={(e) =>
            setForm({ ...form, title: e.target.value })
          }
        />

        {/* Description */}
        <textarea
          placeholder="Description"
          value={form.description}
          onChange={(e) =>
            setForm({ ...form, description: e.target.value })
          }
        />

        {/* Order */}
        <input
          type="number"
          placeholder="Order"
          value={form.order}
          onChange={(e) =>
            setForm({ ...form, order: Number(e.target.value) })
          }
        />

        {/* Active */}
        <label className="active-check">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) =>
              setForm({ ...form, active: e.target.checked })
            }
          />
          Active
        </label>

        <button onClick={saveBanner}>
          Save Banner
        </button>
      </div>

      {/* Banner List */}
      <div className="banner-grid">
        {banners.map((banner) => (
          <div key={banner.id} className="banner-card">

            <img src={banner.imageUrl} alt={banner.title} />

            <h3>{banner.title}</h3>

            <p>{banner.description}</p>

            <button
              className="delete-btn"
              onClick={() => removeBanner(banner.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}