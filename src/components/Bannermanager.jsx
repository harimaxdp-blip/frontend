import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import "./BannerManager.css";

const EMPTY_FORM = {
  title: "",
  description: "",
  imageUrl: "",
  logo: "",
  year: "",
  language: "",
  genre: "",
  movieRef: null,
  order: 0,
  active: true,
};

function ImagePreview({ url, label }) {
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setOk(false);
    setErr(false);
    if (!url) return;
  }, [url]);

  if (!url) return null;

  return (
    <div className="bm-preview-wrap">
      <span className="bm-preview-label">{label} Preview</span>
      {!err ? (
        <img
          src={url}
          alt="preview"
          className={`bm-preview-img ${ok ? "bm-preview-img--loaded" : ""}`}
          onLoad={() => setOk(true)}
          onError={() => setErr(true)}
        />
      ) : (
        <div className="bm-preview-error">⚠ Cannot load image</div>
      )}
    </div>
  );
}

export default function BannerManager() {
  const [banners, setBanners]   = useState([]);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [editId, setEditId]     = useState(null);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [success, setSuccess]   = useState("");
  const [error, setError]       = useState("");

  // ── Firestore live listener ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "banners"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      setBanners(data);
    });
    return () => unsub();
  }, []);

  const flash = (type, msg) => {
    if (type === "success") { setSuccess(msg); setError(""); }
    else { setError(msg); setSuccess(""); }
    setTimeout(() => { setSuccess(""); setError(""); }, 3500);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return flash("error", "Title is required.");
    if (!form.imageUrl.trim()) return flash("error", "Banner Image URL is required.");

    setSaving(true);
    try {
      const payload = {
        title:       form.title.trim(),
        description: form.description.trim(),
        imageUrl:    form.imageUrl.trim(),
        logo:        form.logo.trim(),
        year:        form.year.trim(),
        language:    form.language.trim(),
        genre:       form.genre.trim(),
        order:       parseInt(form.order) || 0,
        active:      form.active,
        updatedAt:   serverTimestamp(),
      };

      if (editId) {
        await updateDoc(doc(db, "banners", editId), payload);
        flash("success", "✅ Banner updated!");
      } else {
        await addDoc(collection(db, "banners"), { ...payload, createdAt: serverTimestamp() });
        flash("success", "✅ Banner added!");
      }

      setForm(EMPTY_FORM);
      setEditId(null);
    } catch (err) {
      flash("error", `Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (banner) => {
    setForm({
      title:       banner.title       || "",
      description: banner.description || "",
      imageUrl:    banner.imageUrl    || "",
      logo:        banner.logo        || "",
      year:        banner.year        || "",
      language:    banner.language    || "",
      genre:       banner.genre       || "",
      order:       banner.order       ?? 0,
      active:      banner.active      !== false,
    });
    setEditId(banner.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this banner?")) return;
    setDeleting(id);
    try {
      await deleteDoc(doc(db, "banners", id));
      flash("success", "🗑️ Banner deleted.");
    } catch (err) {
      flash("error", `Delete failed: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (banner) => {
    try {
      await updateDoc(doc(db, "banners", banner.id), { active: !banner.active });
    } catch (err) {
      flash("error", `Toggle failed: ${err.message}`);
    }
  };

  const handleCancel = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
  };

  return (
    <div className="bm-page">
      <div className="bm-header">
        <h1 className="bm-heading">
          <span className="bm-heading-icon">🎬</span>
          Banner Manager
        </h1>
        <p className="bm-subheading">
          Add or edit hero slider banners shown at the top of your OTT homepage.
          Paste image URLs directly — no file upload needed.
        </p>
      </div>

      {/* ── Flash messages ── */}
      {success && <div className="bm-alert bm-alert--success">{success}</div>}
      {error   && <div className="bm-alert bm-alert--error">{error}</div>}

      {/* ── Form ── */}
      <form className="bm-form" onSubmit={handleSubmit} autoComplete="off">
        <div className="bm-form-title">
          {editId ? "✏️ Edit Banner" : "➕ Add New Banner"}
        </div>

        <div className="bm-row bm-row--2">
          <div className="bm-field">
            <label className="bm-label">Title *</label>
            <input
              className="bm-input"
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="e.g. Avengers: Endgame"
            />
          </div>
          <div className="bm-field">
            <label className="bm-label">Description</label>
            <input
              className="bm-input"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Short tagline or synopsis"
            />
          </div>
        </div>

        <div className="bm-field">
          <label className="bm-label">Banner Image URL *</label>
          <input
            className="bm-input"
            name="imageUrl"
            value={form.imageUrl}
            onChange={handleChange}
            placeholder="https://example.com/banner.jpg  (wide landscape image recommended)"
          />
          <ImagePreview url={form.imageUrl} label="Banner" />
        </div>

        <div className="bm-field">
          <label className="bm-label">Logo Image URL <span className="bm-optional">(optional — replaces title text)</span></label>
          <input
            className="bm-input"
            name="logo"
            value={form.logo}
            onChange={handleChange}
            placeholder="https://example.com/logo.png  (transparent PNG works best)"
          />
          <ImagePreview url={form.logo} label="Logo" />
        </div>

        <div className="bm-row bm-row--4">
          <div className="bm-field">
            <label className="bm-label">Year</label>
            <input
              className="bm-input"
              name="year"
              value={form.year}
              onChange={handleChange}
              placeholder="2024"
            />
          </div>
          <div className="bm-field">
            <label className="bm-label">Language</label>
            <input
              className="bm-input"
              name="language"
              value={form.language}
              onChange={handleChange}
              placeholder="Tamil"
            />
          </div>
          <div className="bm-field">
            <label className="bm-label">Genre</label>
            <input
              className="bm-input"
              name="genre"
              value={form.genre}
              onChange={handleChange}
              placeholder="Action"
            />
          </div>
          <div className="bm-field">
            <label className="bm-label">Order <span className="bm-optional">(lower = first)</span></label>
            <input
              className="bm-input"
              name="order"
              type="number"
              value={form.order}
              onChange={handleChange}
              placeholder="0"
            />
          </div>
        </div>

        <div className="bm-field bm-field--row">
          <label className="bm-toggle">
            <input
              type="checkbox"
              name="active"
              checked={form.active}
              onChange={handleChange}
            />
            <span className="bm-toggle-slider" />
            <span className="bm-toggle-label">Active (visible on homepage)</span>
          </label>
        </div>

        <div className="bm-actions">
          <button className="bm-btn bm-btn--primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : editId ? "Update Banner" : "Add Banner"}
          </button>
          {editId && (
            <button className="bm-btn bm-btn--ghost" type="button" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* ── Banner List ── */}
      <div className="bm-list-header">
        <h2 className="bm-list-title">Current Banners ({banners.length})</h2>
      </div>

      {banners.length === 0 ? (
        <div className="bm-empty">No banners yet. Add one above!</div>
      ) : (
        <div className="bm-list">
          {banners.map((banner) => (
            <div key={banner.id} className={`bm-item ${!banner.active ? "bm-item--inactive" : ""}`}>
              <div className="bm-item-img">
                {banner.imageUrl ? (
                  <img src={banner.imageUrl} alt={banner.title} />
                ) : (
                  <div className="bm-item-img-placeholder">No image</div>
                )}
                <span className="bm-item-order">#{banner.order ?? 0}</span>
              </div>
              <div className="bm-item-info">
                <div className="bm-item-title">{banner.title}</div>
                {banner.description && (
                  <div className="bm-item-desc">{banner.description}</div>
                )}
                <div className="bm-item-meta">
                  {banner.year     && <span className="bm-meta-tag">{banner.year}</span>}
                  {banner.language && <span className="bm-meta-tag">{banner.language}</span>}
                  {banner.genre    && <span className="bm-meta-tag">{banner.genre}</span>}
                </div>
                {banner.imageUrl && (
                  <div className="bm-item-url" title={banner.imageUrl}>
                    🖼 {banner.imageUrl}
                  </div>
                )}
              </div>
              <div className="bm-item-controls">
                <button
                  className={`bm-toggle-btn ${banner.active ? "bm-toggle-btn--on" : "bm-toggle-btn--off"}`}
                  onClick={() => handleToggleActive(banner)}
                  title={banner.active ? "Click to hide" : "Click to show"}
                >
                  {banner.active ? "● Live" : "○ Hidden"}
                </button>
                <button
                  className="bm-btn bm-btn--edit"
                  onClick={() => handleEdit(banner)}
                >
                  ✏️ Edit
                </button>
                <button
                  className="bm-btn bm-btn--delete"
                  onClick={() => handleDelete(banner.id)}
                  disabled={deleting === banner.id}
                >
                  {deleting === banner.id ? "…" : "🗑️ Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}