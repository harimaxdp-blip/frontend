import React, { useEffect, useRef, useState, useCallback } from "react";
import "./FilterPopup.css";

export const LANGUAGES_CONFIG = {
  all:        { icon: "ti-world",      scriptChar: null  },
  tamil:      { icon: null,          scriptChar: "த"   },
  telugu:     { icon: null,          scriptChar: "తె"  },
  malayalam:  { icon: null,          scriptChar: "മ"   },
  hindi:      { icon: null,          scriptChar: "हि"  },
  kannada:    { icon: null,          scriptChar: "ಕ"   },
  punjabi:    { icon: null,          scriptChar: "ਪੰ"  },
  marathi:    { icon: null,          scriptChar: "മ"   },
  bengali:    { icon: null,          scriptChar: "বা"  },
  urdu:       { icon: null,          scriptChar: "ا"   },
  english:    { icon: "ti-abc",      scriptChar: null  },
  japanese:   { icon: null,          scriptChar: "日"   },
  korean:     { icon: null,          scriptChar: "한"   },
  chinese:    { icon: null,          scriptChar: "中"   },
  french:     { icon: null,          scriptChar: "Fr"  },
  spanish:    { icon: null,          scriptChar: "Es"  },
  german:     { icon: null,          scriptChar: "De"  },
  italian:    { icon: null,          scriptChar: "It"  },
  thai:       { icon: null,          scriptChar: "ไท"  },
  arabic:     { icon: null,          scriptChar: "ع"   },
  russian:    { icon: null,          scriptChar: "Ру"  },
  portuguese: { icon: null,          scriptChar: "Pt"  },
  turkish:    { icon: null,          scriptChar: "Tr"  },
};

export const GENRES = [
  { value: "all",          label: "All genres",    icon: "ti-list"        },
  { value: "action",       label: "Action",         icon: "ti-sword"       },
  { value: "comedy",       label: "Comedy",         icon: "ti-mood-happy"  },
  { value: "romance",      label: "Romance",        icon: "ti-heart"       },
  { value: "horror",       label: "Horror",         icon: "ti-ghost"       },
  { value: "sci-fi",       label: "Sci-Fi",         icon: "ti-rocket"      },
  { value: "thriller",     label: "Thriller",       icon: "ti-eye"         },
  { value: "drama",        label: "Drama",          icon: "ti-theater"     },
  { value: "fantasy",      label: "Fantasy",        icon: "ti-wand"        },
  { value: "adventure",    label: "Adventure",      icon: "ti-map"         },
  { value: "animation",    label: "Animation",      icon: "ti-confetti"    },
  { value: "martial arts", label: "Martial Arts",   icon: "ti-flame"       },
  { value: "crime",        label: "Crime",          icon: "ti-shield-lock" },
  { value: "documentary",  label: "Documentary",    icon: "ti-camera"      },
  { value: "family",       label: "Family",         icon: "ti-users"       },
  { value: "zombie",       label: "Zombie",         icon: "ti-biohazard"   },
  { value: "mystery",      label: "Mystery",        icon: "ti-search"      },
  { value: "musical",      label: "Musical",        icon: "ti-music"       },
  
];

function yearDecadeLabel(year) {
  const now = new Date().getFullYear();
  if (year >= now)      return "Latest";
  if (year >= now - 1)  return "New";
  if (year >= now - 3)  return "Recent";
  if (year >= 2020)     return "2020s";
  if (year >= 2010)     return "2010s";
  if (year >= 2000)     return "2000s";
  if (year >= 1990)     return "90s";
  return "Classic";
}

function countActive(values) {
  let count = 0;
  if (Array.isArray(values.lang) && values.lang.length > 0) count += values.lang.length;
  if (Array.isArray(values.genre) && values.genre.length > 0) count += values.genre.length;
  if (Array.isArray(values.year) && values.year.length > 0) count += values.year.length;
  return count;
}

