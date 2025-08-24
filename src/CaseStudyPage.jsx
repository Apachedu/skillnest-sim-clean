// src/CaseStudyPage.jsx
// Full, self-contained page: fetch, marks/wordcount, submit, AI review, PDF,
// image fallback, locking (tiers + per-case whitelist).

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import {
  doc, getDoc, collection, addDoc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { db, storage } from "./firebase/firebase";
import { ref as storageRef, getDownloadURL } from "firebase/storage";

/* ---------------------------- Config / constants ---------------------------- */
const AI_FEEDBACK_URL = (import.meta.env.VITE_AI_FEEDBACK_URL || "").trim() || "/ai-feedback";
// Use a file that exists in /public (no CORS).
const HERO_FALLBACK_PUBLIC_URL = "/placeholder-thumb.jpg";

/* --------------------------------- Helpers --------------------------------- */
function readEntitlements() {
  try {
    const r = JSON.parse(localStorage.getItem("sn_entitlements") || "{}");
    const premium = !!r.PREMIUM;
    const basic = !!r.BASIC || premium; // premium implies basic
    return { BASIC: basic, PREMIUM: premium };
  } catch {
    return { BASIC: false, PREMIUM: false };
  }
}
function readWhitelist() {
  try { return JSON.parse(localStorage.getItem("sn_whitelist") || "[]"); }
  catch { return []; }
}
function isUnlockedForCase(tier, ent, whitelist, caseId) {
  const t = String(tier ?? "locked").toLowerCase();
  if (Array.isArray(whitelist) && whitelist.includes(caseId)) return true; // per-case override
  if (t === "free") return true;
  if (t === "basic") return !!(ent.BASIC || ent.PREMIUM);
  if (t === "premium") return !!ent.PREMIUM;
  return false;
}

const ensureArray = (x) => {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "string") {
    const t = x.trim();
    if (!t) return [];
    if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
      try { const j = JSON.parse(t); return Array.isArray(j) ? j : [j]; } catch {}
    }
    if (t.includes(",")) return t.split(",").map(s => s.trim()).filter(Boolean);
    return [t];
  }
  if (typeof x === "object") return [x];
  return [String(x)];
};
const ensureNumberArray = (x) => {
  if (Array.isArray(x)) return x.map(n => (Number.isFinite(+n) ? +n : undefined));
  if (x == null) return [];
  if (typeof x === "string") {
    const t = x.trim();
    if (!t) return [];
    if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
      try { const j = JSON.parse(t); return Array.isArray(j) ? j.map(n => (Number.isFinite(+n) ? +n : undefined)) : []; } catch {}
    }
    if (t.includes(",")) return t.split(",").map(s => { const v = +s.trim(); return Number.isFinite(v) ? v : undefined; });
    return Number.isFinite(+t) ? [+t] : [];
  }
  return [];
};
function normalizeQuestions(data) {
  const marks = ensureNumberArray(data.marksPerQuestion);
  if (Array.isArray(data.questions) && data.questions.length) {
    return data.questions.map((q, i) => {
      if (typeof q === "string") return { id: `q${i + 1}`, text: q, marks: Number.isFinite(marks[i]) ? marks[i] : undefined };
      const text = q?.text ?? q?.prompt ?? q?.question ?? "";
      const own  = Number.isFinite(+q?.marks) ? +q.marks : undefined;
      return { id: q?.id || `q${i + 1}`, text: String(text || ""), marks: Number.isFinite(own) ? own : (Number.isFinite(marks[i]) ? marks[i] : undefined) };
    });
  }
  const guessN = Math.max(marks.length, ...Array.from({ length: 12 }, (_, k) => (data[`q${k + 1}`] ? k + 1 : 0)));
  return Array.from({ length: guessN }, (_, i) => ({ id: `q${i + 1}`, text: String(data[`q${i + 1}`] || ""), marks: Number.isFinite(marks[i]) ? marks[i] : undefined }));
}
const ensureQuestions = (q, marksOverride = []) => {
  const arr = ensureArray(q);
  return arr.map((item, i) => {
    const base = (item && typeof item === "object") ? item : { text: String(item || "") };
    const override = Number(marksOverride?.[i]);
    const own = Number(base.marks ?? base.mark);
    const final = Number.isFinite(override) ? override : (Number.isFinite(own) ? own : 10);
    return { id: base.id || `q${i + 1}`, text: base.text || String(base.question || ""), marks: final };
  });
};
const parseMaybeJSON = (v) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t) return v;
  if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) { try { return JSON.parse(t); } catch { return v; } }
  return v;
};
const ensureTable = (raw) => {
  if (!raw) return null;
  if (typeof raw === "string" && raw.trim().startsWith("__JSON__:")) {
    try {
      const j = JSON.parse(raw.trim().slice("__JSON__:".length));
      if (j && Array.isArray(j.headers) && Array.isArray(j.rows)) return { headers: j.headers, rows: j.rows };
    } catch {}
  }
  const v = parseMaybeJSON(raw);
  if (Array.isArray(v)) {
    const maxCols = v.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    const headers = Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`);
    return { headers, rows: v };
  }
  if (v && typeof v === "object") {
    const headers = ensureArray(v.headers);
    const rows = ensureArray(v.rows);
    if (rows.length && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
      const keys = headers.length ? headers : Array.from(new Set(rows.flatMap(r => Object.keys(r))));
      const arrRows = rows.map(r => keys.map(k => r[k] ?? ""));
      return { headers: keys, rows: arrRows };
    }
    if (headers.length && Array.isArray(rows[0])) return { headers, rows };
  }
  return null;
};

const countWords = (s) => (String(s || "").trim().match(/\b[\w’'-]+\b/g) || []).length;
// stricter: ~16 words/mark, min 80, cap 240
const minWordsForMarks = (marks) => Math.max(80, Math.min(Math.round((Number(marks) || 10) * 16), 240));

// drafts
function sid() { let x = localStorage.getItem("skillnest_session_id"); if (!x) { x = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("skillnest_session_id", x); } return x; }
const draftKey   = (caseId) => `sn_draft_${caseId}_${sid()}`;
const loadDraft  = (caseId) => { try { const raw = localStorage.getItem(draftKey(caseId)); return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const saveDraft  = (caseId, data) => { try { localStorage.setItem(draftKey(caseId), JSON.stringify({ ...data, _ts: Date.now() })); } catch {} };
const clearDraft = (caseId) => { try { localStorage.removeItem(draftKey(caseId)); } catch {} };

/* -------------------- Strict marking → IB 1–7 mapping ----------------------- */
const STRICT_MARKING = true;
const IB_DESC = {
  1: "Very limited: fragmentary knowledge; no usable diagram; no analysis/evaluation.",
  2: "Limited: partial/inaccurate theory; weak diagram; minimal application.",
  3: "Basic: some correct theory; diagram present but poorly integrated; superficial analysis.",
  4: "Adequate: mostly correct theory; relevant diagram; some application; thin analysis.",
  5: "Good: accurate theory; well-labelled diagram; clear application; coherent analysis; some evaluation.",
  6: "Very good: strong, integrated analysis; balanced evaluation; precise diagrams; clear judgement.",
  7: "Excellent: consistently accurate, contextualised analysis; sustained, criteria-based evaluation; precise diagrams; fully justified conclusion.",
};
function toIB7Strict(percent) {
  const p = Number(percent) || 0;
  if (p >= 95) return 7;
  if (p >= 85) return 6;
  if (p >= 72) return 5;
  if (p >= 60) return 4;
  if (p >= 48) return 3;
  if (p >= 38) return 2;
  return 1;
}
function applyStrictAdjustments(perQ, answers, questions) {
  const econTerms = /\b(ped|elastic|inelastic|incidence|burden|revenue|dwl|deadweight|welfare|externalit|equity|efficien|ppc|marginal|opportunity|substitut|complement|regress|tax|subsidy)\b/i;
  return (perQ || []).map((item, i) => {
    const max  = Number(questions?.[i]?.marks || 10);
    const got0 = Number(item?.marks || 0);
    const ans  = String(answers?.[i] || "");
    const wc   = countWords(ans);
    const minW = minWordsForMarks(max);
    let got = Math.max(0, Math.min(max, got0));
    let comments = [];

    if (wc < minW) {
      const ratio  = Math.max(0, wc / minW);
      const curved = Math.pow(ratio, 0.85);
      got = Math.min(got, Math.round(max * curved * 0.85));
      comments.push(`Too short for ${max} marks (words ${wc}/${minW}).`);
    }
    const qText = String(questions?.[i]?.text || "");
    const needsDiagram = /\bdiagram|draw|ppc|curve\b/i.test(qText);
    const hasDiagramCues = /\bdiagram|graph|curve|axis|axes|shift|label|pc\b|pp\b|q0\b|q1\b|wedge|dwl|deadweight\b/i.test(ans.toLowerCase());
    if (needsDiagram && !hasDiagramCues) {
      got = Math.min(got, Math.round(max * 0.6));
      comments.push("Weak/no diagram references. Capped at 60%.");
    }
    const termHits = (ans.match(new RegExp(econTerms, "gi")) || []).length;
    if (termHits < 2) {
      got = Math.min(got, Math.round(max * 0.7));
      comments.push("Limited use of economics terms; mark capped.");
    }
    if (wc < 60) got = Math.min(got, Math.round(max * 0.5));
    if (wc < 40) got = Math.min(got, Math.round(max * 0.35));

    comments = comments.join(" ").trim();
    return { ...item, marks: got, comments: item?.comments ? `${item.comments} ${comments}`.trim() : comments };
  });
}
function rubricChecks(qtext, ans) {
  const q = String(qtext || "").toLowerCase();
  const a = String(ans || "").toLowerCase();
  const checks = [];
  if (/elasticity|ped\b/.test(q)) {
    checks.push(
      ["PED formula", /\bped\b|% ?Δq|% ?Δp|% ?change in quantity|% ?change in price|ped\s*=\s*%/i],
      ["Short vs long run", /short[\s-]?run|long[\s-]?run|over time|time horizon/i],
      ["Determinants/substitutes", /substitut|alternativ|habit|brand|income share/i]
    );
  }
  if (/diagram|incidence|indirect tax|deadweight|welfare|dwl/.test(q)) {
    checks.push(
      ["Diagram labels", /axis|axes|curve|label|s\W*\+\W*tax|pc\b|pp\b|q0\b|q1\b|vertical gap/i],
      ["Incidence (elasticities)", /elastic|inelastic|burden|consumer|producer/i],
      ["Revenue & DWL", /revenue|rectangle|dwl|deadweight|triangle/i]
    );
  }
  if (/equity|efficien/.test(q)) {
    checks.push(
      ["Negative externality", /externalit|social cost|over[- ]?consumption|health/i],
      ["Regressive burden", /regress|low-?income|inequal|burden/i],
      ["Mitigation / earmarking", /earmark|subsid|water|fountain|fruit|healthy/i]
    );
  }
  const found = [], missing = [];
  for (const [label, pattern] of checks) (pattern.test(a) ? found : missing).push(label);
  return { found, missing };
}
function enrichPerQuestion(perQ, answersArr, questions) {
  return (questions || []).map((q, i) => {
    const base = perQ[i] || {};
    const { found, missing } = rubricChecks(q?.text, answersArr[i]);
    const extra = [
      found.length ? `✓ Mentioned: ${found.join(", ")}.` : "",
      missing.length ? `✗ Missing: ${missing.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    return { ...base, comments: [base.comments, extra].filter(Boolean).join(" ") };
  });
}
function expandNarratives(perQ, answersArr, questions, caseData) {
  const toMsg = (label, tone = "good") => {
    const map = {
      "PED formula": {
        good: "You use the PED formula (PED = %ΔQd / %ΔP) to anchor your explanation and interpret elasticity correctly.",
        improve: "State the formula explicitly and interpret the sign (e.g., PED ≈ −0.4 means quantity falls 0.4% when price rises 1%).",
        add: "Add one worked number from the case to show a concrete calculation of PED.",
      },
      "Short vs long run": {
        good: "You distinguish habits in the short run from substitution in the long run—key for tax impact.",
        improve: "Make the time path explicit and tie it to policy timing (immediate vs. persistent effects).",
        add: "Note how availability/marketing of low-sugar options increases long-run elasticity.",
      },
      "Determinants/substitutes": {
        good: "You cover relevant determinants (substitutes, habit/brand, budget share).",
        improve: "Link each determinant directly to a sentence in the case context.",
        add: "Briefly rank the determinants by likely strength and justify your ranking.",
      },
      "Diagram labels": {
        good: "You reference key labels so the diagram supports your explanation.",
        improve: "Refer to labels inside the paragraph (Pc, Pp, Q0→Q1, vertical gap = tax).",
        add: "Add a neat diagram with axes (P,Q), S and S+tax, Pc, Pp, Q0→Q1, and shaded DWL.",
      },
      "Incidence (elasticities)": {
        good: "You link tax incidence to relative elasticities and identify who bears more burden.",
        improve: "State the extreme cases to frame the intuition.",
        add: "Qualitatively quantify burden shares and justify using elasticity.",
      },
      "Revenue & DWL": {
        good: "You identify tax revenue and the deadweight loss correctly.",
        improve: "Explain why DWL appears and how it scales with elasticity/tax size.",
        add: "On the diagram: label revenue rectangle (t×Q1) and DWL triangle.",
      },
      "Negative externality": {
        good: "You justify the tax as internalising health externalities.",
        improve: "Name 2+ cost channels and connect to welfare reasoning.",
        add: "Bring one evidence point (study/country example).",
      },
      "Regressive burden": {
        good: "You recognise potential regressivity for low-income households.",
        improve: "Explain the mechanism and discuss fairness explicitly.",
        add: "Propose offsets: fountains, vouchers, or tiered rates.",
      },
      "Mitigation / earmarking": {
        good: "You suggest using revenue to fund health equity measures.",
        improve: "Make earmarks specific and measurable.",
        add: "Add a timeline and one KPI to show realism.",
      },
    };
    const entry = map[label] || {};
    return entry[tone] || (tone === "add" ? `Add: ${label}.` : `${tone === "good" ? "Good" : "Improve"}: ${label}.`);
  };
  const newPerQ = (questions || []).map((q, i) => {
    const comments = String(perQ[i]?.comments || "");
    const found = (comments.match(/✓ Mentioned: (.+?)\./) || [])[1]?.split(",").map(s => s.trim()) || [];
    const missing = (comments.match(/✗ Missing: (.+?)\./) || [])[1]?.split(",").map(s => s.trim()) || [];
    const good = [], improve = [], add = [];
    for (const f of found) good.push(toMsg(f, "good"));
    for (const m of missing) { improve.push(toMsg(m, "improve")); add.push(toMsg(m, "add")); }
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    return { ...perQ[i], good: uniq(good).slice(0, 6), improve: uniq(improve).slice(0, 6), add: uniq(add).slice(0, 6) };
  });
  const study = {
    toolkit: (caseData?.toolkit || []).slice(0, 8),
    relatedTopics: (caseData?.relatedTopics || []).slice(0, 10),
    resources: (caseData?.resources || []).slice(0, 8),
  };
  const overall = {
    good: [
      "Accurate core theory and relevant application to the case.",
      "Clear structure with definitions up front and appropriate terms.",
      ...(study.toolkit?.length ? ["Good alignment with the listed toolkit—cross-reference it in answers."] : []),
    ],
    improve: [
      "Make diagram references explicit in text (Pc, Pp, Q0→Q1, vertical gap = tax).",
      "Evaluate with criteria (elasticities, equity, time horizon, evidence) and end with a justified judgement.",
      "Tighten topic sentences so each paragraph answers the command term directly.",
    ],
    add: [
      "Include one number (e.g., PED ≈ −0.4) and one evidence point (country example).",
      "Propose a concrete earmark (e.g., 20% revenue → school fountains) with a measurable KPI.",
      "Add a one-line conclusion answering the question directly.",
    ],
  };
  return { perQuestion: newPerQ, study, overall };
}

