import { useState, useEffect } from "react";

import "./Movies.css";

import { db } from "../firebase";

import { collection, addDoc, onSnapshot, doc, setDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";

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
const TAB_WEBSITES = "websites";



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

  // Website manager state
  const emptyWebsite = {
    name: "",
    url: "",
    category: "",
    imageUrl: "",
    description: "",
  };
  const [websites, setWebsites] = useState([]);
  const [websiteForm, setWebsiteForm] = useState(emptyWebsite);
  const [websiteEditingId, setWebsiteEditingId] = useState(null);
  const [websiteSearch, setWebsiteSearch] = useState("");
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [websiteMessage, setWebsiteMessage] = useState("");



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

    const unsub3 = onSnapshot(
      collection(db, "websites"),
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setWebsites(data);
      },
      (err) => {
        console.error("WEBSITE LOAD ERROR:", err);
        setWebsiteMessage("Could not load websites. Check Firestore permissions.");
      }
    );

    return () => { unsub1(); unsub2(); unsub3(); };

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



  // ── Website manager handlers ───────────────────────────────────────────────
  const handleWebsiteChange = (e) => {
    setWebsiteForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const resetWebsiteForm = () => {
    setWebsiteForm(emptyWebsite);
    setWebsiteEditingId(null);
    setWebsiteMessage("");
  };

  const handleWebsiteSubmit = async (e) => {
    e.preventDefault();
    setWebsiteMessage("");

    const name = websiteForm.name.trim();
    let url = websiteForm.url.trim();

    if (!name || !url) {
      setWebsiteMessage("Please enter a website name and URL.");
      return;
    }

    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    try {
      setWebsiteSaving(true);
      const data = {
        name,
        url,
        category: websiteForm.category.trim() || "General",
        imageUrl: websiteForm.imageUrl.trim(),
        description: websiteForm.description.trim(),
        updatedAt: serverTimestamp(),
      };

      if (websiteEditingId) {
        await updateDoc(doc(db, "websites", websiteEditingId), data);
        setWebsiteMessage("Website updated successfully!");
      } else {
        await addDoc(collection(db, "websites"), {
          ...data,
          createdAt: serverTimestamp(),
        });
        setWebsiteMessage("Website uploaded successfully!");
      }

      setWebsiteForm(emptyWebsite);
      setWebsiteEditingId(null);
    } catch (err) {
      console.error("WEBSITE SAVE ERROR:", err);
      setWebsiteMessage("Website save failed. Check Firestore permissions.");
    } finally {
      setWebsiteSaving(false);
    }
  };

  const editWebsite = (website) => {
    setWebsiteForm({
      name: website.name || "",
      url: website.url || "",
      category: website.category || "",
      imageUrl: website.imageUrl || "",
      description: website.description || "",
    });
    setWebsiteEditingId(website.id);
    setWebsiteMessage("");
  };

  const deleteWebsite = async (website) => {
    if (!window.confirm(`Delete "${website.name}"?`)) return;

    try {
      await deleteDoc(doc(db, "websites", website.id));
      if (websiteEditingId === website.id) resetWebsiteForm();
      setWebsiteMessage("Website deleted successfully!");
    } catch (err) {
      console.error("WEBSITE DELETE ERROR:", err);
      setWebsiteMessage("Delete failed. Check Firestore permissions.");
    }
  };

  const filteredWebsites = websites.filter((website) =>
    `${website.name || ""} ${website.category || ""} ${website.description || ""}`
      .toLowerCase()
      .includes(websiteSearch.toLowerCase().trim())
  );

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
            className={`upload-tab ${activeTab === TAB_WEBSITES ? "upload-tab--active" : ""}`}
            onClick={() => setActiveTab(TAB_WEBSITES)}
          >
            🌐 Websites
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

        {activeTab === TAB_WEBSITES && (
          <div className="tv-upload website-manager">
            <style>{`
              .website-manager { width: 100%; min-width: 0; }
              .website-form { padding: 20px; border: 1px solid #343746; border-radius: 16px; margin: 20px 0 30px; background: rgba(255,255,255,.025); }
              .website-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
              .website-form-grid > * { min-width: 0; width: 100%; }
              .website-description { grid-column: 1 / -1; resize: vertical; }
              .website-message { color: #86efac; overflow-wrap: anywhere; }
              .website-cancel { margin-left: 10px; background: #414557; }
              .website-list-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin: 24px 0 16px; }
              .website-list-heading h2 { margin-bottom: 5px; }
              .website-search { max-width: 320px; }
              .website-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
              .website-card { min-width: 0; overflow: hidden; border: 1px solid #343746; border-radius: 15px; background: rgba(255,255,255,.035); }
              .website-card-image, .website-card-placeholder { width: 100%; height: 160px; object-fit: cover; background: linear-gradient(135deg,#312e81,#111827); }
              .website-card-placeholder { display: grid; place-items: center; font-size: 48px; }
              .website-card-body { padding: 15px; min-width: 0; }
              .website-category { display: inline-block; padding: 5px 9px; border-radius: 20px; background: #312e81; color: #c7d2fe; font-size: 12px; }
              .website-card h3 { overflow-wrap: anywhere; margin: 10px 0 7px; }
              .website-card p { min-height: 40px; color: #a1a1aa; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
              .website-url { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #a5b4fc; font-size: 12px; margin-bottom: 12px; }
              .website-card-actions { display: flex; gap: 8px; }
              .website-card-actions a, .website-card-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 8px; padding: 9px 10px; background: #343746; color: white; text-decoration: none; cursor: pointer; }
              .website-card-actions a { flex: 1; background: #635bff; font-size: 13px; }
              .website-card-actions .website-delete { background: #7f1d1d; }
              .website-empty { padding: 32px 16px; border: 1px dashed #414557; border-radius: 14px; text-align: center; color: #a1a1aa; }
              @media (max-width: 950px) { .website-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
              @media (max-width: 600px) {
                .website-form { padding: 14px; }
                .website-form-grid, .website-grid { grid-template-columns: minmax(0, 1fr); }
                .website-description { grid-column: auto; }
                .website-list-heading { align-items: stretch; flex-direction: column; }
                .website-search { max-width: none; }
                .website-cancel { margin-left: 0; }
                .website-card-image, .website-card-placeholder { height: 185px; }
              }
            `}</style>
            <h1 className="tv-title">🌐 Website Manager</h1>
            <p className="banner-subtitle">
              Upload website details and manage all links from this page.
            </p>

            <form className="website-form" onSubmit={handleWebsiteSubmit}>
              <div className="website-form-grid">
                <input
                  className="tv-input"
                  name="name"
                  placeholder="Website Name *"
                  value={websiteForm.name}
                  onChange={handleWebsiteChange}
                  required
                  maxLength={100}
                />
                <input
                  className="tv-input"
                  name="url"
                  placeholder="Website URL * (https://example.com)"
                  value={websiteForm.url}
                  onChange={handleWebsiteChange}
                  required
                />
                <input
                  className="tv-input"
                  name="category"
                  placeholder="Category (e.g. Education)"
                  value={websiteForm.category}
                  onChange={handleWebsiteChange}
                />
                <input
                  className="tv-input"
                  name="imageUrl"
                  type="url"
                  placeholder="Thumbnail Image URL (optional)"
                  value={websiteForm.imageUrl}
                  onChange={handleWebsiteChange}
                />
                <textarea
                  className="tv-input website-description"
                  name="description"
                  placeholder="Website description (optional)"
                  value={websiteForm.description}
                  onChange={handleWebsiteChange}
                  rows={3}
                  maxLength={500}
                />
              </div>

              {websiteMessage && (
                <p className="website-message" role="status">{websiteMessage}</p>
              )}

              <button className="tv-button" type="submit" disabled={websiteSaving}>
                {websiteSaving
                  ? "SAVING..."
                  : websiteEditingId
                    ? "💾 SAVE WEBSITE CHANGES"
                    : "🌐 UPLOAD WEBSITE"}
              </button>

              {websiteEditingId && (
                <button
                  className="tv-button website-cancel"
                  type="button"
                  onClick={resetWebsiteForm}
                >
                  CANCEL EDIT
                </button>
              )}
            </form>

            <div className="website-list-heading">
              <div>
                <h2>📚 Uploaded Websites</h2>
                <p className="banner-subtitle">{websites.length} website(s)</p>
              </div>
              <input
                className="tv-input website-search"
                value={websiteSearch}
                onChange={(e) => setWebsiteSearch(e.target.value)}
                placeholder="🔍 Search websites..."
                aria-label="Search websites"
              />
            </div>

            {filteredWebsites.length === 0 ? (
              <div className="website-empty">
                {websiteSearch ? "No websites match your search." : "No websites uploaded yet."}
              </div>
            ) : (
              <div className="website-grid">
                {filteredWebsites.map((website) => (
                  <article className="website-card" key={website.id}>
                    {website.imageUrl ? (
                      <img
                        className="website-card-image"
                        src={website.imageUrl}
                        alt={`${website.name} thumbnail`}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <div className="website-card-placeholder">🌐</div>
                    )}

                    <div className="website-card-body">
                      <span className="website-category">{website.category || "General"}</span>
                      <h3>{website.name}</h3>
                      <p>{website.description || "No description provided."}</p>
                      <div className="website-url" title={website.url}>{website.url}</div>
                      <div className="website-card-actions">
                        <a href={website.url} target="_blank" rel="noopener noreferrer">
                          Visit Website ↗
                        </a>
                        <button type="button" onClick={() => editWebsite(website)} title="Edit">
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="website-delete"
                          onClick={() => deleteWebsite(website)}
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

    </div>

  );

}