export function FilterPopup({
  open,
  onClose,
  initialTab = "language",
  lang = [],
  onLangChange,
  availableLanguages = [],
  genre = [],
  onGenreChange,
  year = [],
  onYearChange,
  availableYears = [],
  onApply,
  onReset,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "GoBack" || e.keyCode === 10009) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ popup: true }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, onClose]);

  const handleLang = useCallback((val) => {
    if (val === "all") {
      onLangChange([]);
    } else {
      const next = lang.includes(val) ? lang.filter((l) => l !== val) : [...lang, val];
      onLangChange(next);
    }
  }, [lang, onLangChange]);

  const handleGenre = useCallback((val) => {
    if (val === "all") {
      onGenreChange([]);
    } else {
      const next = genre.includes(val) ? genre.filter((g) => g !== val) : [...genre, val];
      onGenreChange(next);
    }
  }, [genre, onGenreChange]);

  const handleYear = useCallback((val) => {
    if (val === "all") {
      onYearChange([]);
    } else {
      const next = year.includes(val) ? year.filter((y) => y !== val) : [...year, val];
      onYearChange(next);
    }
  }, [year, onYearChange]);

  const handleApply = () => {
    onApply?.({ lang, genre, year });
    onClose();
  };

  const handleReset = () => {
    onReset?.();
  };

  if (!open) return null;

  const langs = [
    { value: "all", label: "All languages", cfg: LANGUAGES_CONFIG.all },
    ...(availableLanguages || []).map((l) => ({
      value: l,
      label: l.charAt(0).toUpperCase() + l.slice(1),
      cfg: LANGUAGES_CONFIG[l.toLowerCase()] || { icon: "ti-language", scriptChar: null },
    })),
  ];

  const years = [
    { value: "all", num: "All", sub: "Years" },
    ...(availableYears || []).map((y) => ({
      value: String(y),
      num: String(y),
      sub: yearDecadeLabel(y),
    })),
  ];

  const activeCount = countActive({ lang, genre, year });

  const tabs = [
    { id: "language", label: "Language", active: lang.length > 0 },
    { id: "genre",    label: "Genre",    active: genre.length > 0 },
    { id: "year",     label: "Year",     active: year.length > 0 },
  ];

  return (
    <div
      ref={overlayRef}
      className="fp-overlay"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
    >
      <div className="fp-sheet">
        <div className="fp-sheet-header">
          <h2 className="fp-sheet-title">
            Filters
            {activeCount > 0 && (
              <span className="fp-title-dot" aria-label={`${activeCount} active`} />
            )}
          </h2>
          <button className="fp-sheet-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="fp-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`fp-tab${activeTab === t.id ? " fp-tab--active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {t.active && <span className="fp-tab-badge" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {/* 1. LANGUAGE PANEL */}
        <div
          className={`fp-panel${activeTab === "language" ? " fp-panel--active" : ""}`}
          role="tabpanel"
          aria-label="Language"
        >
          <div className="fp-panel-scroll">
            <p className="fp-section-label">Select multiple · tap again to clear</p>
            <div className="fp-grid-lang">
              {langs.map((l) => {
                const active = l.value === "all" ? lang.length === 0 : lang.includes(l.value);
                const { icon, scriptChar } = l.cfg;
                return (
                  <button
                    key={l.value}
                    className={`fp-pill${active ? " fp-pill--active" : ""}`}
                    onClick={() => handleLang(l.value)}
                    aria-pressed={active}
                  >
                    {scriptChar
                      ? <span className="fp-script-char" aria-hidden="true">{scriptChar}</span>
                      : <i className={`ti ${icon} fp-pill-icon`} aria-hidden="true" />
                    }
                    <span className="fp-pill-label">{l.label}</span>
                    {active && <i className="ti ti-check fp-check" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. GENRE PANEL */}
        <div
          className={`fp-panel${activeTab === "genre" ? " fp-panel--active" : ""}`}
          role="tabpanel"
          aria-label="Genre"
        >
          <div className="fp-panel-scroll">
            <p className="fp-section-label">Select multiple · tap again to clear</p>
            <div className="fp-grid-genre">
              {GENRES.map((g) => {
                const active = g.value === "all" ? genre.length === 0 : genre.includes(g.value);
                return (
                  <button
                    key={g.value}
                    className={`fp-pill${active ? " fp-pill--active" : ""}`}
                    onClick={() => handleGenre(g.value)}
                    aria-pressed={active}
                  >
                    <i className={`ti ${g.icon} fp-pill-icon`} aria-hidden="true" />
                    <span className="fp-pill-label">{g.label}</span>
                    {active && <i className="ti ti-check fp-check" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. YEAR PANEL */}
        <div
          className={`fp-panel${activeTab === "year" ? " fp-panel--active" : ""}`}
          role="tabpanel"
          aria-label="Year"
        >
          <div className="fp-panel-scroll">
            <p className="fp-section-label">Select multiple · tap again to clear</p>
            <div className="fp-grid-year">
              {years.map((y) => {
                const active = y.value === "all" ? year.length === 0 : year.includes(y.value);
                return (
                  <button
                    key={y.value}
                    className={`fp-pill fp-pill-year${active ? " fp-pill--active" : ""}`}
                    onClick={() => handleYear(y.value)}
                    aria-pressed={active}
                  >
                    {active && <i className="ti ti-check fp-check" aria-hidden="true" />}
                    <span className="fp-year-num">{y.num}</span>
                    <span className="fp-year-label">{y.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="fp-divider" />
        <div className="fp-footer">
          <button className="fp-btn-reset" onClick={handleReset}>
            Reset all
          </button>
          <button className="fp-btn-apply" onClick={handleApply}>
            {activeCount > 0 ? `Apply ${activeCount} filter${activeCount > 1 ? "s" : ""}` : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FilterTrigger({ icon, label, activeValue = [], onClick }) {
  const isActive = Array.isArray(activeValue) && activeValue.length > 0;
  const hintText = isActive 
    ? activeValue.length === 1 
      ? activeValue[0] 
      : `${activeValue.length} items` 
    : "All";

  return (
    <button
      className={`fp-trigger${isActive ? " fp-trigger--active" : ""}`}
      onClick={onClick}
      aria-label={`${label}: ${hintText}`}
    >
      <i className={`ti ${icon} fp-trigger-icon`} aria-hidden="true" />
      <div className="fp-trigger-label-wrap">
        <span>{label}</span>
        {isActive && <span className="fp-trigger-hint">{hintText}</span>}
      </div>
      {isActive && <div className="fp-trigger-dot" aria-hidden="true" />}
    </button>
  );
}

export function LanguagePopup({ open, onClose, value = [], onChange, availableLanguages }) {
  return (
    <FilterPopup
      open={open}
      onClose={onClose}
      initialTab="language"
      lang={value}
      onLangChange={(v) => onChange(v)}
      availableLanguages={availableLanguages || []}
      genre={[]}
      onGenreChange={() => {}}
      year={[]}
      onYearChange={() => {}}
      availableYears={[]}
      onApply={({ lang }) => onChange(lang)}
      onReset={() => onChange([])}
    />
  );
}

export function GenrePopup({ open, onClose, value = [], onChange }) {
  return (
    <FilterPopup
      open={open}
      onClose={onClose}
      initialTab="genre"
      lang={[]}
      onLangChange={() => {}}
      availableLanguages={[]}
      genre={value}
      onGenreChange={(v) => onChange(v)}
      year={[]}
      onYearChange={() => {}}
      availableYears={[]}
      onApply={({ genre }) => onChange(genre)}
      onReset={() => onChange([])}
    />
  );
}

export function YearPopup({ open, onClose, value = [], onChange, availableYears }) {
  return (
    <FilterPopup
      open={open}
      onClose={onClose}
      initialTab="year"
      lang={[]}
      onLangChange={() => {}}
      availableLanguages={[]}
      genre={[]}
      onGenreChange={() => {}}
      year={value}
      onYearChange={(v) => onChange(v)}
      availableYears={availableYears || []}
      onApply={({ year }) => onChange(year)}
      onReset={() => onChange([])}
    />
  );
}