/* -------------------------------- Component -------------------------------- */
export default function CaseStudyPage() {
  const { id } = useParams();

  // entitlements & per-device whitelist
  const entitlements = useMemo(readEntitlements, []);
  const whitelist    = useMemo(readWhitelist, []);

  // local state
  const [caseData, setCaseData]       = useState(null);
  const [answers, setAnswers]         = useState({});
  const [submitted, setSubmitted]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [errorMsg, setErrorMsg]       = useState("");

  // AI review state
  const [aiFb, setAiFb]               = useState(null);
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiError, setAiError]         = useState("");
  const [responseDocId, setResponseDocId] = useState("");

  // hero image
  const [imageUrl, setImageUrl]       = useState("");

  // optional embed mode (?embed=1)
  const [embedMode, setEmbedMode]     = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setEmbedMode(params.get("embed") === "1");
    } catch {}
  }, []);

  /* ------------------------------- Fetch case ------------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErrorMsg("");
      setCaseData(null);
      try {
        const snap = await getDoc(doc(db, "caseStudies", id));
        if (!snap.exists()) { setErrorMsg("Case not found."); return; }

        const data = snap.data() || {};
        const marks = ensureNumberArray(data.marksPerQuestion);
        const questions = normalizeQuestions({ ...data, marksPerQuestion: marks });
        const table = ensureTable(data.dataTable);

        if (!cancelled) {
          setCaseData({
            id: snap.id,
            title: data.title || snap.id,
            subject: data.subject || "",
            topic: data.topic || "",
            commandTerm: data.commandTerm || "",
            estimatedTime: data.estimatedTime || "",
            difficulty: data.difficulty || "",
            paperType: data.paperType || "",

            caseText: ensureArray(data.caseText),
            toolkit: ensureArray(data.toolkit),
            resources: ensureArray(data.resources),
            relatedTopics: ensureArray(data.relatedTopics),

            marksPerQuestion: marks,
            questions, // raw normalized (marks may be undefined here)

            dataTable: table,

            image: data.image || "",
            imageAlt: data.imageAlt || "",
            imageCaption: data.imageCaption || "",
            accessTier: data.accessTier ?? "locked",
          });
        }
      } catch (e) {
        if (!cancelled) setErrorMsg(e.message || "Failed to load case.");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Resolve hero image URL (Storage path or public URL)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = String(caseData?.image || "").trim();
        if (!raw) { if (!cancelled) setImageUrl(HERO_FALLBACK_PUBLIC_URL); return; }
        if (/^https?:\/\//i.test(raw)) { if (!cancelled) setImageUrl(raw); return; }
        const url = await getDownloadURL(storageRef(storage, raw)); // e.g. "images/econ-generic-hero-001.jpg"
        if (!cancelled) setImageUrl(url);
      } catch {
        if (!cancelled) setImageUrl(HERO_FALLBACK_PUBLIC_URL);
      }
    })();
    return () => { cancelled = true; };
  }, [caseData?.image]);

  // Build final [{id,text,marks}] used everywhere
  const questionsNorm = useMemo(() => {
    if (!caseData) return [];
    const base = ensureQuestions(caseData.questions, caseData.marksPerQuestion);
    return base.map((q, i) => ({
      ...q,
      marks: Number.isFinite(+q?.marks) ? +q.marks
        : (Number.isFinite(+(caseData?.marksPerQuestion?.[i])) ? +(caseData.marksPerQuestion[i]) : 10),
    }));
  }, [caseData]);

  // drafts
  useEffect(() => {
    const draft = loadDraft(id);
    if (draft && Object.keys(draft).length) setAnswers(draft);
  }, [id]);
  const onChangeAnswer = (idx, val) => {
    setAnswers(prev => { const next = { ...prev, [idx]: val }; saveDraft(id, next); return next; });
  };

  // Word counts / minimums tied to normalized marks
  const allWordCounts = questionsNorm.map((_, i) => countWords(answers[i]));
  const minWordsList  = questionsNorm.map((q) => minWordsForMarks(q.marks));
  const meetsMinAll   = allWordCounts.every((w, i) => w >= (minWordsList[i] || 0));

  // Locking (tiers + whitelist)
  const tier     = String(caseData?.accessTier ?? "locked").toLowerCase();
  const unlocked = isUnlockedForCase(tier, entitlements, whitelist, id);
  const locked   = !unlocked;

  // Submit
  const handleSubmit = async () => {
    if (!caseData) return;
    if (!meetsMinAll) { alert("Please reach the minimum word count for each answer before submitting."); return; }
    setSaving(true); setErrorMsg("");
    try {
      const payload = {
        caseId: id,
        title: caseData.title || "",
        subject: caseData.subject || "",
        topic: caseData.topic || "",
        commandTerm: caseData.commandTerm || "",
        answers: questionsNorm.map((_, i) => String(answers[i] || "").trim()),
        maxMarksPerQ: questionsNorm.map((q) => Number(q.marks || 10)),
        wordCounts: allWordCounts,
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

  // AI review
  async function generateReview() {
    if (!caseData) return;
    try {
      setAiError(""); setAiLoading(true);

      const answersArr = questionsNorm.map((_, i) => String(answers[i] || "").trim());
      const payload = {
        title: caseData.title || "",
        questions: questionsNorm.map(q => ({ text: q.text, marks: Number(q.marks || 10) })),
        answers: answersArr,
        rubric: { paperType: caseData.paperType || "" },
      };

      const res = await fetch(AI_FEEDBACK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`AI service ${res.status}: ${(await res.text()).slice(0,300)}`);

      const json = await res.json();

      const maxPerQ = questionsNorm.map(q => Number(q.marks || 10));
      let perQ = Array.isArray(json?.perQuestion) ? json.perQuestion : [];

      if (STRICT_MARKING) perQ = applyStrictAdjustments(perQ, answersArr, questionsNorm);

      perQ = perQ.map((item, i) => {
        const cap = Number(maxPerQ[i] || 0);
        const got = Math.max(0, Math.min(Number(item?.marks || 0), cap));
        const pct = Math.round((got / Math.max(1, cap)) * 100);
        const ib = toIB7Strict(pct);
        return { ...item, ib };
      });

      perQ = enrichPerQuestion(perQ, answersArr, questionsNorm);
      const rich = expandNarratives(perQ, answersArr, questionsNorm, caseData);

      const got = perQ.reduce((s, x, i) => Math.min(maxPerQ[i], Number(x?.marks || 0)) + s, 0);
      const max = maxPerQ.reduce((s, x) => s + x, 0);
      const percent = Math.round((got / Math.max(1, max)) * 100);

      // make mutable for caps
      let ib = toIB7Strict(percent);

      // require strong performance on every question for a 7
      const allStrong = perQ.every((q, i) => {
        const cap = Number(maxPerQ[i] || 0);
        const pct = Math.round((Math.max(0, Math.min(q.marks || 0, cap)) / Math.max(1, cap)) * 100);
        return pct >= 90 && q.ib >= 6;
      });
      if (!allStrong) ib = Math.min(ib, 6);

      // if any question < 60% then overall capped at 5
      const anyWeak = perQ.some((q, i) => {
        const cap = Number(maxPerQ[i] || 0);
        const pct = Math.round((Math.max(0, Math.min(q.marks || 0, cap)) / Math.max(1, cap)) * 100);
        return pct < 60;
      });
      if (anyWeak) ib = Math.min(ib, 5);

      const enriched = {
        ...json,
        perQuestion: rich.perQuestion,
        overall: {
          ...(json.overall || {}),
          got, max, percent, ib,
          ibDescriptor: IB_DESC[ib],
          good: rich.overall.good, improve: rich.overall.improve, add: rich.overall.add,
        },
        study: rich.study,
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
        } catch {}
      }
    } catch (e) {
      setAiError(String(e).slice(0, 300));
    } finally {
      setAiLoading(false);
    }
  }

  // PDF
  const downloadPDF = useCallback(async () => {
    const el = document.getElementById("pdf-root");
    if (!el) { alert("PDF container not found."); return; }
    if (!window.html2pdf) { window.print(); return; }
    const opt = {
      margin: 10,
      filename: `${id}-responses.pdf`,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };
    await window.html2pdf().set(opt).from(el).save();
  }, [id]);

  /* ------------------------------ Render states ----------------------------- */
  if (errorMsg) {
    return (
      <div className="page-wrap">
        <Link to="/" className="back-link">← Back</Link>
        <p style={{ color: "crimson" }}>{errorMsg}</p>
      </div>
    );
  }
  if (!caseData) {
    return (
      <div className="page-wrap">
        <Link to="/" className="back-link">← Back</Link>
        <p>Loading…</p>
      </div>
    );
  }
  if (!isUnlockedForCase(String(caseData?.accessTier ?? "locked"), entitlements, whitelist, id)) {
    return (
      <div className="page-wrap">
        <Link to="/" className="back-link">← Back</Link>
        <div className="card" style={{ textAlign: "center" }}>
          <h2>This case is locked</h2>
          <p className="meta">Unlock with your access code or join the cohort.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
            <Link className="btn" to="/">Back to cases</Link>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------- UI ----------------------------------- */
  return (
    <div className="page-wrap no-select">
      <Link to="/" className="back-link">← Back</Link>

      <div id="pdf-root" className="watermark-shell" style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 8 }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1 className="brand-heading" style={{ marginBottom: 8 }}>{caseData.title}</h1>

          <div className="meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {caseData.topic && <span>{caseData.topic}</span>}
            {caseData.commandTerm && <span className="pill pill-green">{caseData.commandTerm}</span>}
            {caseData.estimatedTime && <span className="pill">{caseData.estimatedTime}</span>}
            {caseData.difficulty && <span className="pill">{caseData.difficulty}</span>}
          </div>

          <div className="case-hero">
            <img
              src={imageUrl || HERO_FALLBACK_PUBLIC_URL}
              alt={caseData.imageAlt || caseData.title}
              loading="lazy"
              draggable="false"
              onError={(e) => { e.currentTarget.src = HERO_FALLBACK_PUBLIC_URL; }}
            />
            {caseData.imageCaption ? <p className="meta" style={{ marginTop: 8 }}>{caseData.imageCaption}</p> : null}
          </div>

          {caseData.caseText?.length ? (
            <section className="card">
              <h3>Case Study Overview</h3>
              {caseData.caseText.map((p, i) => <p key={i} style={{ marginTop: i === 0 ? 4 : 10 }}>{p}</p>)}
            </section>
          ) : null}

          {caseData.dataTable ? (
            <section className="card">
              <h3>Data Table</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  {caseData.dataTable.headers?.length ? (
                    <thead>
                      <tr>
                        {caseData.dataTable.headers.map((h, i) => (
                          <th key={i} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {caseData.dataTable.rows?.map((row, r) => (
                      <tr key={r}>
                        {(Array.isArray(row) ? row : Object.values(row)).map((cell, c) => (
                          <td key={c} style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="card">
            <h3>Questions</h3>
            {questionsNorm.map((q, i) => {
              const wc = allWordCounts[i] || 0;
              const minW = minWordsList[i] || 0;
              const pct = Math.min(100, Math.round((wc / Math.max(1, minW)) * 100));
              return (
                <div key={q.id || i} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{i + 1}. {q.text}</div>
                    <div className="meta"><span className="pill">{q.marks} marks</span></div>
                  </div>

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
                submitted ? "Already submitted"
                : !meetsMinAll ? "Please reach the minimum word count for each question."
                : "Save your answers"
              }
            >
              {saving ? "Saving…" : submitted ? "Submitted" : "Submit Answers"}
            </button>
            {errorMsg && <div style={{ color: "crimson", marginTop: 8 }}>{errorMsg}</div>}
          </section>

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

          {submitted && (
            <section className="card">
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>SkillNestEdu Review</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!aiFb && (
                    <button className="btn" onClick={generateReview} disabled={aiLoading}>
                      {aiLoading ? "Generating…" : "Get review"}
                    </button>
                  )}
                  <button className="btn" onClick={downloadPDF}>Download PDF</button>
                  <button className="btn--outline" onClick={() => window.print()}>Print</button>
                  <button className="btn--outline" onClick={() => { clearDraft(id); alert("Draft cleared on this device."); }}>
                    Clear draft
                  </button>
                </div>
              </div>

              {aiError && <p style={{ color: "crimson", marginTop: 8 }}>{aiError}</p>}

              {aiFb ? (
                <div id="ai-feedback" style={{ marginTop: 8 }}>
                  <AIFeedbackCard ai={aiFb} questions={questionsNorm} answers={answers} />
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

/* ------------------------------- Subcomponents ------------------------------ */
function renderFeedback(feedback) {
  if (!feedback) return null;
  if (typeof feedback === "string") return <p>{feedback}</p>;
  if (Array.isArray(feedback)) return <ul>{feedback.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  const { good, improve, add } = feedback || {};
  const toList = (val) => Array.isArray(val) ? <ul>{val.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p>{val}</p>;
  return (
    <>
      {good && (<><h5>What you did well</h5>{toList(good)}</>)}
      {improve && (<><h5>Areas for improvement</h5>{toList(improve)}</>)}
      {add && (<><h5>What to add</h5>{toList(add)}</>)}
    </>
  );
}

function AIFeedbackCard({ ai, questions, answers }) {
  const items = Array.isArray(ai?.perQuestion) ? ai.perQuestion : [];
  const overall = ai?.overall || {};

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {typeof overall.percent === "number" && (
        <div className="card" style={{ background: "#fafaff" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700 }}>Overall</div>
              <div className="meta">
                Score: {overall.got}/{overall.max} &nbsp;•&nbsp; {overall.percent}% &nbsp;•&nbsp; IB {overall.ib}/7
              </div>
              {overall.ibDescriptor && <div className="meta" style={{ marginTop: 4 }}>{overall.ibDescriptor}</div>}
            </div>
            <div style={{ minWidth: 160, height: 10, background: "#eef2ff", borderRadius: 999 }}>
              <div style={{ width: `${Math.min(100, overall.percent)}%`, height: "100%", background: "linear-gradient(90deg,#7c3aed,#22d3ee)", borderRadius: 999 }} />
            </div>
          </div>

          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {Array.isArray(overall.good) && overall.good.length > 0 && (
              <div><strong>What you did well</strong><ul>{overall.good.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
            )}
            {Array.isArray(overall.improve) && overall.improve.length > 0 && (
              <div><strong>What needs improvement</strong><ul>{overall.improve.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
            )}
            {Array.isArray(overall.add) && overall.add.length > 0 && (
              <div><strong>What to add</strong><ul>{overall.add.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
            )}
          </div>
        </div>
      )}

      {items.map((q, i) => (
        <div key={i} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>
              Q{i + 1} ({q.marks ?? "—"}/{questions?.[i]?.marks ?? "—"}): {(questions?.[i]?.text || "").slice(0, 60)}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="pill">{q.criteria || "Rubric"}</span>
              {typeof q.ib === "number" && <span className="pill pill-green">IB {q.ib}/7</span>}
            </div>
          </div>
          {q.comments ? <p style={{ marginTop: 8 }}>{q.comments}</p> : null}

          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {Array.isArray(q.good) && q.good.length > 0 && (
              <div><strong>What you did well</strong><ul>{q.good.map((t, k) => <li key={k}>{t}</li>)}</ul></div>
            )}
            {Array.isArray(q.improve) && q.improve.length > 0 && (
              <div><strong>What needs improvement</strong><ul>{q.improve.map((t, k) => <li key={k}>{t}</li>)}</ul></div>
            )}
            {Array.isArray(q.add) && q.add.length > 0 && (
              <div><strong>What to add</strong><ul>{q.add.map((t, k) => <li key={k}>{t}</li>)}</ul></div>
            )}
          </div>

          {answers?.[i] ? (
            <details style={{ marginTop: 6 }}>
              <summary className="meta">Your answer (preview)</summary>
              <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                {String(answers[i]).slice(0, 800)}{String(answers[i]).length > 800 ? "…" : ""}
              </p>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}
