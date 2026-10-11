
import { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

export default function WebsiteManager() {
  const [websites, setWebsites] = useState([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");

  const emptyForm = {
    name: "",
    url: "",
    category: "",
    imageUrl: "",
    description: "",
  };

  const [form, setForm] = useState(emptyForm);

  // Load websites automatically from Firebase
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "websites"),
      (snapshot) => {
        const data = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        data.sort(
          (a, b) =>
            (b.createdAt?.seconds || 0) -
            (a.createdAt?.seconds || 0)
        );

        setWebsites(data);
      },
      (error) => {
        console.error("Website loading error:", error);
        setMessage("Unable to load websites. Check Firebase permissions.");
      }
    );

    return () => unsubscribe();
  }, []);

  const handleChange = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };

  // Add a new website or update an existing one
  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");

    const name = form.name.trim();
    let url = form.url.trim();

    if (!name || !url) {
      setMessage("Please enter the website name and URL.");
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    try {
      setSaving(true);

      const websiteData = {
        name,
        url,
        category: form.category.trim() || "General",
        imageUrl: form.imageUrl.trim(),
        description: form.description.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(
          doc(db, "websites", editingId),
          websiteData
        );
        setMessage("Website updated successfully!");
      } else {
        await addDoc(collection(db, "websites"), {
          ...websiteData,
          createdAt: serverTimestamp(),
        });
        setMessage("Website uploaded successfully!");
      }

      setForm(emptyForm);
      setEditingId(null);
    } catch (error) {
      console.error("Website save error:", error);
      setMessage("Upload failed. Check your Firebase settings.");
    } finally {
      setSaving(false);
    }
  };

  // Edit website
  const handleEdit = (website) => {
    setForm({
      name: website.name || "",
      url: website.url || "",
      category: website.category || "",
      imageUrl: website.imageUrl || "",
      description: website.description || "",
    });

    setEditingId(website.id);
    setMessage("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // Delete website
  const handleDelete = async (website) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${website.name}"?`
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "websites", website.id));

      if (editingId === website.id) {
        setEditingId(null);
        setForm(emptyForm);
      }

      setMessage("Website deleted successfully!");
    } catch (error) {
      console.error("Website delete error:", error);
      setMessage("Delete failed. Check Firebase permissions.");
    }
  };

  const filteredWebsites = websites.filter((website) =>
    `${website.name} ${website.category} ${website.description}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="wm-page">
      <style>{`
        .wm-page {
          color: var(--text-primary, #f4f4f5);
          padding: 24px;
          width: 100%;
          box-sizing: border-box;
        }

        .wm-page * {
          box-sizing: border-box;
        }

        .wm-heading {
          font-size: clamp(24px, 4vw, 34px);
          margin: 0 0 8px;
        }

        .wm-subtitle {
          color: #9ca3af;
          margin-bottom: 24px;
        }

        .wm-form {
          background: var(--card-bg, #171923);
          border: 1px solid #343746;
          border-radius: 18px;
          padding: 22px;
          margin-bottom: 32px;
        }

        .wm-form h2,
        .wm-list-heading {
          margin-top: 0;
        }

        .wm-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .wm-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }

        .wm-field label {
          font-size: 14px;
          font-weight: 600;
        }

        .wm-field input,
        .wm-field textarea,
        .wm-search {
          width: 100%;
          padding: 12px;
          color: inherit;
          background: var(--input-bg, #202331);
          border: 1px solid #414557;
          border-radius: 10px;
          font: inherit;
          outline: none;
        }

        .wm-field input:focus,
        .wm-field textarea:focus,
        .wm-search:focus {
          border-color: #818cf8;
        }

        .wm-full {
          grid-column: 1 / -1;
        }

        .wm-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          border-radius: 10px;
          padding: 12px 18px;
          margin-top: 18px;
          background: #635bff;
          color: white;
          font-weight: 700;
          cursor: pointer;
        }

        .wm-button:disabled {
          opacity: .6;
          cursor: wait;
        }

        .wm-cancel {
          margin-left: 8px;
          background: #414557;
        }

        .wm-message {
          margin: 14px 0 0;
          color: #86efac;
          overflow-wrap: anywhere;
        }

        .wm-list-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .wm-search {
          max-width: 320px;
        }

        .wm-count {
          color: #a5b4fc;
          font-size: 14px;
        }

        .wm-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .wm-card {
          min-width: 0;
          overflow: hidden;
          background: var(--card-bg, #171923);
          border: 1px solid #343746;
          border-radius: 16px;
          transition: transform .2s, border-color .2s;
        }

        .wm-card:hover {
          transform: translateY(-3px);
          border-color: #818cf8;
        }

        .wm-image {
          width: 100%;
          height: 170px;
          object-fit: cover;
          display: block;
          background: linear-gradient(135deg, #312e81, #111827);
        }

        .wm-placeholder {
          height: 170px;
          display: grid;
          place-items: center;
          font-size: 52px;
          background: linear-gradient(135deg, #312e81, #111827);
        }

        .wm-card-body {
          padding: 16px;
        }

        .wm-category {
          display: inline-block;
          padding: 5px 9px;
          margin-bottom: 10px;
          background: #312e81;
          color: #c7d2fe;
          border-radius: 20px;
          font-size: 12px;
        }

        .wm-card h3 {
          margin: 0 0 8px;
          overflow-wrap: anywhere;
        }

        .wm-description {
          color: #a1a1aa;
          font-size: 14px;
          line-height: 1.5;
          min-height: 42px;
          overflow-wrap: anywhere;
        }

        .wm-url {
          display: block;
          color: #a5b4fc;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          margin-bottom: 14px;
        }

        .wm-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .wm-actions a,
        .wm-actions button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 11px;
          border: 0;
          border-radius: 8px;
          background: #343746;
          color: white;
          text-decoration: none;
          cursor: pointer;
          font-size: 13px;
        }

        .wm-actions a {
          background: #635bff;
          flex: 1;
        }

        .wm-actions .wm-delete {
          background: #7f1d1d;
        }

        .wm-empty {
          text-align: center;
          color: #a1a1aa;
          padding: 36px 16px;
          border: 1px dashed #414557;
          border-radius: 16px;
        }

        @media (max-width: 950px) {
          .wm-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 600px) {
          .wm-page {
            padding: 12px;
          }

          .wm-form {
            padding: 15px;
          }

          .wm-grid,
          .wm-cards {
            grid-template-columns: minmax(0, 1fr);
          }

          .wm-full {
            grid-column: auto;
          }

          .wm-list-top {
            align-items: stretch;
            flex-direction: column;
          }

          .wm-search {
            max-width: none;
          }

          .wm-button {
            width: 100%;
          }

          .wm-cancel {
            margin-left: 0;
          }
        }
      `}</style>

      <h1 className="wm-heading">🌐 Website Manager</h1>

      <p className="wm-subtitle">
        Upload websites and manage your website collection.
      </p>

      <form className="wm-form" onSubmit={handleSubmit}>
        <h2>{editingId ? "✏️ Edit Website" : "➕ Upload Website"}</h2>

        <div className="wm-grid">
          <div className="wm-field">
            <label htmlFor="wm-name">Website Name *</label>
            <input
              id="wm-name"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="My Portfolio"
              required
              maxLength={100}
            />
          </div>

          <div className="wm-field">
            <label htmlFor="wm-url">Website URL *</label>
            <input
              id="wm-url"
              name="url"
              value={form.url}
              onChange={handleChange}
              placeholder="https://example.com"
              required
              inputMode="url"
            />
          </div>

          <div className="wm-field">
            <label htmlFor="wm-category">Category</label>
            <input
              id="wm-category"
              name="category"
              value={form.category}
              onChange={handleChange}
              placeholder="Education, Tools, Portfolio..."
              maxLength={60}
            />
          </div>

          <div className="wm-field">
            <label htmlFor="wm-image">Thumbnail Image URL</label>
            <input
              id="wm-image"
              name="imageUrl"
              type="url"
              value={form.imageUrl}
              onChange={handleChange}
              placeholder="https://example.com/image.jpg"
            />
          </div>

          <div className="wm-field wm-full">
            <label htmlFor="wm-description">Description</label>
            <textarea
              id="wm-description"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Describe your website..."
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        {message && (
          <p className="wm-message" role="status">
            {message}
          </p>
        )}

        <button className="wm-button" type="submit" disabled={saving}>
          {saving
            ? "Saving..."
            : editingId
              ? "💾 Save Changes"
              : "🚀 Upload Website"}
        </button>

        {editingId && (
          <button
            className="wm-button wm-cancel"
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
              setMessage("");
            }}
          >
            Cancel
          </button>
        )}
      </form>

      <div className="wm-list-top">
        <div>
          <h2 className="wm-list-heading">📚 Website List</h2>
          <span className="wm-count">
            {websites.length} website(s) uploaded
          </span>
        </div>

        <input
          className="wm-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="🔍 Search websites..."
          aria-label="Search websites"
        />
      </div>

      {filteredWebsites.length === 0 ? (
        <div className="wm-empty">
          <h3>
            {search ? "No matching websites" : "No websites uploaded yet"}
          </h3>
          <p>
            {search
              ? "Try a different search term."
              : "Upload your first website using the form above."}
          </p>
        </div>
      ) : (
        <div className="wm-cards">
          {filteredWebsites.map((website) => (
            <article className="wm-card" key={website.id}>
              {website.imageUrl ? (
                <img
                  className="wm-image"
                  src={website.imageUrl}
                  alt={`${website.name} thumbnail`}
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="wm-placeholder" aria-hidden="true">
                  🌐
                </div>
              )}

              <div className="wm-card-body">
                <span className="wm-category">
                  {website.category || "General"}
                </span>

                <h3>{website.name}</h3>

                <p className="wm-description">
                  {website.description || "No description available."}
                </p>

                <span className="wm-url" title={website.url}>
                  {website.url}
                </span>

                <div className="wm-actions">
                  <a
                    href={website.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Visit ↗
                  </a>

                  <button
                    type="button"
                    onClick={() => handleEdit(website)}
                    aria-label={`Edit ${website.name}`}
                  >
                    ✏️
                  </button>

                  <button
                    type="button"
                    className="wm-delete"
                    onClick={() => handleDelete(website)}
                    aria-label={`Delete ${website.name}`}
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
  );
}
