import { useState, useEffect } from "react";
import "./Movies.css";
import { db } from "../firebase";
import { collection, addDoc, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import DeviceControl from "../plugins/deviceControl";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Settings,
  ArrowLeft,
  Maximize,
  Volume2,
  Volume1,
  SkipForward,
  SkipBack
} from "lucide-react";

// ─── Tab IDs ────────────────────────────────────────────────────────────────
const TAB_UPLOAD = "upload";
const TAB_BANNER = "banner";
const TAB_REMOTE = "remote";

export default function UploadMovie() {
  const currentYear = new Date().getFullYear();

  // ── Upload form state ──────────────────────────────────────────────────────
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
    seriesTitle: "",
  });

  // ── Banner state ───────────────────────────────────────────────────────────
  const [allMovies, setAllMovies]         = useState([]);
  const [banners, setBanners]             = useState([]);   // current banners from Firestore
  const [bannerCount, setBannerCount]     = useState(1);    // how many slots (1–10)
const [slots, setSlots] = useState(
  Array.from({ length: 10 }, () => ({
    movieId: "",
    description: "",
    active: true,
    bannerImage: "",
    bannerType: "movie",
  }))
);
  const [bannerSaving, setBannerSaving]   = useState(false);
  const [activeTab, setActiveTab]         = useState(TAB_UPLOAD);

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

  // ── Load all movies + banners ──────────────────────────────────────────────
  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, "movies"), (snap) => {
      setAllMovies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsub2 = onSnapshot(collection(db, "banners"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      setBanners(data);

      // Pre-fill slots from existing banners
      const filled = Array.from({ length: 10 }, () => ({
        movieId: "", description: "", active: true,
      }));
      data.forEach((b, i) => {
        if (i < 10) {
filled[i] = {
  movieId: b.movieRef?.id || b.movieId || "",
  description: b.description || "",
  active: b.active !== false,
  bannerImage: b.imageUrl || "",
  bannerType: b.bannerType || "movie",
};
        }
      });
      setSlots(filled);
      if (data.length > 0) setBannerCount(Math.min(data.length, 10));
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleUpload = async () => {
    try {
      const { title, year, language, genre, link, img, type } = movie;
      if (!title || !year || !language || !genre || !link || !img) {
        alert("⚠️ Please fill all required fields");
        return;
      }
      await addDoc(collection(db, "movies"), {
        title:       title.trim(),
        year:        Number(year),
        language,
        genre,
        link:        link.trim(),
        img:         img.trim(),
        type,
        seriesTitle: type !== "movie" ? (movie.seriesTitle.trim() || title.trim()) : null,
        season:      type !== "movie" ? (Number(movie.season) || 1) : null,
        episode:     type !== "movie" ? (Number(movie.episode) || 1) : null,
        createdAt:   new Date(),
      });
      alert("🎬 Upload Success!");
      // Fields intentionally not reset (per original spec)
    } catch (err) {
      console.error("UPLOAD ERROR:", err);
      alert("❌ Upload failed");
    }
  };

  // ── Banner save handler ────────────────────────────────────────────────────
  const handleSaveBanners = async () => {
    setBannerSaving(true);
    try {
      // Delete all old banners first
      await Promise.all(banners.map((b) => deleteDoc(doc(db, "banners", b.id))));

      // Write new ones
      const activeSlots = slots.slice(0, bannerCount).filter((s) => s.movieId);
      await Promise.all(
        activeSlots.map(async (slot, i) => {
          const movieRef = allMovies.find((m) => m.id === slot.movieId);
          if (!movieRef) return;
          const bannerId = `banner_slot_${i + 1}`;
          await setDoc(doc(db, "banners", bannerId), {
            order:       i + 1,
            active:      slot.active,
            movieId:     slot.movieId,
            movieRef:    movieRef,             // full movie object for Home.js
            title:       movieRef.title,
            imageUrl: slot.bannerImage || movieRef.img || "",
            bannerType: slot.bannerType || "movie",
            year:        movieRef.year || "",
            language:    movieRef.language || "",
            genre:       movieRef.genre || "",
            description: slot.description.trim() || "",
            updatedAt:   new Date(),
          });
        })
      );
      alert(`✅ ${activeSlots.length} banner(s) saved!`);
    } catch (err) {
      console.error("BANNER SAVE ERROR:", err);
      alert("❌ Failed to save banners");
    } finally {
      setBannerSaving(false);
    }
  };

  const updateSlot = (index, field, value) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const getMoviePreview = (id) => allMovies.find((m) => m.id === id) || null;

  // ── Remote commands ────────────────────────────────────────────────────────
  const sendCmd = (cmd) => {
    if (DeviceControl && typeof DeviceControl.sendRemoteCommand === "function") {
      DeviceControl.sendRemoteCommand({ command: cmd });
      if (window.navigator?.vibrate) window.navigator.vibrate(40);
    } else {
      console.warn("DeviceControl.sendRemoteCommand not available");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="movies-page">
      <div className="upload-wrapper">

        {/* ── Tab bar ── */}
        <div className="upload-tabs">
          <button
            className={`upload-tab ${activeTab === TAB_UPLOAD ? "upload-tab--active" : ""}`}
            onClick={() => setActiveTab(TAB_UPLOAD)}
          >
            🎬 Add Content
          </button>
          <button
            className={`upload-tab ${activeTab === TAB_BANNER ? "upload-tab--active" : ""}`}
            onClick={() => setActiveTab(TAB_BANNER)}
          >
            🖼️ Banners
          </button>
          <button
            className={`upload-tab ${activeTab === TAB_REMOTE ? "upload-tab--active" : ""}`}
            onClick={() => setActiveTab(TAB_REMOTE)}
          >
            🎮 TV Remote
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            TAB 1 — UPLOAD
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === TAB_UPLOAD && (
          <div className="tv-upload">
            <h1 className="tv-title">🎬 Add Content</h1>
            <div className="tv-grid">
              {/* Title */}
              <input
                className="tv-input span-2"
                placeholder="Movie / Episode Title"
                value={movie.title}
                onChange={(e) => setMovie({ ...movie, title: e.target.value })}
              />

              {/* Year */}
              <input
                className="tv-input"
                type="number"
                placeholder="Year"
                value={movie.year}
                onChange={(e) => setMovie({ ...movie, year: e.target.value })}
              />

              {/* Type */}
              <select
                className="tv-input"
                value={movie.type}
                onChange={(e) => setMovie({ ...movie, type: e.target.value })}
              >
                <option value="movie">Movie</option>
                <option value="series">Series</option>
                <option value="anime">Anime</option>
              </select>

              {/* Language */}
              <select
                className="tv-input"
                value={movie.language}
                onChange={(e) => setMovie({ ...movie, language: e.target.value })}
              >
                <option value="">Select Language</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>

              {/* Genre */}
              <select
                className="tv-input"
                value={movie.genre}
                onChange={(e) => setMovie({ ...movie, genre: e.target.value })}
              >
                <option value="">Select Genre</option>
                {genres.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>

              {/* Series-only fields */}
              {movie.type !== "movie" && (
                <>
                  <input
                    className="tv-input span-3"
                    placeholder="Series Title (e.g. Breaking Bad)"
                    value={movie.seriesTitle}
                    onChange={(e) => setMovie({ ...movie, seriesTitle: e.target.value })}
                  />
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

              {/* Image URL */}
              <input
                className="tv-input span-3"
                placeholder="Image URL (Poster)"
                value={movie.img}
                onChange={(e) => setMovie({ ...movie, img: e.target.value })}
              />

              {/* Video Link */}
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
        )}

        {/* ══════════════════════════════════════════════════════════════
            TAB 2 — HERO BANNER MANAGER
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === TAB_BANNER && (
          <div className="tv-upload banner-manager">
            <h1 className="tv-title">🖼️ Hero Banner Slides</h1>
            <p className="banner-subtitle">
              Choose up to <strong>10</strong> movies to feature in the home screen slider.
            </p>

            {/* Slot count picker */}
            <div className="banner-count-row">
              <span className="banner-count-label">Number of Slides</span>
              <div className="banner-count-pills">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    className={`count-pill ${bannerCount === n ? "count-pill--active" : ""}`}
                    onClick={() => setBannerCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Slots */}
            <div className="banner-slots">
              {Array.from({ length: bannerCount }, (_, i) => {
                const slot    = slots[i];
                const preview = getMoviePreview(slot.movieId);
                return (
                  <div key={i} className={`banner-slot ${slot.active ? "" : "banner-slot--inactive"}`}>
                    {/* Slot number badge */}
                    <div className="slot-num">{i + 1}</div>

                    {/* Poster preview */}
                    <div className="slot-preview">
                      {preview?.img
                        ? <img src={preview.img} alt={preview.title} />
                        : <div className="slot-preview-empty">No Poster</div>
                      }
                    </div>

                    {/* Controls */}
                    <div className="slot-controls">
                      {/* Movie picker */}
                      <select
                        className="tv-input slot-select"
                        value={slot.movieId}
                        onChange={(e) => updateSlot(i, "movieId", e.target.value)}
                      >
                        <option value="">— Select a Movie —</option>
                        {allMovies
                          .sort((a, b) => a.title.localeCompare(b.title))
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.title} ({m.year}) [{m.language}]
                            </option>
                          ))}
                      </select>

                      {/* Custom description */}
<input
  className="tv-input"
  placeholder="Custom Banner Image URL"
  value={slot.bannerImage}
  onChange={(e) =>
    updateSlot(i, "bannerImage", e.target.value)
  }
/>
<select
  className="tv-input"
  value={slot.bannerType}
  onChange={(e) =>
    updateSlot(i, "bannerType", e.target.value)
  }
>
  <option value="movie">Movie Banner</option>
  <option value="series">Series Banner</option>
  <option value="anime">Anime Banner</option>
</select>

                      {/* Active toggle */}
                      <label className="slot-toggle">
                        <input
                          type="checkbox"
                          checked={slot.active}
                          onChange={(e) => updateSlot(i, "active", e.target.checked)}
                        />
                        <span className="slot-toggle-track" />
                        <span className="slot-toggle-label">
                          {slot.active ? "Visible" : "Hidden"}
                        </span>
                      </label>

                      {/* Movie meta preview */}
                      {preview && (
                        <div className="slot-meta">
                          <span className="slot-tag">{preview.language?.toUpperCase()}</span>
                          <span className="slot-tag">{preview.genre}</span>
                          <span className="slot-tag">{preview.year}</span>
                          <span className="slot-tag slot-tag--type">{preview.type?.toUpperCase()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              className="tv-button banner-save-btn"
              onClick={handleSaveBanners}
              disabled={bannerSaving}
            >
              {bannerSaving ? "SAVING…" : `💾 SAVE ${bannerCount} BANNER${bannerCount !== 1 ? "S" : ""}`}
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            TAB 3 — TV REMOTE CONTROL
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === TAB_REMOTE && (
          <div className="tv-upload remote-tab">
            <h1 className="tv-title">🎮 Android TV Remote</h1>
            <p className="banner-subtitle">Control your TV player directly from your mobile.</p>

            <div className="remote-container">
              {/* Top Row: Back & Settings */}
              <div className="remote-top-row">
                <button className="remote-btn circle-btn" onClick={() => sendCmd("back")}>
                  <ArrowLeft size={24} />
                  <span>BACK</span>
                </button>
                <button className="remote-btn circle-btn" onClick={() => sendCmd("settings")}>
                  <Settings size={24} />
                  <span>MENU</span>
                </button>
              </div>

              {/* D-PAD Section */}
              <div className="remote-dpad-section">
                <div className="remote-dpad">
                  <button className="dpad-btn dpad-up" onClick={() => sendCmd("up")}>
                    <ChevronUp size={32} />
                  </button>
                  <button className="dpad-btn dpad-down" onClick={() => sendCmd("down")}>
                    <ChevronDown size={32} />
                  </button>
                  <button className="dpad-btn dpad-left" onClick={() => sendCmd("left")}>
                    <ChevronLeft size={32} />
                  </button>
                  <button className="dpad-btn dpad-right" onClick={() => sendCmd("right")}>
                    <ChevronRight size={32} />
                  </button>
                  <button className="dpad-center" onClick={() => sendCmd("enter")}>
                    OK
                  </button>
                </div>
              </div>

              {/* Media Controls */}
              <div className="remote-media-row">
                <button className="remote-btn" onClick={() => sendCmd("prev")}>
                  <SkipBack size={20} />
                </button>
                <button className="remote-btn" onClick={() => sendCmd("rewind")}>
                  <RotateCcw size={22} />
                </button>
                <button className="remote-btn play-pause-btn" onClick={() => sendCmd("play")}>
                  <Play size={28} fill="currentColor" />
                </button>
                <button className="remote-btn play-pause-btn" onClick={() => sendCmd("pause")}>
                  <Pause size={28} fill="currentColor" />
                </button>
                <button className="remote-btn" onClick={() => sendCmd("forward")}>
                  <RotateCw size={22} />
                </button>
                <button className="remote-btn" onClick={() => sendCmd("next")}>
                  <SkipForward size={20} />
                </button>
              </div>

              {/* Extra Row: Volume / Fullscreen */}
              <div className="remote-extra-row">
                <button className="remote-btn pill-btn" onClick={() => sendCmd("vol_down")}>
                  <Volume1 size={20} />
                </button>
                <button className="remote-btn pill-btn" onClick={() => sendCmd("vol_up")}>
                  <Volume2 size={20} />
                </button>
                <button className="remote-btn pill-btn" onClick={() => sendCmd("fullscreen")}>
                  <Maximize size={20} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}