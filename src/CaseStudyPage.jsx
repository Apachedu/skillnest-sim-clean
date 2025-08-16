// src/CaseStudyPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  doc, getDoc, collection, addDoc, updateDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "./firebase/firebase";

// Cloud Run endpoint (root URL)
const AI_FEEDBACK_URL = "https://ai-feedback-874264746569.us-central1.run.app/";

/* ------------------------------ Session ID (per browser) ------------------------------ */
const getSessionId = () => {
  const k = "skillnest_session_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(k, v);
  }
  return v;
};

/* ------------------------------ Helpers ------------------------------ */
const ensureArray = (x) => {
  if (x === undefined || x === null) return [];
  if (Array.isArray(x)) return x;

  if (typeof x === "string") {
    const t = x.trim();
    // JSON-looking string from Sheet/Firestore
    if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
      try {
        const j = JSON.parse(t);
        return Array.isArray(j) ? j : [j];
      } catch {/* fall through */}
    }
    // Comma lists from Sheet (toolkit, resources, etc.)
    if (t.includes(",")) return t.split(",").map((s) => s.trim()).filter(Boolean);
    return t ? [t] : [];
  }

  if (typeof x === "object") return [x];
  return [String(x)];
};

const parseMaybeJSON = (v) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t) return v;
  if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
    try { return JSON.parse(t); } catch { return v; }
  }
  return v;
};

const ensureQuestions = (q, marksOverride = []) => {
  const arr = ensureArray(q);
  return arr.map((item, i) => {
    const base = (item && typeof item === "object") ? item : { text: String(item || "") };
    const override = Number(marksOverride?.[i]);
    const fallback = Number(base.marks ?? base.mark ?? 10);
    const marks = Number.isFinite(override) && override > 0 ? override : (fallback > 0 ? fallback : 10);
    return {
      id: base.id || `q${i + 1}`,
      text: base.text || String(base.question || ""),
      marks,
    };
  });
};

