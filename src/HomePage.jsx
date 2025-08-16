// src/HomePage.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase/firebase";

// Update these if you want different links
const TAGMANGO_COHORT_URL = "https://tagmango.com/your-cohort-link";
const CHECKOUT_IB1_BASIC_URL = "https://your-site.com/checkout/ib1-basic";
const CHECKOUT_IB1_PREMIUM_URL = "https://your-site.com/checkout/ib1-premium";

// Simple “unlock all” code for now (local, not secure; fine for MVP)
const UNLOCK_CODES = ["SN-DEMO-ALL"];

function hasGlobalAccess() {
  return localStorage.getItem("sn_unlocked_all") === "1";
}
function tryUnlock(code) {
  const ok = UNLOCK_CODES.includes(String(code || "").trim());
  if (ok) localStorage.setItem("sn_unlocked_all", "1");
  return ok;
}

export default function HomePage() {
  const [allCases, setAllCases] = useState([]);
  const [loading, setLoading] = useState(true);

  // unlock modal
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockInput, setUnlockInput] = useState("");

  // load cases
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "caseStudies"));
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));

        // Only show published (published !== false)
        const filtered = arr.filter((c) => c.published !== false);

        // sort: free first, then A→Z by title
        const sorted = filtered.sort((a, b) => {
          const at = String(a.accessTier || "").toLowerCase();
          const bt = String(b.accessTier || "").toLowerCase();
          if (at === "free" && bt !== "free") return -1;
          if (bt === "free" && at !== "free") return 1;
          return String(a.title || "").localeCompare(String(b.title || ""));
        });

        setAllCases(sorted);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="page-wrap">
      <h1 className="brand-heading" style={{ marginBottom: 6 }}>
        SkillNestEdu Case Studies
      </h1>
      <div className="meta" style={{ marginBottom: 16 }}>
        Try the free demo. Unlock the rest with a code or join the cohort.
      </div>

      {/* CTAs */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <strong>Get started</strong>
            <div className="meta">Immediate access. Cancel anytime.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn--pill" href={CHECKOUT_IB1_BASIC_URL} target="_blank" rel="noreferrer">
              IB1 Basic
            </a>
            <a className="btn--pill" href={CHECKOUT_IB1_PREMIUM_URL} target="_blank" rel="noreferrer">
              IB1 Premium
            </a>
            <a className="btn--outline" href={TAGMANGO_COHORT_URL} target="_blank" rel="noreferrer">
              Join Cohort
            </a>
            <button className="btn--outline" onClick={() => setShowUnlock(true)}>
              Unlock with code
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="meta">Loading cases…</p>
      ) : (
        <div className="grid-2">
          {allCases.map((c) => {
            const tier = String(c.accessTier || "").toLowerCase(); // "free" | "locked" | later: "basic"/"premium"
            const locked = tier !== "free" && !hasGlobalAccess();
            const isFree = tier === "free";

            return (
              <div key={c.id} className="card case-card">
                {/* Lock ribbon */}
                {locked && <div className="ribbon-lock">Locked</div>}

                {/* Image (dim if locked) */}
                {c.image ? (
                  <div className={`thumb ${locked ? "thumb-locked" : ""}`}>
                    <img
                      src={String(c.image)}
                      alt={c.imageAlt || c.title}
                      loading="lazy"
                      draggable="false"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                ) : null}

                {/* Title + DEMO badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{c.title}</div>
                  {isFree && <span className="badge-demo">DEMO</span>}
                </div>

                {c.topic && <div className="meta" style={{ marginTop: 4 }}>{c.topic}</div>}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {locked ? (
                    <>
                      <button className="btn--outline" onClick={() => setShowUnlock(true)}>Unlock</button>
                      <a className="btn--outline" target="_blank" rel="noreferrer" href={TAGMANGO_COHORT_URL}>
                        Learn more
                      </a>
                    </>
                  ) : (
                    <Link className="btn--pill" to={`/case/${c.id}`}>Open</Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unlock modal */}
      {showUnlock && (
        <div
          onClick={() => setShowUnlock(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              width: "min(92vw, 420px)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Enter unlock code</h3>
            <input
              value={unlockInput}
              onChange={(e) => setUnlockInput(e.target.value)}
              placeholder="Enter your code"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn--outline" onClick={() => setShowUnlock(false)}>
                Cancel
              </button>
              <button
                className="btn--pill"
                onClick={() => {
                  if (tryUnlock(unlockInput)) {
                    setShowUnlock(false);
                    setUnlockInput("");
                    window.location.reload();
                  } else {
                    alert("Invalid code");
                  }
                }}
              >
                Unlock
              </button>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              Need a code? Email{" "}
              <a href="mailto:contact@skillnestedu.com">contact@skillnestedu.com</a>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
