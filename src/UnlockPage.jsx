// src/UnlockPage.jsx
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "./firebase/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const getSessionId = () => {
  const k = "skillnest_session_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(k, v);
  }
  return v;
};

export default function UnlockPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const sessionId = useMemo(getSessionId, []);

  const handleUnlock = async () => {
    setMsg("");
    setBusy(true);
    try {
      const codeId = (code || "").trim().toUpperCase();
      if (!codeId) throw new Error("Enter your access code.");

      // codes/{code} document should exist with an "grant" map, e.g. { IB2: true }
      // You can also store "unlockAt" if needed later.
      const codeDoc = await getDoc(doc(db, "codes", codeId));
      if (!codeDoc.exists()) throw new Error("Invalid or expired code.");

      const grant = codeDoc.data()?.grant || {};
      if (typeof grant !== "object") throw new Error("Code not configured correctly.");

      const accessRef = doc(db, "access", sessionId);
      const existing = await getDoc(accessRef);
      const prev = existing.exists() ? existing.data() : {};

      const entitlements = { ...(prev.entitlements || {}), ...grant };

      await setDoc(
        accessRef,
        {
          sessionId,
          entitlements,
          updatedAt: serverTimestamp(),
          createdAt: prev.createdAt || serverTimestamp(),
        },
        { merge: true }
      );

      setMsg("✅ Unlocked! Redirecting to case list…");
      setTimeout(() => nav("/"), 900);
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-wrap">
      <Link to="/" className="back-link">← Back</Link>
      <div className="card">
        <h2>Unlock your access</h2>
        <p className="meta">Paste the code you received after purchase (e.g., from TagMango cohort).</p>
        <input
          className="answer-box"
          placeholder="e.g. SN-COHORT-SEP25"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ margin: "8px 0" }}
        />
        <button className="btn" onClick={handleUnlock} disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}