const ensureTable = (raw) => {
  if (!raw) return null;
  const v = parseMaybeJSON(raw);

  // Accept:
  // 1) { headers: [...], rows: [...] }
  // 2) { rows: [{colA:.., colB:..}, ...] }  (headers inferred)
  // 3) [[...], [...]] (array of arrays) with no headers
  if (Array.isArray(v)) {
    // array of arrays: build generic headers
    const maxCols = v.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    const headers = Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`);
    return { headers, rows: v };
  }

  if (v && typeof v === "object") {
    const headers = ensureArray(v.headers);
    const rows = ensureArray(v.rows);

    // rows as objects -> flatten by headers or inferred keys
    if (rows.length && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
      const keys = headers.length ? headers : Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
      const arrRows = rows.map((r) => keys.map((k) => r[k] ?? ""));
      return { headers: keys, rows: arrRows };
    }

    // already header + array rows
    if (headers.length && Array.isArray(rows[0])) {
      return { headers, rows };
    }
  }

  return null;
};

const toPercent = (got, max) => {
  const g = Number(got) || 0;
  const m = Number(max) || 0;
  if (m <= 0) return 0;
  return Math.round((g / m) * 100);
};

const toIB7 = (percent) => {
  const p = Number(percent) || 0;
  if (p >= 85) return 7;
  if (p >= 70) return 6;
  if (p >= 60) return 5;
  if (p >= 50) return 4;
  if (p >= 40) return 3;
  if (p >= 30) return 2;
  return 1;
};

// Simple word count
const countWords = (s) => (String(s || "").trim().match(/\b[\w’'-]+\b/g) || []).length;

// Min words rule per question (tweak if you like)
const minWordsForMarks = (marks) => {
  const m = Number(marks) || 10;
  // 6 → ~80, 10 → ~160 (12–16 words per mark)
  const v = Math.round(m * 14);
  return Math.max(60, Math.min(v, 200));
};

/* ------------------------------ Component ------------------------------ */
export default function CaseStudyPage() {
  const { id } = useParams();
  const sessionId = useMemo(getSessionId, []);

  const [caseData, setCaseData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Locking
  const [entitlements, setEntitlements] = useState({ IB1: false, IB2: false });

  // Review
  const [aiFb, setAiFb] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [responseDocId, setResponseDocId] = useState("");

  // Embed mode: hide back link & outer margins only (keep Toolkit/Resources visible)
  const [embedMode, setEmbedMode] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setEmbedMode(params.get("embed") === "1");
    } catch {}
  }, []);

  /* -------- Read entitlements (for locking) -------- */
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "access", sessionId));
        if (snap.exists()) {
          const data = snap.data() || {};
          if (data.entitlements && typeof data.entitlements === "object") {
            setEntitlements((prev) => ({ ...prev, ...data.entitlements }));
          }
        }
      } catch {}
    })();
  }, [sessionId]);

  /* -------- Fetch case -------- */
  useEffect(() => {
    const fetchCase = async () => {
      setErrorMsg("");
      setCaseData(null);
      try {
        const ref = doc(db, "caseStudies", id);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setErrorMsg("Case not found.");
          return;
        }
        const data = snap.data();

        const table = ensureTable(data.dataTable);

        setCaseData({
          ...data,
          caseText: ensureArray(data.caseText),
          toolkit: ensureArray(data.toolkit),
          resources: ensureArray(data.resources),
          relatedTopics: ensureArray(data.relatedTopics),
          questions: ensureQuestions(data.questions, data.marksPerQuestion),
          dataTable: table, // normalized or null
          image: data.image || "",
          imageAlt: data.imageAlt || "",
          imageCaption: data.imageCaption || "",
          accessTier: data.accessTier || "", // demo | IB1 | IB2
        });
      } catch (e) {
        setErrorMsg(e.message || "Failed to load case.");
      }
    };
    fetchCase();
  }, [id]);

  const onChangeAnswer = (idx, val) => {
    setAnswers((prev) => ({ ...prev, [idx]: val }));
  };

  const allWordCounts = (caseData?.questions || []).map((q, i) => countWords(answers[i]));
  const minWordsList = (caseData?.questions || []).map((q) => minWordsForMarks(q.marks));
  const meetsMinAll = allWordCounts.every((w, i) => w >= (minWordsList[i] || 0));

  const handleSubmit = async () => {
    if (!caseData) return;
    if (!meetsMinAll) {
      alert("Please reach the minimum word count for each answer before submitting.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      const payload = {
        caseId: id,
        title: caseData.title || "",
        subject: caseData.subject || "",
        topic: caseData.topic || "",
        commandTerm: caseData.commandTerm || "",
        answers: (caseData.questions || []).map((_, i) => String(answers[i] || "").trim()),
        maxMarksPerQ: (caseData.questions || []).map((q) => Number(q.marks || 10)),
        wordCounts: allWordCounts,
        sessionId,
        createdAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "responses"), payload);
      setResponseDocId(ref.id);
      setSubmitted(true);
    } catch (e) {
      setErrorMsg(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  async function generateReview() {
    try {
      setAiError("");
      setAiLoading(true);

      const res = await fetch(AI_FEEDBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: caseData?.title || "",
          questions: caseData?.questions || [],
          answers,
          rubric: { paperType: caseData?.paperType || "" },
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`HTTP ${res.status}: ${msg.slice(0, 200)}`);
      }
      const json = await res.json();

      const maxPerQ = (caseData?.questions || []).map((q) => Number(q?.marks || 10));
      const got = (json?.perQuestion || []).reduce((s, x) => s + Number(x?.marks || 0), 0);
      const max = maxPerQ.reduce((s, x) => s + x, 0);
      const percent = toPercent(got, max);
      const ib = toIB7(percent);

      const enriched = {
        ...json,
        overall: { ...(json.overall || {}), got, max, percent, ib },
      };
      setAiFb(enriched);

      if (responseDocId) {
        try {
          await updateDoc(doc(db, "responses", responseDocId), {
            aiFeedback: enriched,
            aiTotalPercent: percent,
            aiIBGrade: ib,
            aiComputedAt: serverTimestamp(),
          });
        } catch (e) {
          console.warn("Skipping save of feedback:", e?.message || e);
        }
      }
    } catch (e) {
      setAiError(String(e).slice(0, 300));
    } finally {
      setAiLoading(false);
    }
  }

  // Optional PDF download (only works if html2pdf is available on window)
  const downloadFeedbackPDF = async () => {
    if (!aiFb) return;
    const el = document.getElementById("ai-feedback");
    if (!el || !window.html2pdf) {
      alert("PDF generator not found. (We can add it later.)");
      return;
    }
    const opt = {
      margin: 10,
      filename: `${id}-feedback.pdf`,
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };
    await window.html2pdf().set(opt).from(el).save();
  };

  /* ------------------------------ Locking ------------------------------ */
  const tier = String(caseData?.accessTier || "").toUpperCase();
  const locked =
    tier === "DEMO" ? false :
    tier === "IB1" ? !entitlements.IB1 :
    tier === "IB2" ? !entitlements.IB2 :
    false; // if no tier set, show it (change to true to be stricter)

  /* ------------------------------ States ------------------------------ */
  if (errorMsg) {
    return (
      <div className="page-wrap">
        {!embedMode && <Link to="/" className="back-link">← Back</Link>}
        <p style={{ color: "crimson" }}>{errorMsg}</p>
      </div>
    );
  }
  if (!caseData) {
    return (
      <div className="page-wrap">
        {!embedMode && <Link to="/" className="back-link">← Back</Link>}
        <p>Loading…</p>
      </div>
    );
  }
  if (locked) {
    return (
      <div className="page-wrap" style={embedMode ? { margin: 0, padding: 0 } : undefined}>
        {!embedMode && <Link to="/" className="back-link">← Back</Link>}
        <div className="card" style={{ textAlign: "center" }}>
          <h2>This case is locked</h2>
          <p className="meta">Unlock with your access code or join the cohort.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
            <Link className="btn" to="/unlock">Unlock with code</Link>
            <a className="btn" href="https://tagmango.com/your-cohort-link" target="_blank" rel="noreferrer">Learn more</a>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ UI ------------------------------ */
  return (
    <div className="page-wrap no-select" style={embedMode ? { margin: 0, padding: 0 } : undefined}>
      {!embedMode && <Link to="/" className="back-link">← Back</Link>}

      <div className="watermark-shell" style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 8 }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Branded title */}
          <h1 className="brand-heading" style={{ marginBottom: 8 }}>
            {caseData.title}
          </h1>

          {/* Meta chips */}
          <div className="meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <span>{caseData.paperType ? `Paper • ${caseData.paperType}` : "—"}</span>
            {caseData.topic && <span>· {caseData.topic}</span>}
            {caseData.commandTerm && <span className="pill pill-green">{caseData.commandTerm}</span>}
            {caseData.estimatedTime && <span className="pill">{caseData.estimatedTime}</span>}
            {caseData.difficulty && <span className="pill">{caseData.difficulty}</span>}
          </div>

          {/* Hero image */}
          {caseData.image ? (
            <div className="case-hero">
              <img
                src={String(caseData.image).trim()}
                alt={caseData.imageAlt || caseData.title}
                loading="lazy"
                draggable="false"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              {caseData.imageCaption ? (
                <p className="meta" style={{ marginTop: 8 }}>{caseData.imageCaption}</p>
              ) : null}
            </div>
          ) : null}

          {/* Case text */}
          {caseData.caseText?.length ? (
            <section className="card">
              <h3>Case Study Overview</h3>
              {caseData.caseText.map((p, i) => (
                <p key={i} style={{ marginTop: i === 0 ? 4 : 10 }}>{p}</p>
              ))}
            </section>
          ) : null}

          {/* Data table */}
          {caseData.dataTable ? (
            <section className="card">
              <h3>Data Table</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  {caseData.dataTable.headers?.length ? (
                    <thead>
                      <tr>
                        {caseData.dataTable.headers.map((h, i) => (
                          <th key={i} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {caseData.dataTable.rows?.map((row, r) => (
                      <tr key={r}>
                        {(Array.isArray(row) ? row : Object.values(row)).map((cell, c) => (
                          <td key={c} style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                            {String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Toolkit + Resources + Related (visible in embed mode too) */}
          <div className="grid-2">
            {caseData.toolkit?.length ? (
              <section className="card">
                <h3>Toolkit</h3>
                <ul>{caseData.toolkit.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </section>
            ) : null}
            {(caseData.resources?.length || caseData.relatedTopics?.length) ? (
              <section className="card">
                <h3>Resources & Related</h3>
                {caseData.resources?.length ? (
                  <>
                    <h4>Resources</h4>
                    <ul>
                      {caseData.resources.map((r, i) => (
                        <li key={i}>
                          {String(r).startsWith("http") ? (
                            <a href={r} target="_blank" rel="noreferrer">{r}</a>
                          ) : r}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {caseData.relatedTopics?.length ? (
                  <>
                    <h4 style={{ marginTop: 10 }}>Related Topics</h4>
                    <ul>{caseData.relatedTopics.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </>
                ) : null}
              </section>
            ) : null}
          </div>

          {/* Questions */}
          <section className="card">
            <h3>Questions</h3>
            {(caseData.questions || []).map((q, i) => {
              const wc = allWordCounts[i] || 0;
              const minW = minWordsList[i] || 0;
              const pct = Math.min(100, Math.round((wc / Math.max(1, minW)) * 100));
              return (
                <div key={q.id || i} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>
                      {i + 1}. {q.text}
                    </div>
                    <div className="meta">
                      <span className="pill">{q.marks} marks</span>
                    </div>
                  </div>

                  {/* Word count + progress */}
                  <div className="meta" style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span>Words: {wc} / {minW}</span>
                    <div style={{ flex: 1, height: 8, background: "#eef2ff", borderRadius: 999, marginLeft: 10 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#7c3aed,#22d3ee)", borderRadius: 999 }} />
                    </div>
                  </div>

                  <textarea
                    value={answers[i] || ""}
                    onChange={(e) => onChangeAnswer(i, e.target.value)}
                    rows={Math.max(6, Math.ceil(minW / 30))}
                    placeholder="Type your answer here…"
                    className="answer-box"
                    style={{ marginTop: 8 }}
                  />
                </div>
              );
            })}

            <button
              className="btn"
              onClick={handleSubmit}
              disabled={saving || submitted || !meetsMinAll}
              title={
                submitted
                  ? "Already submitted"
                  : !meetsMinAll
                  ? "Please reach the minimum word count for each question."
                  : "Save your answers"
              }
            >
              {saving ? "Saving…" : submitted ? "Submitted" : "Submit Answers"}
            </button>
            {errorMsg && <div style={{ color: "crimson", marginTop: 8 }}>{errorMsg}</div>}
          </section>

          {/* Model Answer + Feedback (blur until submit) */}
          {(caseData.modelAnswer || caseData.feedback) && (
            <section className="card">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Model Answer & Feedback</h3>
                {!submitted && <span className="pill">Hidden until you submit</span>}
              </div>

              <div className={submitted ? "" : "blur-protect"}>
                {caseData.modelAnswer && (
                  <>
                    <h4 style={{ marginTop: 12 }}>Model Answer</h4>
                    {Array.isArray(caseData.modelAnswer)
                      ? caseData.modelAnswer.map((p, i) => <p key={i}>{p}</p>)
                      : <p>{caseData.modelAnswer}</p>}
                  </>
                )}

                {caseData.feedback && (
                  <>
                    <h4 style={{ marginTop: 12 }}>Feedback Guide</h4>
                    {renderFeedback(caseData.feedback)}
                  </>
                )}
              </div>
            </section>
          )}

          {/* SkillNestEdu Review (instant, after submit) */}
          {submitted && (
            <section className="card">
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>SkillNestEdu Review</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  {!aiFb && (
                    <button className="btn" onClick={generateReview} disabled={aiLoading}>
                      {aiLoading ? "Generating…" : "Get review"}
                    </button>
                  )}
                  {aiFb && window.html2pdf ? (
                    <button className="btn" onClick={downloadFeedbackPDF}>Download PDF</button>
                  ) : null}
                </div>
              </div>

              {aiError && <p style={{ color: "crimson", marginTop: 8 }}>{aiError}</p>}

              {aiFb ? (
                <div id="ai-feedback" style={{ marginTop: 8 }}>
                  <AIFeedbackCard ai={aiFb} questions={caseData.questions} answers={answers} />
                </div>
              ) : (
                <p className="meta" style={{ marginTop: 8 }}>
                  Submit first, then click “Get review” for instant, personalised guidance.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Subcomponents ------------------------------ */

function renderFeedback(feedback) {
  if (!feedback) return null;
  if (typeof feedback === "string") return <p>{feedback}</p>;
  if (Array.isArray(feedback)) return <ul>{feedback.map((x, i) => <li key={i}>{x}</li>)}</ul>;

  const { good, improve, add } = feedback || {};
  return (
    <>
      {good && (
        <>
          <h5>What you did well</h5>
          {toList(good)}
        </>
      )}
      {improve && (
        <>
          <h5>Areas for improvement</h5>
          {toList(improve)}
        </>
      )}
      {add && (
        <>
          <h5>What to add</h5>
          {toList(add)}
        </>
      )}
    </>
  );
}
function toList(val) {
  if (!val) return null;
  if (Array.isArray(val)) return <ul>{val.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  return <p>{val}</p>;
}

/* ------------------------------ Card for instant review ------------------------------ */
function AIFeedbackCard({ ai, questions, answers }) {
  const items = ai?.perQuestion || [];
  const overall = ai?.overall || {};
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {typeof overall.percent === "number" && (
        <div className="card" style={{ background: "#fafaff" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700 }}>Overall</div>
              <div className="meta">Score: {overall.got}/{overall.max}  •  {overall.percent}%  •  IB {overall.ib}/7</div>
            </div>
            <div style={{ minWidth: 160, height: 10, background: "#eef2ff", borderRadius: 999 }}>
              <div style={{ width: `${Math.min(100, overall.percent)}%`, height: "100%", background: "linear-gradient(90deg,#7c3aed,#22d3ee)", borderRadius: 999 }} />
            </div>
          </div>
        </div>
      )}

      {items.map((q, i) => (
        <div key={i} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>
              Q{i + 1} ({q.marks ?? "—"}/{questions?.[i]?.marks ?? "—"}): {q.title || questions?.[i]?.text?.slice(0, 48)}
            </div>
            <span className="pill">{q.criteria || "Rubric"}</span>
          </div>
          {q.comments ? <p style={{ marginTop: 8 }}>{q.comments}</p> : null}
          {answers?.[i] ? (
            <details style={{ marginTop: 6 }}>
              <summary className="meta">Your answer (preview)</summary>
              <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(answers[i]).slice(0, 600)}{String(answers[i]).length > 600 ? "…" : ""}</p>
            </details>
          ) : null}
        </div>
      ))}

      {ai?.tips?.length ? (
        <div className="card" style={{ background: "#f8fffb" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Next steps</div>
          <ul>
            {ai.tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
