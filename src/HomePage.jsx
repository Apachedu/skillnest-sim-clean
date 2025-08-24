// src/HomePage.jsx
import React from "react";
import { Link } from "react-router-dom";
import { db, storage } from "./firebase/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { ref as storageRef, getDownloadURL } from "firebase/storage";

/* ---------------- helpers ---------------- */
function readEntitlements() {
  try {
    const r = JSON.parse(localStorage.getItem("sn_entitlements") || "{}");
    const premium = !!r.PREMIUM;
    const basic = !!r.BASIC || premium; // premium includes basic
    return { BASIC: basic, PREMIUM: premium };
  } catch {
    return { BASIC: false, PREMIUM: false };
  }
}
function readWhitelist() {
  try { return JSON.parse(localStorage.getItem("sn_whitelist") || "[]"); }
  catch { return []; }
}
function isUnlockedForCase(tier, entitlements, whitelist, caseId) {
  const t = String(tier ?? "locked").toLowerCase();
  if (t === "free") return true;
  if (Array.isArray(whitelist) && whitelist.includes(caseId)) return true; // per-case unlocks
  if (t === "basic") return !!(entitlements.BASIC || entitlements.PREMIUM);
  if (t === "premium") return !!entitlements.PREMIUM;
  return false;
}
function normalizeSubject(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Other";
  if (/^bm$/i.test(s)) return "Business Management";
  if (/^business\s*management$/i.test(s)) return "Business Management";
  if (/^economics$/i.test(s)) return "Economics";
  return s.replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Final thumbnail fallback (must exist in /public)
const FALLBACK_PUBLIC_URL = "/placeholder-thumb.jpg"; // or "/econ-generic-hero-001.jpg"

/** Resolve a Storage filename to a URL; return fallback if it fails. */
async function resolveImageFromStorage(filename) {
  const val = (filename || "").trim();
  if (!val) return FALLBACK_PUBLIC_URL;
  if (/^https?:\/\//i.test(val)) return val;

  const candidates = Array.from(new Set([
    val,
    val.toLowerCase(),
    val.startsWith("images/") ? val : `images/${val}`,
    `images/${val.toLowerCase()}`,
    val.startsWith("thumbnails/") ? val : `thumbnails/${val}`,
    `thumbnails/${val.toLowerCase()}`,
  ]));

  for (const p of candidates) {
    try {
      const url = await getDownloadURL(storageRef(storage, p));
      return url; // first one that works
    } catch { /* try next */ }
  }
  return FALLBACK_PUBLIC_URL;
}

/* ---------------- component ---------------- */
export default function HomePage() {
  const [items, setItems] = React.useState([]); // {id,title,topic,subject,accessTier,imageUrl,_imgRaw}
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [imgWarn, setImgWarn] = React.useState(false);
  const [subjectFilter, setSubjectFilter] = React.useState("All");

  const entitlements = React.useMemo(readEntitlements, []);
  const whitelist    = React.useMemo(readWhitelist, []);

  // Fetch docs fast, then resolve missing thumbnails in the background
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(""); setImgWarn(false);
      try {
        const colRef = collection(db, "caseStudies");
        const qRef  = query(colRef, where("published", "==", true));
        const snap  = await getDocs(qRef);

        const quickRows = snap.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          return {
            id: docSnap.id,
            title: data.title || docSnap.id,
            topic: data.topic || "",
            subject: normalizeSubject(data.subject),
            accessTier: data.accessTier ?? "locked",
            imageUrl: (data.imageUrl || "").trim(),  // prefer precomputed URL
            _imgRaw:  (data.image    || "").trim(),  // filename fallback
          };
        });

        // Prefill: if no imageUrl and no _imgRaw → use fallback immediately
        const initial = quickRows.map((it) => ({
          ...it,
          imageUrl: it.imageUrl || (it._imgRaw ? "" : FALLBACK_PUBLIC_URL),
        }));

        if (!cancelled) {
          setItems(initial);
          setLoading(false); // show list immediately
        }

        // Resolve any missing images from Storage filenames
        const need = initial
          .map((it, i) => ({ i, it }))
          .filter(({ it }) => !it.imageUrl && it._imgRaw);

        if (need.length) {
          const urls = await Promise.all(
            need.map(({ it }) => resolveImageFromStorage(it._imgRaw))
          );
          if (!cancelled) {
            setItems((prev) => {
              const next = prev.slice();
              need.forEach(({ i }, idx) => {
                next[i] = { ...next[i], imageUrl: urls[idx] || FALLBACK_PUBLIC_URL };
              });
              return next;
            });
            if (urls.some((u) => u === FALLBACK_PUBLIC_URL)) setImgWarn(true);
          }
        }
      } catch (e) {
        console.error("[Home] load error", e);
        if (!cancelled) { setError(e.message || "Failed to load cases"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subject tabs + counts
  const subjects = React.useMemo(() => {
    const counts = new Map();
    items.forEach((it) => counts.set(it.subject, (counts.get(it.subject) || 0) + 1));
    const ordered = Array.from(counts.keys()).sort((a, b) => {
      const order = (s) => (s === "Economics" ? 0 : s === "Business Management" ? 1 : 2);
      const oa = order(a), ob = order(b);
      return oa === ob ? a.localeCompare(b) : oa - ob;
    });
    return { order: ["All", ...ordered], counts };
  }, [items]);

  const visible = React.useMemo(
    () => (subjectFilter === "All" ? items : items.filter((it) => it.subject === subjectFilter)),
    [items, subjectFilter]
  );

  /* --------------- UI --------------- */
  if (loading) return <div className="container">Loading…</div>;
  if (error)   return <div className="container" style={{color:"#b00020"}}>Error: {error}</div>;

  return (
    <div className="container">
      <h1 className="brand-heading" style={{ marginBottom: 8 }}>Case Studies</h1>
      <p className="meta" style={{ marginTop: 0, marginBottom: 12 }}>
        Showing {visible.length} of {items.length}
      </p>

      {imgWarn && (
        <div className="card" style={{ background:"#fff7ed", borderColor:"#fdba74" }}>
          <div className="meta">
            Some thumbnails fell back to the generic image. Ensure each doc’s <code>image</code> exists in Storage
            or provide a direct <code>imageUrl</code>.
          </div>
        </div>
      )}

      {/* Subject tabs */}
      <div className="tabs" style={{ marginBottom: 12, display:"flex", gap:8, flexWrap:"wrap" }}>
        {subjects.order.map((s) => {
          const count = s === "All" ? items.length : (subjects.counts.get(s) || 0);
          return (
            <button
              key={s}
              className={`tab ${subjectFilter === s ? "tab-active" : ""}`}
              onClick={() => setSubjectFilter(s)}
            >
              {s} ({count})
            </button>
          );
        })}
      </div>

      {/* Cards grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:16 }}>
        {visible.map((it) => {
          const tier = String(it.accessTier || "locked").toLowerCase();
          const unlocked = isUnlockedForCase(tier, entitlements, whitelist, it.id);

          return (
            <article key={it.id} className="card case-card" style={{ display:"flex", gap:12, alignItems:"stretch" }}>
              {/* thumbnail */}
              <div style={{ width:120, minWidth:120, height:90, overflow:"hidden", borderRadius:8, background:"#f6f6f6" }}>
                <img
                  src={it.imageUrl || FALLBACK_PUBLIC_URL}
                  alt={it.title}
                  loading="lazy"
                  style={{ width:"100%", height:"100%", objectFit:"cover" }}
                  onError={(e) => {
                    if (!e.currentTarget.dataset.fallback) {
                      e.currentTarget.dataset.fallback = "1";
                      e.currentTarget.src = FALLBACK_PUBLIC_URL;
                    }
                  }}
                />
              </div>

              {/* content */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"start" }}>
                  <h3 style={{ margin:"0 0 4px 0", lineHeight:1.25 }}>
                    <Link to={`/case/${it.id}`}>{it.title}</Link>
                  </h3>
                  <span className={`pill ${tier === "premium" ? "pill-green" : ""}`}>{tier}</span>
                </div>

                <div className="meta" style={{ marginBottom: 6 }}>
                  <strong>{it.subject}</strong>{it.topic ? " • " : ""}{it.topic || "—"}
                </div>

                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <Link className="btn" to={`/case/${it.id}`}>{unlocked ? "Open" : "Preview"}</Link>
                  {!unlocked && <Link className="btn--outline" to="/unlock">Unlock</Link>}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div style={{ marginTop:16 }}>
        <Link className="button" to="/unlock">Unlock Codes</Link>
      </div>
    </div>
  );
}
